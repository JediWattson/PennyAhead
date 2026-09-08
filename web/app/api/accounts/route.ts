import { bankProvider, DEMO_OWNER_ID } from '../../../lib/server/fixtures.ts';
export async function GET() {
  return Response.json(await bankProvider.getSnapshot(DEMO_OWNER_ID), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
