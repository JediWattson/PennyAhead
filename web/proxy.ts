import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { inviteRequired, requireInvite } from './lib/server/invite-access';
export function proxy(request: NextRequest) {
  const expected = process.env.PENNYAHEAD_ORIGIN_TOKEN;
  if (expected) {
    const supplied = request.headers.get('x-pennyahead-origin') ?? '';
    const a = Buffer.from(expected),
      b = Buffer.from(supplied);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      return new NextResponse('Forbidden', { status: 403 });
  }
  const path = request.nextUrl.pathname;
  const publicPath =
    path === '/unlock' ||
    path === '/api/access' ||
    path === '/api/health' ||
    path === '/favicon.svg' ||
    path === '/favicon.ico' ||
    path.startsWith('/_next/static/');
  const denied = !publicPath ? requireInvite(request) : null;
  const response = denied
    ? path === '/api' || path.startsWith('/api/')
      ? new NextResponse(denied.body, {
          status: denied.status,
          headers: denied.headers,
        })
      : NextResponse.redirect(new URL('/unlock', request.url), 303)
    : NextResponse.next();
  if (inviteRequired())
    response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  return response;
}
