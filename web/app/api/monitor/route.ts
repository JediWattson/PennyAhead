import { getMonitorStore } from '../../../lib/server/monitor-store.ts';
import { parseMonitorConfig } from '../../../lib/server/funding.ts';
import { getDemoForecast } from '../../../lib/server/demo-forecast.ts';
import { DEMO_OWNER_ID } from '../../../lib/server/fixtures.ts';

export const runtime = 'nodejs';
const respond = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
function token(request: Request) {
  const value =
    request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  return /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)
    ? value
    : '';
}
export async function GET(request: Request) {
  const state = getMonitorStore().read(token(request));
  return state
    ? respond(state)
    : respond({ error: 'Demo monitor not found or expired.' }, 404);
}
export async function POST(request: Request) {
  try {
    const config = parseMonitorConfig(await request.json());
    await getDemoForecast(DEMO_OWNER_ID, config); // validate corrections before persisting
    return respond(getMonitorStore().create(config), 201);
  } catch {
    return respond(
      {
        error:
          'Unable to create monitor. Check the demo settings or try again.',
      },
      400,
    );
  }
}
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') throw new Error('Invalid update');
    const store = getMonitorStore();
    if (!store.read(token(request)))
      return respond({ error: 'Demo monitor not found or expired.' }, 404);
    if (body.action === 'acknowledge' && typeof body.alertId === 'string') {
      const state = store.acknowledge(token(request), body.alertId);
      return state
        ? respond(state)
        : respond({ error: 'Active alert not found.' }, 404);
    }
    if (
      body.action !== 'configure' ||
      !Number.isSafeInteger(body.revision) ||
      body.revision < 1
    )
      throw new Error('Invalid revision');
    const config = parseMonitorConfig(body.config);
    await getDemoForecast(DEMO_OWNER_ID, config);
    const state = store.configure(token(request), config, body.revision);
    return state
      ? respond(state)
      : respond({ error: 'Demo monitor expired.' }, 404);
  } catch {
    return respond(
      {
        error:
          'Invalid monitoring settings. Use a savings minimum between $0 and $1,000,000.',
      },
      400,
    );
  }
}
