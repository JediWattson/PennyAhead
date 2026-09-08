import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type {
  ApprovalInput,
  AutomationRule,
  FundingPlan,
  MonitorConfig,
  MonitorState,
  SessionTransfer,
  TransferRecord,
} from '../contracts.ts';
import { MAX_TRANSFER_CENTS } from './transfer-policy.ts';
import { DEMO_OWNER_ID } from './fixtures.ts';

export const MONITOR_INTERVAL_MS = 5000;
const TTL_MS = 24 * 60 * 60 * 1000;

/** SQLite coordinates overlapping workers and survives a local server restart. */
export class MonitorStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS monitors (id TEXT PRIMARY KEY, state TEXT NOT NULL, fingerprint TEXT);',
    );
  }
  close() {
    this.db.close();
  }
  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private save(state: MonitorState) {
    this.db
      .prepare('UPDATE monitors SET state = ? WHERE id = ?')
      .run(JSON.stringify(state), state.id);
  }
  read(id: string, now = Date.now()): MonitorState | null {
    const row = this.db
      .prepare('SELECT state FROM monitors WHERE id = ?')
      .get(id);
    if (!row) return null;
    const state = JSON.parse(row.state as string) as MonitorState;
    // Additive migration for existing M3 demo records.
    state.proposalId ??= null;
    state.proposalStatus ??= null;
    state.transfers ??= [];
    state.generation ??= 0;
    state.rule ??= null;
    return Date.parse(state.expiresAt) > now ? state : null;
  }
  create(config: MonitorConfig, now = Date.now()): MonitorState {
    const state: MonitorState = {
      id: randomUUID(),
      revision: 0,
      config,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + TTL_MS).toISOString(),
      nextRunAt: new Date(now).toISOString(),
      lastCheckedAt: null,
      checkCount: 0,
      error: null,
      plan: null,
      alerts: [],
      proposalId: null,
      proposalStatus: null,
      transfers: [],
      generation: 0,
      rule: null,
    };
    this.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM monitors WHERE json_extract(state, '$.expiresAt') <= ? AND NOT EXISTS (SELECT 1 FROM json_each(state, '$.transfers') WHERE json_extract(value, '$.status') = 'pending')",
        )
        .run(new Date(now).toISOString());
      const row = this.db
        .prepare('SELECT count(*) AS count FROM monitors')
        .get();
      if (Number(row?.count) >= 1000)
        throw new Error('Demo monitor capacity reached');
      this.db
        .prepare('INSERT INTO monitors (id, state) VALUES (?, ?)')
        .run(state.id, JSON.stringify(state));
    });
    return state;
  }
  configure(
    id: string,
    config: MonitorConfig,
    revision: number,
    now = Date.now(),
  ): MonitorState | null {
    return this.transaction(() => {
      const state = this.read(id, now);
      if (!state) return null;
      // A late browser request may never overwrite newer settings.
      if (revision <= state.revision) return state;
      if (config.scenario !== state.config.scenario)
        this.resetLedger(state, now);
      state.config = config;
      state.revision = revision;
      state.plan = null;
      state.error = null;
      state.nextRunAt = new Date(now).toISOString();
      if (!config.enabled) {
        for (const alert of state.alerts)
          alert.resolvedAt ??= new Date(now).toISOString();
        this.db
          .prepare('UPDATE monitors SET fingerprint = NULL WHERE id = ?')
          .run(id);
      }
      this.save(state);
      return state;
    });
  }
  due(now = Date.now()): MonitorState[] {
    return this.db
      .prepare(
        "SELECT state FROM monitors WHERE json_extract(state, '$.config.enabled') = 1 AND json_extract(state, '$.nextRunAt') <= ? AND json_extract(state, '$.expiresAt') > ?",
      )
      .all(new Date(now).toISOString(), new Date(now).toISOString())
      .map((row) =>
        this.read((JSON.parse(row.state as string) as MonitorState).id, now)!,
      )
      .filter(Boolean);
  }
  complete(
    expected: MonitorState,
    plan: FundingPlan | null,
    error: string | null,
    now = Date.now(),
  ): boolean {
    return this.transaction(() => {
      const current = this.read(expected.id, now);
      if (
        !current ||
        !current.config.enabled ||
        current.revision !== expected.revision ||
        current.checkCount !== expected.checkCount
      )
        return false;
      const timestamp = new Date(now).toISOString();
      current.lastCheckedAt = timestamp;
      current.nextRunAt = new Date(now + MONITOR_INTERVAL_MS).toISOString();
      current.checkCount++;
      current.plan = plan;
      current.error = error;
      if (plan) {
        const fingerprint = createHash('sha256')
          .update(JSON.stringify(plan))
          .digest('hex');
        const previous = this.db
          .prepare('SELECT fingerprint FROM monitors WHERE id = ?')
          .get(current.id)?.fingerprint;
        if (fingerprint !== previous) {
          current.proposalId = plan.status === 'proposed' ? randomUUID() : null;
          current.proposalStatus = current.proposalId ? 'open' : null;
          for (const alert of current.alerts) alert.resolvedAt ??= timestamp;
          if (plan.status === 'proposed' || plan.status === 'blocked') {
            current.alerts.unshift({
              id: randomUUID(),
              createdAt: timestamp,
              acknowledgedAt: null,
              resolvedAt: null,
              plan,
            });
            current.alerts = current.alerts.slice(0, 20);
          }
          this.db
            .prepare('UPDATE monitors SET fingerprint = ? WHERE id = ?')
            .run(fingerprint, current.id);
        }
      }
      if (plan?.status === 'proposed' && !current.proposalId) {
        current.proposalId = randomUUID();
        current.proposalStatus = 'open';
      }
      this.save(current);
      return true;
    });
  }
  acknowledge(
    id: string,
    alertId: string,
    now = Date.now(),
  ): MonitorState | null {
    return this.transaction(() => {
      const state = this.read(id, now);
      const alert = state?.alerts.find(
        (a) => a.id === alertId && !a.resolvedAt,
      );
      if (!state || !alert) return null;
      alert.acknowledgedAt ??= new Date(now).toISOString();
      this.save(state);
      return state;
    });
  }

  private invalidate(state: MonitorState, now: number) {
    state.plan = null;
    state.checkCount++; // invalidates all calculations started against the old ledger
    state.nextRunAt = new Date(now).toISOString();
  }
  private resetLedger(state: MonitorState, now: number) {
    if (
      state.transfers.some(
        (t) => t.status === 'pending' && t.environment === 'dwolla_sandbox',
      )
    )
      throw new Error('Resolve the pending provider transfer before resetting');
    for (const transfer of state.transfers.filter(
      (t) => t.status === 'pending',
    )) {
      transfer.status = 'failed';
      transfer.failureReason = 'Demo reset; local simulation canceled.';
      transfer.updatedAt = new Date(now).toISOString();
    }
    state.generation++;
    state.rule = null;
    state.proposalId = null;
    state.proposalStatus = null;
    this.db
      .prepare('UPDATE monitors SET fingerprint = NULL WHERE id = ?')
      .run(state.id);
  }
  reset(id: string, now = Date.now()): MonitorState | null {
    return this.transaction(() => {
      const state = this.read(id, now);
      if (!state) return null;
      this.resetLedger(state, now);
      this.invalidate(state, now);
      for (const alert of state.alerts)
        alert.resolvedAt ??= new Date(now).toISOString();
      this.save(state);
      return state;
    });
  }
  decline(
    id: string,
    proposalId: string,
    now = Date.now(),
  ): MonitorState | null {
    return this.transaction(() => {
      const state = this.read(id, now);
      if (
        !state ||
        state.proposalId !== proposalId ||
        state.proposalStatus === 'submitted'
      )
        return null;
      state.proposalStatus = 'declined';
      state.checkCount++;
      this.save(state);
      return state;
    });
  }
  approve(
    expected: MonitorState,
    input: ApprovalInput,
    freshPlan: FundingPlan,
    environment: TransferRecord['environment'],
    initiatedBy: 'approval' | 'automation' = 'approval',
    now = Date.now(),
  ): SessionTransfer {
    return this.transaction(() => {
      const state = this.read(expected.id, now);
      if (!state) throw new Error('Session expired');
      const previous = state.transfers.find(
        (t) => t.approvedTransfer.approvalId === input.proposalId,
      );
      if (previous) {
        const bound = previous.approvedTransfer;
        if (
          bound.amountCents !== input.amountCents ||
          bound.sourceAccountId !== input.sourceAccountId ||
          bound.destinationAccountId !== input.destinationAccountId
        )
          throw new Error('Approval does not match the original transfer');
        return previous;
      }
      if (
        state.revision !== expected.revision ||
        state.checkCount !== expected.checkCount ||
        input.revision !== state.revision
      )
        throw new Error(
          'The account or preferences changed; review a fresh proposal',
        );
      if (
        !state.plan ||
        state.plan.status !== 'proposed' ||
        state.proposalId !== input.proposalId ||
        state.proposalStatus !== 'open' ||
        !state.lastCheckedAt ||
        now - Date.parse(state.lastCheckedAt) > 20000
      )
        throw new Error(
          'This proposal is no longer available; wait for a fresh check',
        );
      if (
        freshPlan.status !== 'proposed' ||
        JSON.stringify(freshPlan) !== JSON.stringify(state.plan)
      )
        throw new Error(
          'The proposal changed; review the updated accounts and amount',
        );
      if (
        !Number.isSafeInteger(input.amountCents) ||
        input.amountCents < 1 ||
        input.amountCents > MAX_TRANSFER_CENTS ||
        input.amountCents !== freshPlan.amountCents ||
        input.sourceAccountId !== freshPlan.sourceAccountId ||
        input.destinationAccountId !== freshPlan.destinationAccountId ||
        input.sourceAccountId === input.destinationAccountId
      )
        throw new Error('Approval must match the exact accounts and amount');
      if (
        state.transfers.some(
          (t) => t.generation === state.generation && t.status === 'pending',
        )
      )
        throw new Error('Resolve the pending transfer first');
      if (state.transfers.length >= 50)
        throw new Error(
          'Demo transfer history is full; start a new demo session',
        );
      if (initiatedBy === 'automation') {
        const rule = state.rule;
        if (
          !rule?.enabled ||
          !state.config.enabled ||
          rule.sourceAccountId !== input.sourceAccountId ||
          rule.destinationAccountId !== input.destinationAccountId ||
          rule.spentCents + input.amountCents > rule.capCents ||
          freshPlan.remainingSavingsCents === null ||
          freshPlan.remainingSavingsCents < rule.savingsMinimumCents
        )
          throw new Error(
            'The automation rule does not authorize this transfer',
          );
        rule.spentCents += input.amountCents;
      }
      const timestamp = new Date(now).toISOString();
      const transfer: SessionTransfer = {
        id: randomUUID(),
        environment,
        status: 'pending',
        generation: state.generation,
        approvedTransfer: {
          approvalId: input.proposalId,
          ownerId: DEMO_OWNER_ID,
          sourceAccountId: input.sourceAccountId,
          destinationAccountId: input.destinationAccountId,
          amountCents: input.amountCents,
          currency: 'USD',
          idempotencyKey: createHash('sha256')
            .update(`${state.id}:${input.proposalId}`)
            .digest('hex'),
        },
        estimatedArrival:
          environment === 'local_simulation' ? freshPlan.expectedArrival : null,
        createdAt: timestamp,
        updatedAt: timestamp,
        initiatedBy,
        execution: environment === 'local_simulation' ? 'submitted' : 'queued',
        providerId: null,
        failureReason: null,
        nextAttemptAt: timestamp,
        attempts: 0,
      };
      state.transfers.unshift(transfer);
      state.proposalStatus = 'submitted';
      this.invalidate(state, now);
      this.save(state);
      return transfer;
    });
  }
  settleSimulation(
    id: string,
    transferId: string,
    status: 'completed' | 'failed',
    now = Date.now(),
  ): MonitorState | null {
    return this.transaction(() => {
      const state = this.read(id, now);
      if (!state) return null;
      const transfer = state.transfers.find(
        (t) => t.id === transferId && t.generation === state.generation,
      );
      if (!transfer || transfer.environment !== 'local_simulation')
        throw new Error('Only local simulations can be advanced manually');
      if (transfer.status !== 'pending') {
        if (transfer.status !== status)
          throw new Error('A terminal result cannot be overwritten');
        return state;
      }
      transfer.status = status;
      transfer.updatedAt = new Date(now).toISOString();
      transfer.failureReason =
        status === 'failed'
          ? 'Simulated bank failure; no money was received.'
          : null;
      if (status === 'failed' && state.rule) {
        state.rule.enabled = false;
        state.rule.revokedAt = transfer.updatedAt;
      }
      this.invalidate(state, now);
      this.save(state);
      return state;
    });
  }
  configureRule(
    id: string,
    capCents: number | null,
    now = Date.now(),
  ): MonitorState | null {
    return this.transaction(() => {
      const state = this.read(id, now);
      if (!state) return null;
      if (capCents === null) {
        if (state.rule) {
          state.rule.enabled = false;
          state.rule.revokedAt = new Date(now).toISOString();
        }
      } else {
        if (
          !Number.isSafeInteger(capCents) ||
          capCents <= 0 ||
          capCents > MAX_TRANSFER_CENTS
        )
          throw new Error('Rule cap must be between $0.01 and $500');
        if (state.rule?.enabled)
          throw new Error(
            'Revoke the existing rule before authorizing another',
          );
        if (state.transfers.some((t) => t.status === 'pending'))
          throw new Error(
            'Resolve pending transfers before authorizing a rule',
          );
        const rule: AutomationRule = {
          id: randomUUID(),
          enabled: true,
          sourceAccountId: 'demo-savings',
          destinationAccountId: 'demo-checking',
          capCents,
          spentCents: 0,
          savingsMinimumCents: state.config.savingsMinimumCents,
          createdAt: new Date(now).toISOString(),
          revokedAt: null,
        };
        state.rule = rule;
      }
      this.invalidate(state, now);
      this.save(state);
      return state;
    });
  }
}

let store: MonitorStore | undefined;
export function getMonitorStore() {
  return (store ??= new MonitorStore(
    process.env.PENNYAHEAD_MONITOR_DB ?? resolve('work/monitor.sqlite'),
  ));
}
