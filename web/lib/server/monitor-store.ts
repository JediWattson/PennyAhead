import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { FundingPlan, MonitorConfig, MonitorState } from '../contracts.ts';

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
    };
    this.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM monitors WHERE json_extract(state, '$.expiresAt') <= ?",
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
      .map((row) => JSON.parse(row.state as string) as MonitorState);
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
          for (const alert of current.alerts) alert.resolvedAt ??= timestamp;
          if (plan.status !== 'no_shortfall') {
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
}

let store: MonitorStore | undefined;
export function getMonitorStore() {
  return (store ??= new MonitorStore(
    process.env.PENNYAHEAD_MONITOR_DB ?? resolve('work/monitor.sqlite'),
  ));
}
