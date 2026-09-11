import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import {
  INVITE_COOKIE,
  SESSION_SECONDS,
  inviteRequired,
  issueInviteSession,
  validInviteSession,
  requireInvite,
} from '../lib/server/invite-access.ts';
import { POST, DELETE } from '../app/api/access/route.ts';

const saved = { ...process.env };
after(() => {
  process.env = saved;
});
const token = 'a'.repeat(43);
const hash = createHash('sha256').update(token).digest('hex');
function configure() {
  process.env.PENNYAHEAD_ACCESS_MODE = 'required';
  process.env.PENNYAHEAD_INVITE_HASHES = hash;
  process.env.PENNYAHEAD_ACCESS_SECRET = 'b'.repeat(64);
}
const request = (body: unknown, origin = 'https://demo.test') =>
  new Request('https://demo.test/api/access', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

void test('production defaults closed and malformed configuration never grants access', () => {
  delete process.env.PENNYAHEAD_ACCESS_MODE;
  Object.assign(process.env, { NODE_ENV: 'production' });
  assert.equal(inviteRequired(), true);
  delete process.env.PENNYAHEAD_INVITE_HASHES;
  assert.equal(issueInviteSession(token), null);
  assert.equal(requireInvite()?.status, 401);
  configure();
  process.env.PENNYAHEAD_INVITE_HASHES = hash + ',bad';
  assert.equal(issueInviteSession(token), null);
  process.env.PENNYAHEAD_ACCESS_MODE = 'typo';
  assert.equal(inviteRequired(), true);
  process.env.PENNYAHEAD_ACCESS_MODE = 'disabled';
  assert.equal(requireInvite(), null);
});

void test('signed sessions reject tampering, expiry, removed invites and rotated signing keys', () => {
  configure();
  const now = Date.now();
  const cookie = issueInviteSession(token, now)!;
  assert(cookie);
  assert.equal(validInviteSession(cookie, now), true);
  assert.equal(validInviteSession(cookie, now + SESSION_SECONDS * 1000), false);
  assert.equal(validInviteSession(cookie + 'x', now), false);
  assert.equal(
    validInviteSession(cookie.replace(hash, 'c'.repeat(64)), now),
    false,
  );
  assert.equal(validInviteSession('anything'), false);
  assert.equal(issueInviteSession('wrong'), null);
  assert.equal(issueInviteSession('z'.repeat(43)), null);
  assert.equal(issueInviteSession(hash), null);
  process.env.PENNYAHEAD_INVITE_HASHES = 'c'.repeat(64);
  assert.equal(validInviteSession(cookie, now), false);
  process.env.PENNYAHEAD_INVITE_HASHES = hash;
  process.env.PENNYAHEAD_ACCESS_SECRET = 'd'.repeat(64);
  assert.equal(validInviteSession(cookie, now), false);
});

void test('all data API handlers reject unauthenticated calls independently of Proxy', async () => {
  configure();
  const routes = [
    await import('../app/api/growth/route.ts'),
    await import('../app/api/accounts/route.ts'),
    await import('../app/api/forecast/route.ts'),
    await import('../app/api/assistant/route.ts'),
    await import('../app/api/monitor/route.ts'),
    await import('../app/api/transfers/route.ts'),
    await import('../app/api/sandbox/route.ts'),
    await import('../app/api/sandbox/growth/route.ts'),
    await import('../app/api/sandbox/assistant/route.ts'),
  ];
  for (const route of routes)
    for (const [method, handler] of Object.entries(route)) {
      if (typeof handler !== 'function') continue;
      const response = await handler(
        new Request('https://demo.test/api/test', { method }),
      );
      assert.equal(response.status, 401, method);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
});

void test('unlock rejects cross-origin, malformed and oversized input; cookie is private and logout expires it', async () => {
  configure();
  Object.assign(process.env, { NODE_ENV: 'production' });
  assert.equal(
    (await POST(request({ token }, 'https://foreign.test'))).status,
    403,
  );
  assert.equal((await POST(request({ token: 'x'.repeat(2000) }))).status, 413);
  assert.equal((await POST(request({ token: 'incorrect' }))).status, 401);
  const response = await POST(request({ token }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly; SameSite=Strict; Max-Age=604800; Secure/);
  assert(!cookie.includes(token));
  assert(!JSON.stringify(await response.json()).includes(token));
  const authorized = new Request('https://demo.test/api/accounts', {
    headers: { Cookie: cookie.split(';')[0] },
  });
  assert.equal(requireInvite(authorized), null);
  const attack = new Request('https://demo.test/api/monitor', {
    method: 'POST',
    headers: { Cookie: cookie.split(';')[0], Origin: 'https://foreign.test' },
  });
  assert.equal(requireInvite(attack)?.status, 403);
  const loggedOut = DELETE(
    new Request('https://demo.test/api/access', {
      method: 'DELETE',
      headers: { Origin: 'https://demo.test' },
    }),
  );
  assert.match(
    loggedOut.headers.get('set-cookie')!,
    new RegExp(`${INVITE_COOKIE}=;.*Max-Age=0`),
  );
  assert.equal(
    DELETE(new Request('https://demo.test/api/access', { method: 'DELETE' }))
      .status,
    403,
  );
});

void test('invalid guesses are throttled without locking valid judges out', async () => {
  configure();
  for (let index = 0; index < 30; index++)
    await POST(request({ token: 'invalid' }));
  const blocked = await POST(request({ token: 'invalid' }));
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '60');
  assert.equal((await POST(request({ token }))).status, 200);
});
