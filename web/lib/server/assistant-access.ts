/** Process-local demo limits shared by the synthetic and Sandbox chat routes. */
export class AssistantAccess {
  private active = new Set<string>();
  private recent = new Map<string, number>();
  private callsToday = 0;
  private day = '';

  acquire(key: string, now = Date.now()): (() => void) | null {
    const today = new Date(now).toISOString().slice(0, 10);
    if (this.day !== today) {
      this.day = today;
      this.callsToday = 0;
      this.recent.clear();
    }
    if (
      this.active.has(key) ||
      this.active.size >= 3 ||
      now - (this.recent.get(key) ?? -Infinity) < 3000 ||
      this.callsToday >= 200
    )
      return null;
    this.active.add(key);
    this.recent.set(key, now);
    this.callsToday++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active.delete(key);
    };
  }
}

const globals = globalThis as typeof globalThis & {
  pennyAheadAssistantAccess?: AssistantAccess;
};
export const assistantAccess = (globals.pennyAheadAssistantAccess ??=
  new AssistantAccess());

export function assistantBusyResponse() {
  return Response.json(
    {
      error:
        'The demo assistant is busy or has reached its daily limit. Try again later.',
    },
    {
      status: 429,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export function liveAssistantError(error: unknown) {
  const verificationPending =
    error instanceof Error &&
    /account is currently being verified/i.test(error.message);
  return Response.json(
    {
      error: verificationPending
        ? 'AWS is still verifying this account for Bedrock. Try again after verification completes; AWS says this normally takes less than two hours. The dashboard remains available.'
        : 'Live AI is unavailable. No transfer was created. The deterministic dashboard remains available.',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
