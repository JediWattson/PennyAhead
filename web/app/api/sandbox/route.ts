import {
  getSandboxObservations,
  parseSandboxInput,
  sandboxErrorResponse,
  sandboxForecast,
} from '../../../lib/server/sandbox-view.ts';
import { SandboxError } from '../../../lib/server/plaid-bank.ts';
export const runtime = 'nodejs';
export async function GET() {
  try {
    return Response.json(
      sandboxForecast(await getSandboxObservations().latest()),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const input = parseSandboxInput(
      await request.json().catch(() => {
        throw new SandboxError('INVALID_INPUT', 400);
      }),
    );
    const observation = getSandboxObservations().read(input.snapshotId);
    try {
      return Response.json(sandboxForecast(observation, input.corrections), {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch {
      throw new SandboxError('INVALID_INPUT', 400);
    }
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}
