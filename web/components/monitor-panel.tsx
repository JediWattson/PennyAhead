'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SubmitEvent,
} from 'react';
import { BellRing, ShieldCheck } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { formatMoney } from '../lib/money';
import { TransferPanel } from './transfer-panel';
import type {
  DemoForecast,
  MonitorConfig,
  MonitorView,
} from '../lib/contracts';

export type FundingSettings = Pick<
  MonitorConfig,
  'enabled' | 'savingsMinimumCents' | 'timing'
>;
const date = (value: string) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

export function MonitorPanel({
  demo,
  settings,
  onSettings,
  onSession,
  busy,
}: {
  demo: DemoForecast;
  settings: FundingSettings;
  onSettings: (settings: FundingSettings) => void;
  busy: boolean;
  onSession: (state: MonitorView) => void;
}) {
  const [state, setState] = useState<MonitorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minimum, setMinimum] = useState(
    String(settings.savingsMinimumCents / 100),
  );
  const [timing, setTiming] = useState(settings.timing);
  const [ackBusy, setAckBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const actionInFlight = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const creation = useRef<Promise<MonitorView> | null>(null);
  const revision = useRef(0);
  const acceptedVersion = useRef({ revision: -1, checkCount: -1 });
  const accept = useCallback(
    (result: MonitorView) => {
      const previous = acceptedVersion.current;
      if (
        result.revision < previous.revision ||
        (result.revision === previous.revision &&
          result.checkCount < previous.checkCount)
      )
        return;
      acceptedVersion.current = {
        revision: result.revision,
        checkCount: result.checkCount,
      };
      setState(result);
      onSession(result);
      setReceivedAt(Date.now());
    },
    [onSession],
  );

  const desired = JSON.stringify({
    scenario: demo.scenario,
    corrections: demo.corrections,
    ...settings,
  });
  const [renderedConfig, setRenderedConfig] = useState(desired);
  if (renderedConfig !== desired) {
    // Invalidate before paint, including a rapid A → B → A preference change.
    setRenderedConfig(desired);
    setState(null);
    setError(null);
  }

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const currentRevision = ++revision.current;
    const config = JSON.parse(desired) as MonitorConfig;
    const request = async (
      method: string,
      id?: string,
      body?: unknown,
    ): Promise<MonitorView> => {
      const response = await fetch('/api/monitor', {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(id ? { Authorization: `Bearer ${id}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Monitor unavailable');
      return response.json();
    };
    const poll = async (id: string) => {
      try {
        const result = await request('GET', id);
        if (!stopped && result.revision === currentRevision) {
          accept(result);
          setError(null);
        }
      } catch {
        if (!stopped)
          setError(
            'Monitoring status is unavailable. Retrying; no proposal should be acted on.',
          );
      }
      if (!stopped)
        timer = setTimeout(() => {
          void poll(id);
        }, 2000);
    };
    const sync = async () => {
      try {
        creation.current ??= request('POST', undefined, config).catch(
          (error) => {
            creation.current = null;
            throw error;
          },
        );
        const session = await creation.current;
        if (stopped) return;
        const result = await request('PATCH', session.id, {
          action: 'configure',
          config,
          revision: currentRevision,
        });
        if (stopped) return;
        accept(result);
        setError(null);
        void poll(session.id);
      } catch {
        if (!stopped) {
          setError(
            'Monitoring settings could not be saved. Retrying; previous proposals are unavailable.',
          );
          timer = setTimeout(() => {
            void sync();
          }, 3000);
        }
      }
    };
    void sync();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [desired, accept]);

  const current =
    state && JSON.stringify(state.config) === desired ? state : null;
  const heartbeatStale =
    current?.config.enabled &&
    current.lastCheckedAt &&
    receivedAt - Date.parse(current.lastCheckedAt) > 20000;
  const plan = !error && !heartbeatStale ? current?.plan : null;
  const active = current?.alerts.find((alert) => !alert.resolvedAt);
  async function acknowledge() {
    if (!current || !active || ackBusy) return;
    setAckBusy(true);
    try {
      const response = await fetch('/api/monitor', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${current.id}`,
        },
        body: JSON.stringify({ action: 'acknowledge', alertId: active.id }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Acknowledgement failed');
      const result: MonitorView = await response.json();
      setState((previous) =>
        previous?.revision === result.revision &&
        result.checkCount >= previous.checkCount
          ? result
          : previous,
      );
    } catch {
      setError('The alert could not be marked as read. Please try again.');
    } finally {
      setAckBusy(false);
    }
  }
  async function transferAction(body: Record<string, unknown>) {
    if (!current || actionInFlight.current) return;
    actionInFlight.current = true;
    setActionBusy(true);
    setActionError(null);
    try {
      const response = await fetch('/api/transfers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${current.id}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? 'The transfer action failed.');
      accept(result);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'The action could not be completed. Check its status before trying again.',
      );
    } finally {
      actionInFlight.current = false;
      setActionBusy(false);
    }
  }
  function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d+(\.\d{1,2})?$/.test(minimum)) return;
    onSettings({
      ...settings,
      savingsMinimumCents: Math.round(Number(minimum) * 100),
      timing,
    });
  }
  return (
    <section className="monitor-section" aria-labelledby="monitor-heading">
      <div className="section-heading">
        <h2 id="monitor-heading">
          <BellRing size={18} /> Looking ahead for you
        </h2>
        <span>Background demo monitor</span>
      </div>
      <div className="monitor-card">
        <div className="monitor-status">
          <span className="status-dot" />
          <strong data-testid="monitor-status">
            {error || current?.error || (settings.enabled && heartbeatStale)
              ? 'Monitor needs attention'
              : !current
                ? 'Saving monitoring preferences…'
                : !current.config.enabled
                  ? 'Monitoring paused'
                  : current.plan
                    ? 'Monitoring independently of chat'
                    : 'Waiting for the next background check…'}
          </strong>
        </div>
        <p className="monitor-description">
          Checks every 5 seconds while the local server is running. Financial
          estimates use the fixed September 8 demo clock.
        </p>
        {current?.lastCheckedAt && (
          <p className="monitor-meta">
            Last checked{' '}
            {new Date(current.lastCheckedAt).toLocaleTimeString('en-US')} ·{' '}
            <span data-testid="monitor-check-count">{current.checkCount}</span>{' '}
            checks · {current.alerts.length} alert
            {current.alerts.length === 1 ? '' : 's'}
          </p>
        )}
        {(error || current?.error || heartbeatStale) && (
          <p role="alert" className="error-message">
            {error ||
              current?.error ||
              'The background check is overdue. Keep the local server running; funding proposals are unavailable until it checks again.'}
          </p>
        )}
        {settings.enabled && plan && (
          <div
            className={`funding-proposal ${plan.status}`}
            data-testid="funding-proposal"
            aria-live="polite"
          >
            <p className="eyebrow">
              {plan.status === 'proposed'
                ? 'FUNDING PROPOSAL · DEMO'
                : plan.status === 'pending_funding'
                  ? 'TRANSFER PENDING'
                  : plan.status === 'blocked'
                    ? 'ATTENTION NEEDED'
                    : 'NO FUNDING NEEDED'}
            </p>
            <h3 data-testid="proposal-title">
              {plan.status === 'proposed'
                ? `Set aside ${formatMoney(plan.amountCents)} for upcoming bills`
                : plan.status === 'pending_funding'
                  ? 'Your transfer is still pending'
                  : plan.status === 'blocked'
                    ? 'A funding proposal is unavailable'
                    : 'Your detected bills fit'}
            </h3>
            <p>{plan.reason}</p>
            {plan.status !== 'no_shortfall' && (
              <dl className="proposal-details">
                <div>
                  <dt>Projected shortage</dt>
                  <dd>{formatMoney(plan.amountCents)}</dd>
                </div>
                <div>
                  <dt>Needed before</dt>
                  <dd>
                    {plan.neededBefore
                      ? date(plan.neededBefore)
                      : 'Verify account data'}
                  </dd>
                </div>
                <div>
                  <dt>Estimated arrival</dt>
                  <dd>{date(plan.expectedArrival)}</dd>
                </div>
                <div>
                  <dt>Savings minimum</dt>
                  <dd>{formatMoney(plan.savingsMinimumCents)}</dd>
                </div>
                {plan.sourceAccountId && (
                  <>
                    <div>
                      <dt>From</dt>
                      <dd>
                        {
                          demo.snapshot.accounts.find(
                            (a) => a.id === plan.sourceAccountId,
                          )?.name
                        }
                      </dd>
                    </div>
                    <div>
                      <dt>To</dt>
                      <dd>
                        {
                          demo.snapshot.accounts.find(
                            (a) => a.id === plan.destinationAccountId,
                          )?.name
                        }
                      </dd>
                    </div>
                    <div>
                      <dt>Savings remaining after proposal</dt>
                      <dd>{formatMoney(plan.remainingSavingsCents!)}</dd>
                    </div>
                  </>
                )}
              </dl>
            )}
            {plan.status === 'proposed' && (
              <p className="proposal-note">
                <ShieldCheck size={16} /> Proposal only. Explicit approval is
                required unless you have enabled an automatic funding rule.
              </p>
            )}
            {plan.status !== 'no_shortfall' && (
              <p className="monitor-meta">
                Timing is simulated at{' '}
                {settings.timing === 'standard' ? '3' : '10'} weekdays,
                excluding weekends. Bank holidays, cutoffs and provider
                confirmation are not modeled.
              </p>
            )}
            {active && (
              <Button
                variant="outline"
                disabled={!!active.acknowledgedAt || ackBusy}
                onClick={() => {
                  void acknowledge();
                }}
              >
                {active.acknowledgedAt
                  ? 'Alert marked as read'
                  : 'Mark alert as read'}
              </Button>
            )}
          </div>
        )}
        {actionError && (
          <p className="error-message" role="alert">
            {actionError}
          </p>
        )}
        {current && (
          <TransferPanel
            state={{ ...current, plan: plan ?? null }}
            busy={busy || actionBusy}
            action={transferAction}
          />
        )}
        <details className="monitor-settings">
          <summary>Monitoring preferences</summary>
          <form onSubmit={save}>
            <div className="bill-fields">
              <label htmlFor="savings-minimum">
                Savings minimum ($)
                <Input
                  id="savings-minimum"
                  value={minimum}
                  onChange={(event) => setMinimum(event.target.value)}
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  required
                  disabled={busy}
                />
              </label>
              <label>
                Demo transfer timing
                <select
                  value={timing}
                  onChange={(event) =>
                    setTiming(event.target.value as FundingSettings['timing'])
                  }
                  disabled={busy}
                >
                  <option value="standard">Standard · 3 weekdays</option>
                  <option value="delayed">Delayed · 10 weekdays</option>
                </select>
              </label>
            </div>
            <Button type="submit" disabled={busy}>
              Save monitoring preferences
            </Button>
          </form>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              onSettings({ ...settings, enabled: !settings.enabled })
            }
          >
            {settings.enabled ? 'Pause monitoring' : 'Resume monitoring'}
          </Button>
          <p className="monitor-meta">
            Preferences do not authorize transfers. Each page gets a separate
            demo monitor, retained locally for 24 hours. Reload starts a fresh
            demo.
          </p>
        </details>
        {!!current?.alerts.length && (
          <details className="monitor-history">
            <summary>Alert history ({current.alerts.length})</summary>
            <ul>
              {current.alerts.map((alert) => (
                <li key={alert.id}>
                  <strong>
                    {alert.resolvedAt
                      ? 'Superseded'
                      : alert.acknowledgedAt
                        ? 'Read'
                        : 'New'}
                  </strong>{' '}
                  · {formatMoney(alert.plan.amountCents)} ·{' '}
                  {alert.plan.status === 'proposed'
                    ? 'Funding proposed'
                    : 'Needs attention'}
                  <span>
                    {new Date(alert.createdAt).toLocaleTimeString('en-US')}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="monitor-meta">
          Proposals use deterministic rules and synthetic data. Approval and
          settlement are separate steps.
        </p>
      </div>
    </section>
  );
}
