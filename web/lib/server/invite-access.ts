import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const INVITE_COOKIE = 'pennyahead_access';
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
const HEX = /^[a-f0-9]{64}$/;

export function inviteRequired() {
  const mode = process.env.PENNYAHEAD_ACCESS_MODE;
  return mode === 'disabled'
    ? false
    : mode !== undefined || process.env.NODE_ENV === 'production';
}

function configuration() {
  const hashes = (process.env.PENNYAHEAD_INVITE_HASHES ?? '').split(',');
  const secret = process.env.PENNYAHEAD_ACCESS_SECRET ?? '';
  if (
    !hashes.length ||
    hashes.length > 50 ||
    !hashes.every((hash) => HEX.test(hash)) ||
    !HEX.test(secret)
  )
    return null;
  return { hashes, secret };
}

export function inviteConfigured() {
  return configuration() !== null;
}

function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function issueInviteSession(
  token: unknown,
  now = Date.now(),
): string | null {
  const config = configuration();
  if (
    !config ||
    typeof token !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(token)
  )
    return null;
  const hash = createHash('sha256').update(token).digest('hex');
  if (!config.hashes.some((allowed) => equal(hash, allowed))) return null;
  const payload = `${hash}.${Math.floor(now / 1000) + SESSION_SECONDS}.${randomBytes(16).toString('hex')}`;
  return `${payload}.${createHmac('sha256', config.secret).update(payload).digest('hex')}`;
}

export function validInviteSession(
  cookie: string | undefined,
  now = Date.now(),
): boolean {
  const config = configuration();
  if (!config || !cookie || cookie.length > 256) return false;
  const parts = cookie.split('.');
  if (parts.length !== 4) return false;
  const [hash, expires, nonce, signature] = parts;
  if (
    !HEX.test(hash) ||
    !/^\d{10}$/.test(expires) ||
    !/^[a-f0-9]{32}$/.test(nonce) ||
    !HEX.test(signature)
  )
    return false;
  const seconds = Math.floor(now / 1000);
  if (
    +expires <= seconds ||
    +expires > seconds + SESSION_SECONDS ||
    !config.hashes.includes(hash)
  )
    return false;
  const expected = createHmac('sha256', config.secret)
    .update(parts.slice(0, 3).join('.'))
    .digest('hex');
  return equal(expected, signature);
}

export function sameOrigin(request: Request) {
  if (
    ['cross-site', 'same-site'].includes(
      request.headers.get('sec-fetch-site') ?? '',
    )
  )
    return false;
  try {
    const origin = new URL(request.headers.get('origin') ?? '');
    return (
      ['https:', 'http:'].includes(origin.protocol) &&
      origin.host === (request.headers.get('host') ?? new URL(request.url).host)
    );
  } catch {
    return false;
  }
}

export function accessError(status = 401) {
  return Response.json(
    {
      error: 'Unlock PennyAhead with your judge invitation.',
      code: 'INVITE_REQUIRED',
    },
    {
      status,
      headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
    },
  );
}

/** Enforced inside each API handler as well as Proxy; monitor bearer capabilities remain separate. */
export function requireInvite(request?: Request): Response | null {
  if (!inviteRequired()) return null;
  const cookie = request?.headers
    .get('cookie')
    ?.split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${INVITE_COOKIE}=`))
    ?.slice(INVITE_COOKIE.length + 1);
  if (!validInviteSession(cookie)) return accessError();
  if (
    request &&
    !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
    request.headers.has('origin') &&
    !sameOrigin(request)
  )
    return accessError(403);
  return null;
}
