import { z } from 'zod';
import { requireInvite } from '../../../lib/server/invite-access.ts';
import { sessionToken, jsonResponse } from '../../../lib/server/monitor-api.ts';
import { getMonitorStore } from '../../../lib/server/monitor-store.ts';
import { getSandboxObservations } from '../../../lib/server/sandbox-view.ts';
import { brokerConnection } from '../../../lib/server/alpaca-broker.ts';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const denied = requireInvite(request);
  if (denied) return denied;
  try {
    const input = z
      .object({ snapshotId: z.uuid().optional() })
      .strict()
      .parse(await request.json());
    if (input.snapshotId) getSandboxObservations().read(input.snapshotId);
    else if (!getMonitorStore().read(sessionToken(request)))
      return jsonResponse(
        { error: 'Refresh your demo session before checking the brokerage.' },
        401,
      );
    return jsonResponse(await brokerConnection());
  } catch {
    return jsonResponse(
      {
        error:
          'The demo context is invalid or expired. Refresh before checking the brokerage.',
      },
      400,
    );
  }
}
