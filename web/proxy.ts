import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
export function proxy(request: NextRequest) {
  const expected = process.env.PENNYAHEAD_ORIGIN_TOKEN;
  if (expected) {
    const supplied = request.headers.get('x-pennyahead-origin') ?? '';
    const a = Buffer.from(expected),
      b = Buffer.from(supplied);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      return new NextResponse('Forbidden', { status: 403 });
  }
  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  return response;
}
