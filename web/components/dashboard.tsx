'use client';

import Link from 'next/link';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SubmitEvent,
} from 'react';
import {
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  Wallet,
  Landmark,
  Sparkles,
  ShieldCheck,
  MessageCircle,
  LoaderCircle,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type {
  AssistantReply,
  DemoForecast,
  DemoOptions,
  DemoScenario,
  MonitorView,
} from '../lib/contracts';
import { formatMoney } from '../lib/money';
import { registerAccountReader } from '../lib/webmcp';
import { ForecastPanel } from './forecast-panel';
import { MonitorPanel, type FundingSettings } from './monitor-panel';

type Message =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; reply?: AssistantReply };
const suggestions = [
  'What are my balances?',
  'Why is my available balance lower?',
  'Show recent transactions',
  'Will my bills be covered?',
  'How can I cover the shortfall?',
];

export function Dashboard({
  initialDemo,
  assistantProvider = 'mock',
  sandboxAvailable = false,
}: {
  initialDemo: DemoForecast;
  assistantProvider?: 'mock' | 'openai' | 'bedrock';
  sandboxAvailable?: boolean;
}) {
  const [demo, setDemo] = useState(initialDemo);
  const [fundingSettings, setFundingSettings] = useState<FundingSettings>({
    enabled: true,
    savingsMinimumCents: 100000,
    timing: 'standard',
  });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const ledgerVersion = useRef<string | null>(null);
  const snapshot = demo.snapshot;
  const sandbox = snapshot.source === 'plaid_sandbox';
  const [forecastBusy, setForecastBusy] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const forecastInFlight = useRef(false);
  useEffect(() => registerAccountReader(snapshot), [snapshot]);
  const chatVersion = useRef(0);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: sandbox
        ? 'Your Plaid Sandbox test accounts are connected. Ask about the balances, forecast, or recent activity shown here. I use scripted replies; these are test records and no real money is connected.'
        : 'Hi Alex. Let’s take a look at your accounts. Ask me about your balances, bills, or recent activity. The accounts and money in this demo are synthetic.',
    },
  ]);

  const onSession = useCallback((state: MonitorView) => {
    const version = JSON.stringify([
      state.generation,
      state.transfers.map((t) => [t.id, t.status]),
    ]);
    if (ledgerVersion.current !== null && version !== ledgerVersion.current) {
      setMessages([]);
      chatVersion.current++;
    }
    ledgerVersion.current = version;
    setSessionId(state.id);
    setDemo((previous) =>
      previous.scenario === state.demo.scenario &&
      JSON.stringify(previous.corrections) ===
        JSON.stringify(state.demo.corrections)
        ? state.demo
        : previous,
    );
  }, []);

  async function ask(message: string) {
    if (inFlight.current || forecastInFlight.current || !message.trim()) return;
    const version = chatVersion.current;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        sandbox ? '/api/sandbox/assistant' : '/api/assistant',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(!sandbox && sessionId
              ? { Authorization: `Bearer ${sessionId}` }
              : {}),
          },
          body: JSON.stringify(
            sandbox
              ? {
                  message,
                  snapshotId: demo.snapshotId,
                  corrections: demo.corrections,
                }
              : {
                  message,
                  scenario: demo.scenario,
                  corrections: demo.corrections,
                  monitoring: fundingSettings,
                },
          ),
          signal: AbortSignal.timeout(35000),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? 'The assistant could not answer.');
      }
      const reply: AssistantReply = await response.json();
      if (version !== chatVersion.current) return;
      setMessages((previous) => [
        ...previous,
        { role: 'user', text: message },
        { role: 'assistant', text: reply.text, reply },
      ]);
      setDraft('');
    } catch (failure) {
      setError(
        sandbox && failure instanceof Error
          ? `${failure.message} Your message is still here.`
          : 'The assistant could not answer. Your message is still here; please try again.',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(draft);
  }
  async function changeDemo(options: DemoOptions): Promise<boolean> {
    if (inFlight.current || forecastInFlight.current) return false;
    forecastInFlight.current = true;
    setForecastBusy(true);
    setForecastError(null);
    try {
      const response = await fetch(sandbox ? '/api/sandbox' : '/api/forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          sandbox
            ? { snapshotId: demo.snapshotId, corrections: options.corrections }
            : options,
        ),
        signal: AbortSignal.timeout(35000),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? 'Invalid correction');
      }
      const next: DemoForecast = await response.json();
      setDemo(next);
      setMessages([]);
      setError(null);
      chatVersion.current++;
      return true;
    } catch (failure) {
      setForecastError(
        sandbox && failure instanceof Error
          ? `${failure.message} Your previous forecast is still shown.`
          : 'The forecast could not be updated. Check your dates and amounts, then try again. Your previous forecast is still shown.',
      );
      return false;
    } finally {
      forecastInFlight.current = false;
      setForecastBusy(false);
    }
  }

  async function refreshSandbox() {
    if (!sandbox || inFlight.current || forecastInFlight.current) return;
    forecastInFlight.current = true;
    setForecastBusy(true);
    setForecastError(null);
    try {
      const response = await fetch('/api/sandbox', {
        signal: AbortSignal.timeout(40000),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? 'Sandbox refresh failed.');
      setDemo(body);
      setMessages([]);
      setError(null);
      chatVersion.current++;
    } catch (failure) {
      setForecastError(
        `${failure instanceof Error ? failure.message : 'Sandbox refresh failed.'} The previous observation is still shown; it has not been refreshed.`,
      );
    } finally {
      forecastInFlight.current = false;
      setForecastBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="masthead">
        <a href="#main" className="brand">
          <span className="brand-mark">
            <ArrowUpRight size={25} />
          </span>
          PennyAhead<span className="brand-dot">.</span>
        </a>
        <span className="demo-chip">
          <span />
          {sandbox ? 'Plaid Sandbox' : 'Synthetic demo'}
        </span>
      </header>
      <main id="main" className="workspace">
        <div className="page-heading">
          <div>
            <p className="eyebrow">YOUR MONEY, IN VIEW</p>
            <h1>
              Your accounts.
              <br /> A little more clarity.
            </h1>
            <p className="intro">
              {sandbox
                ? 'Your connected test checking and savings, in one view.'
                : 'Welcome back, Alex. Here’s where your accounts stand.'}
            </p>
          </div>
          <div className="snapshot-note">
            <span className="status-dot" />
            {sandbox ? 'Balance observation' : 'Fixed demo clock'}
            <br />
            <strong>
              {sandbox
                ? `${snapshot.asOf.slice(0, 10)} · ${snapshot.asOf.slice(11, 16)} UTC`
                : 'September 8, 2026 · 4:00 p.m. UTC'}
            </strong>
          </div>
        </div>
        <div className="scenario-controls">
          {sandbox ? (
            <>
              <span>Provider-generated test data · Read-only</span>
              <Button
                variant="outline"
                disabled={busy || forecastBusy}
                onClick={() => {
                  void refreshSandbox();
                }}
              >
                Refresh Sandbox data
              </Button>
              <Link href="/">Synthetic demo</Link>
            </>
          ) : (
            <>
              <label htmlFor="scenario">Demo scenario</label>
              <select
                id="scenario"
                value={demo.scenario}
                disabled={busy || forecastBusy}
                onChange={(event) => {
                  void changeDemo({
                    scenario: event.target.value as DemoScenario,
                    corrections: [],
                  });
                }}
              >
                <option value="shortfall">Subscription shortfall</option>
                <option value="sufficient">Sufficient funds</option>
                <option value="uncertain">Uncertain payment dates</option>
                <option value="stale">Stale account data</option>
              </select>
              <span>All scenarios use synthetic data.</span>
              {sandboxAvailable && (
                <Link href="/sandbox">Plaid Sandbox accounts</Link>
              )}
            </>
          )}
          <a href="#assistant-heading">Ask assistant</a>
          {forecastBusy && <output>Updating forecast…</output>}
        </div>
        {sandbox && (
          <p className="sandbox-scope">
            Showing {snapshot.accounts.length} USD checking and savings accounts
            from {snapshot.coverage?.totalAccounts ?? snapshot.accounts.length}{' '}
            linked test accounts. Other account types and currencies are
            excluded. Reads are cached for one minute; refresh resets
            corrections and chat.
          </p>
        )}
        {forecastError && (
          <p className="error-message" role="alert">
            {forecastError}
          </p>
        )}
        <div className="dashboard-grid">
          <section className="overview" aria-label="Account overview">
            <div className="section-heading">
              <h2>Your accounts</h2>
              <span>
                {snapshot.accounts.length} {sandbox ? 'Sandbox' : 'synthetic'}{' '}
                accounts · USD
              </span>
            </div>
            <div className="account-grid">
              {snapshot.accounts.map((account) => (
                <article
                  key={account.id}
                  className={`account-card ${account.kind}`}
                >
                  <div className="account-top">
                    <span className="account-icon">
                      {account.kind === 'checking' ? (
                        <Wallet size={22} />
                      ) : (
                        <Landmark size={22} />
                      )}
                    </span>
                    <span>
                      {account.mask ? `•• ${account.mask}` : 'No mask provided'}
                    </span>
                  </div>
                  <h3>{account.name}</h3>
                  <p className="account-balance">
                    {formatMoney(account.availableCents)}
                  </p>
                  <p className="available-label">Available balance</p>
                  <div className="account-bottom">
                    <span>Current balance</span>
                    <strong>{formatMoney(account.currentCents)}</strong>
                  </div>
                </article>
              ))}
            </div>
            <div className="funds-note">
              <ShieldCheck size={20} />
              <p>
                {sandbox ? (
                  'Available balances come from Plaid Sandbox. Pending activity with an unknown effect on those balances is flagged in the forecast.'
                ) : (
                  <>
                    The <strong>$30.50 pending debit</strong> is already
                    included in your checking account’s available balance.
                  </>
                )}
              </p>
            </div>
            {sandbox ? (
              <div className="sandbox-transfer-note">
                <strong>Transfers are not connected</strong>
                <p>
                  This view reads Plaid test data. Automated monitoring and
                  approved provider transfers will be connected separately;
                  refreshing or chatting cannot move money.
                </p>
              </div>
            ) : (
              <MonitorPanel
                demo={demo}
                settings={fundingSettings}
                onSession={onSession}
                onSettings={(settings) => {
                  setFundingSettings(settings);
                  setMessages([]);
                }}
                busy={busy || forecastBusy}
              />
            )}
            <ForecastPanel
              demo={demo}
              busy={busy || forecastBusy}
              change={changeDemo}
            />
            <section className="activity" aria-labelledby="activity-heading">
              <div className="section-heading">
                <h2 id="activity-heading">Recent activity</h2>
                <span>
                  {sandbox ? 'Plaid Sandbox history' : 'Synthetic history'}
                </span>
              </div>
              <ul className="transaction-list">
                {snapshot.transactions.slice(0, 6).map((transaction) => (
                  <li key={transaction.id}>
                    <span
                      className={`transaction-icon ${transaction.amountCents > 0 ? 'credit' : ''}`}
                    >
                      {transaction.amountCents > 0 ? (
                        <ArrowDownLeft size={20} />
                      ) : (
                        <ArrowUpRight size={20} />
                      )}
                    </span>
                    <div className="transaction-description">
                      <strong>{transaction.merchant}</strong>
                      <span>
                        {new Intl.DateTimeFormat('en-US', {
                          month: 'short',
                          day: 'numeric',
                          timeZone: 'UTC',
                        }).format(new Date(transaction.date))}{' '}
                        ·{' '}
                        {snapshot.accounts.find(
                          (account) => account.id === transaction.accountId,
                        )?.name ?? 'Account'}
                      </span>
                    </div>
                    <div className="transaction-amount">
                      <strong>
                        {transaction.amountCents > 0 ? '+' : ''}
                        {formatMoney(transaction.amountCents)}
                      </strong>
                      <span
                        className={
                          transaction.status === 'pending'
                            ? 'pending-label'
                            : ''
                        }
                      >
                        {transaction.status === 'pending'
                          ? 'Pending'
                          : 'Posted'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </section>
          <aside
            className="assistant-panel"
            aria-labelledby="assistant-heading"
          >
            <div className="assistant-heading">
              <span className="assistant-icon">
                <Sparkles size={20} />
              </span>
              <div>
                <h2 id="assistant-heading">A little help, right here</h2>
                <p>Your PennyAhead assistant</p>
              </div>
            </div>
            <div className="mock-notice">
              <strong>
                {assistantProvider === 'mock'
                  ? 'Mock assistant'
                  : 'Strands assistant'}
              </strong>
              <span>
                {assistantProvider === 'mock'
                  ? 'Scripted replies · No live AI connected'
                  : `Read-only AI via ${assistantProvider === 'openai' ? 'OpenAI' : 'Amazon Bedrock'} · Synthetic data`}
              </span>
            </div>
            <div
              className="conversation"
              role="log"
              aria-label="Assistant conversation"
              aria-live="polite"
            >
              {messages.map((message, index) => (
                <article className={`chat-message ${message.role}`} key={index}>
                  <span className="message-label">
                    {message.role === 'user'
                      ? 'YOU'
                      : message.reply?.mode === 'strands'
                        ? 'PENNYAHEAD · STRANDS'
                        : assistantProvider === 'mock'
                          ? 'PENNYAHEAD · MOCK'
                          : 'PENNYAHEAD'}
                  </span>
                  <p>{message.text}</p>
                  {message.role === 'assistant' &&
                  message.reply?.toolTrace?.length ? (
                    <details className="read-receipt">
                      <summary>
                        Executed tools ({message.reply.toolTrace.length})
                      </summary>
                      {message.reply.toolTrace.map((entry, n) => (
                        <div key={n}>
                          {entry.name} · {entry.status}
                        </div>
                      ))}
                    </details>
                  ) : null}
                  {message.role === 'assistant' &&
                  message.reply?.reads.length ? (
                    <span className="read-receipt">
                      <ShieldCheck size={13} /> Read{' '}
                      {message.reply.source === 'plaid_sandbox'
                        ? 'Plaid Sandbox'
                        : 'synthetic'}{' '}
                      {message.reply.reads[0] === 'get_funding_proposal'
                        ? 'funding proposal'
                        : message.reply.reads[0] === 'get_forecast'
                          ? 'balance forecast'
                          : message.reply.reads[0] === 'get_accounts'
                            ? 'account balances'
                            : 'transaction history'}{' '}
                      · {message.reply.asOf?.slice(0, 10)} snapshot
                    </span>
                  ) : null}
                </article>
              ))}
              {busy && (
                <output className="busy-note">
                  <LoaderCircle size={16} className="spin" /> Reading your demo
                  data…
                </output>
              )}
            </div>
            <div className="assistant-controls">
              <p className="suggestion-label">TRY ASKING</p>
              <div className="suggestions">
                {suggestions.map((suggestion) => (
                  <Button
                    key={suggestion}
                    variant="outline"
                    className="suggestion"
                    disabled={busy || forecastBusy}
                    onClick={() => {
                      setDraft(suggestion);
                      void ask(suggestion);
                    }}
                  >
                    {suggestion}
                    <ArrowRight size={15} />
                  </Button>
                ))}
              </div>
              <form onSubmit={submit} className="composer">
                <label className="sr-only" htmlFor="question">
                  Ask about your demo accounts
                </label>
                <Input
                  id="question"
                  value={draft}
                  maxLength={1000}
                  disabled={busy || forecastBusy}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Ask about your accounts…"
                />
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Send message"
                  disabled={busy || forecastBusy || !draft.trim()}
                >
                  <ArrowRight size={20} />
                </Button>
              </form>
              {error && (
                <p role="alert" className="error-message">
                  {error}
                </p>
              )}
              <p className="assistant-footnote">
                <MessageCircle size={13} />
                Balances, bills & forecasts ·{' '}
                {assistantProvider === 'mock'
                  ? 'Mock assistant'
                  : 'Strands assistant'}
              </p>
            </div>
          </aside>
        </div>
        <footer>
          <span>PennyAhead · Stay a step ahead of your bills.</span>
          <span>
            {sandbox
              ? 'Plaid Sandbox test data · No real bank connected · Read-only'
              : 'Synthetic demo · Transfers are labeled by their actual environment.'}
          </span>
        </footer>
      </main>
    </div>
  );
}
