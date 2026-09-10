import { requireInvite } from '../../../lib/server/invite-access.ts';
import { bankProvider, DEMO_OWNER_ID } from '../../../lib/server/fixtures.ts';
export async function GET(request?: Request) {
  const denied = requireInvite(request);
  if (denied) return denied;
  return Response.json(await bankProvider.getSnapshot(DEMO_OWNER_ID), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
