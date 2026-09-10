import { requireInvite } from '../../../lib/server/invite-access.ts';
import { DEMO_OWNER_ID } from '../../../lib/server/fixtures.ts';
import {
  getDemoForecast,
  parseDemoOptions,
} from '../../../lib/server/demo-forecast.ts';
export async function GET(request?: Request) {
  const denied = requireInvite(request);
  if (denied) return denied;
  return Response.json(await getDemoForecast(DEMO_OWNER_ID), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
export async function POST(request: Request) {
  const denied = requireInvite(request);
  if (denied) return denied;
  try {
    const options = parseDemoOptions(await request.json());
    return Response.json(await getDemoForecast(DEMO_OWNER_ID, options), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json(
      {
        error:
          'Choose a valid scenario and corrections for its detected bills. Dates must be within 62 days of the demo clock; amounts must be positive integer cents up to $1,000,000.',
      },
      { status: 400 },
    );
  }
}
