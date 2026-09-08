import type { MonitorState, MonitorView } from '../contracts.ts';
import { getSessionDemo } from './session-bank.ts';
import { transferEnvironment } from './transfer-policy.ts';

export function sessionToken(request: Request) {
  const value =
    request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  return /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)
    ? value
    : '';
}
export async function monitorView(state: MonitorState): Promise<MonitorView> {
  return {
    ...state,
    demo: await getSessionDemo(state),
    transferEnvironment: transferEnvironment(),
  };
}
export const jsonResponse = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
