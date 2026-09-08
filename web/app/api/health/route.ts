export const runtime = 'nodejs';
export function GET() {
  return Response.json(
    { status: 'ok', data: 'synthetic', transfers: 'local_simulation' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
