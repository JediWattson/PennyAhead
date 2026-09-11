import { parseChatHistory, type ChatHistoryMessage } from '../chat-history.ts';
import { randomUUID } from 'node:crypto';
import type {
  BankDataProvider,
  BankSnapshot,
  BillCorrection,
  DemoForecast,
} from '../contracts.ts';
import { buildForecast } from './forecast.ts';
import { buildBillSuggestion } from './bill-suggestion.ts';
import { parseDemoOptions } from './demo-forecast.ts';
import { parseGrowthInputs } from './growth-plan.ts';
import {
  configuredPlaidProvider,
  plaidSandboxEnabled,
  PLAID_DEMO_OWNER_ID,
  SandboxError,
} from './plaid-bank.ts';

interface Observation {
  id: string;
  snapshot: BankSnapshot;
  evaluatedAt: string;
  createdAt: number;
}
const CACHE_MS = 60_000;
const OBSERVATION_MS = 15 * 60_000;

/** Bounded, process-local observations keep a displayed forecast and its chat on the same data. */
export class SandboxObservations {
  private bank: BankDataProvider;
  private now: () => number;
  private entries = new Map<string, Observation>();
  private latestId: string | null = null;
  private inFlight: Promise<Observation> | null = null;
  private lastAttempt = -Infinity;
  constructor(bank: BankDataProvider, now: () => number = Date.now) {
    this.bank = bank;
    this.now = now;
  }
  async latest(): Promise<Observation> {
    const latest = this.latestId ? this.entries.get(this.latestId) : null;
    if (latest && this.now() - latest.createdAt < CACHE_MS)
      return structuredClone(latest);
    if (this.inFlight) return structuredClone(await this.inFlight);
    if (this.now() - this.lastAttempt < 10_000)
      throw new SandboxError('RETRY_LATER', 429);
    this.lastAttempt = this.now();
    this.inFlight = this.bank
      .getSnapshot(PLAID_DEMO_OWNER_ID)
      .then((snapshot) => {
        const entry = {
          id: randomUUID(),
          snapshot,
          evaluatedAt: new Date(this.now()).toISOString(),
          createdAt: this.now(),
        };
        this.entries.set(entry.id, entry);
        this.latestId = entry.id;
        for (const [id, old] of this.entries) {
          if (
            this.now() - old.createdAt >= OBSERVATION_MS ||
            this.entries.size > 16
          )
            this.entries.delete(id);
        }
        return entry;
      });
    try {
      return structuredClone(await this.inFlight);
    } finally {
      this.inFlight = null;
    }
  }
  read(id: string): Observation {
    const entry = this.entries.get(id);
    if (!entry || this.now() - entry.createdAt >= OBSERVATION_MS)
      throw new SandboxError('SNAPSHOT_EXPIRED', 409);
    return structuredClone(entry);
  }
}
const globals = globalThis as typeof globalThis & {
  pennyAheadSandboxObservations?: SandboxObservations;
};
export function getSandboxObservations(): SandboxObservations {
  if (!plaidSandboxEnabled()) throw new SandboxError('NOT_CONFIGURED');
  return (globals.pennyAheadSandboxObservations ??= new SandboxObservations(
    configuredPlaidProvider(),
  ));
}
export function sandboxForecast(
  observation: Observation,
  corrections: BillCorrection[] = [],
): DemoForecast {
  const checking = observation.snapshot.accounts.find(
    (a) => a.kind === 'checking',
  );
  if (!checking) throw new SandboxError('CHECKING_UNAVAILABLE');
  const forecast = buildForecast(
    observation.snapshot,
    checking.id,
    observation.evaluatedAt,
    corrections,
  );
  return {
    ...(process.env.PENNYAHEAD_SANDBOX_SAMPLE_ROTH === 'true'
      ? { sampleRothProfile: true }
      : {}),
    clock: 'provider-observation',
    snapshotId: observation.id,
    scenario: 'shortfall',
    corrections,
    snapshot: observation.snapshot,
    forecast,
    billSuggestion: buildBillSuggestion(observation.snapshot, forecast),
  };
}
export function parseSandboxInput(
  input: unknown,
  withMessage = false,
): {
  snapshotId: string;
  corrections: BillCorrection[];
  message: string;
  history: ChatHistoryMessage[];
} {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new SandboxError('INVALID_INPUT', 400);
  const data = input as Record<string, unknown>;
  const allowed = withMessage
    ? ['snapshotId', 'corrections', 'message', 'history']
    : ['snapshotId', 'corrections'];
  if (
    Object.keys(data).some((key) => !allowed.includes(key)) ||
    typeof data.snapshotId !== 'string' ||
    data.snapshotId.length > 100
  )
    throw new SandboxError('INVALID_INPUT', 400);
  if (
    withMessage &&
    (typeof data.message !== 'string' ||
      !data.message.trim() ||
      data.message.length > 1000)
  )
    throw new SandboxError('INVALID_INPUT', 400);
  try {
    return {
      snapshotId: data.snapshotId,
      corrections: parseDemoOptions({ corrections: data.corrections })
        .corrections,
      message: withMessage ? (data.message as string) : '',
      history: withMessage ? parseChatHistory(data.history) : [],
    };
  } catch {
    throw new SandboxError('INVALID_INPUT', 400);
  }
}
export function sandboxErrorResponse(error: unknown): Response {
  const code = error instanceof SandboxError ? error.code : 'UNAVAILABLE';
  const message =
    code === 'INVALID_PLAN'
      ? 'Review the plan amounts and 2026 Roth details, then try again.'
      : code === 'SNAPSHOT_EXPIRED'
        ? 'This observation expired. Refresh Sandbox data before continuing.'
        : code === 'NOT_CONFIGURED'
          ? 'Plaid Sandbox is not enabled on this server.'
          : code === 'RECONNECT_REQUIRED'
            ? 'The test bank connection needs to be renewed in Plaid Sandbox.'
            : code === 'BALANCE_UNAVAILABLE'
              ? 'Plaid did not return a usable balance. No replacement balance or forecast was invented.'
              : code === 'HISTORY_LOADING'
                ? 'Plaid is still preparing transaction history. Refresh again shortly.'
                : code === 'INVALID_INPUT'
                  ? 'Use this observation and valid corrections for its detected bills.'
                  : code === 'RETRY_LATER'
                    ? 'The Sandbox read is temporarily unavailable. Try again shortly.'
                    : 'Plaid Sandbox could not be read. Try refreshing again shortly.';
  return Response.json(
    { error: message },
    {
      status: error instanceof SandboxError ? error.status : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

/** Accept plan assumptions, never client-supplied balances or account IDs. */
export function parseSandboxGrowthInput(input: unknown, withMessage = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new SandboxError('INVALID_INPUT', 400);
  const { growth, ...context } = input as Record<string, unknown>;
  const parsed = parseSandboxInput(context, withMessage);
  try {
    return { ...parsed, growth: parseGrowthInputs(growth) };
  } catch {
    throw new SandboxError('INVALID_PLAN', 400);
  }
}
