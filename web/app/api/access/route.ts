import {
  INVITE_COOKIE,
  SESSION_SECONDS,
  inviteConfigured,
  issueInviteSession,
  sameOrigin,
} from '../../../lib/server/invite-access.ts';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
let failedAttempts = 0;
let windowStart = 0;

function cookie(value: string, maxAge: number) {
  return `${INVITE_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

export async function POST(request: Request) {
  if (
    !sameOrigin(request) ||
    request.headers.get('content-type')?.split(';')[0] !== 'application/json'
  )
    return Response.json(
      { error: 'Open your invitation on this site to unlock.' },
      { status: 403, headers },
    );
  if (!inviteConfigured())
    return Response.json(
      { error: 'Judge access is being prepared. Please try again later.' },
      { status: 503, headers },
    );
  // Read a bounded body even when Content-Length is absent or untrusted.
  const reader = request.body?.getReader();
  if (!reader)
    return Response.json(
      { error: 'Enter your invitation token.' },
      { status: 400, headers },
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  let session: string | null = null;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1024) {
        await reader.cancel();
        return Response.json(
          { error: 'Invitation is too long.' },
          { status: 413, headers },
        );
      }
      chunks.push(chunk.value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    session = issueInviteSession(body?.token);
  } catch {
    /* Invalid bodies receive the same response as invalid tokens. */
  }
  if (!session) {
    const now = Date.now();
    if (now - windowStart >= 60_000) {
      windowStart = now;
      failedAttempts = 0;
    }
    failedAttempts++;
    // Process-local failure throttle. Valid high-entropy invitations still work during a guessing flood.
    if (failedAttempts > 30)
      return Response.json(
        {
          error:
            'Too many invalid attempts. Check your invitation and try again in a minute.',
        },
        { status: 429, headers: { ...headers, 'Retry-After': '60' } },
      );
    return Response.json(
      {
        error:
          'That invitation is invalid or has been revoked. Check the token or ask for a new invitation.',
      },
      { status: 401, headers },
    );
  }
  return Response.json(
    { unlocked: true },
    { headers: { ...headers, 'Set-Cookie': cookie(session, SESSION_SECONDS) } },
  );
}

export function DELETE(request: Request) {
  if (!sameOrigin(request))
    return Response.json(
      { error: 'Open PennyAhead to lock this browser.' },
      { status: 403, headers },
    );
  return Response.json(
    { unlocked: false },
    { headers: { ...headers, 'Set-Cookie': cookie('', 0) } },
  );
}
