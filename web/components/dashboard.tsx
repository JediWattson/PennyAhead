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
  RefreshCw,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import type {
  AssistantReply,
  DemoForecast,
  DemoOptions,
  DemoScenario,
  MonitorView,
} from '../lib/contracts';
import { formatMoney } from '../lib/money';
import { registerAccountReader } from '../lib/webmcp';
import { GrowthPanel } from './growth-panel';
import {
  initialGrowthInputs,
  type GrowthInputs,
} from '../lib/growth-contracts';
import { growthContext } from '../lib/growth-context';
import { ForecastPanel } from './forecast-panel';
import { MonitorPanel, type FundingSettings } from './monitor-panel';

type Message =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; reply?: AssistantReply };
const suggestions = [
  'How much can I save or invest?',
  'What are my balances?',
  'When is my next paycheck?',
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
  const [growthInputs, setGrowthInputs] = useState<GrowthInputs>(() =>
    initialGrowthInputs(
      initialDemo.snapshot.source,
      initialDemo.sampleRothProfile,
    ),
  );
  const [fundingSettings, setFundingSettings] = useState<FundingSettings>({
    enabled: true,
    savingsMinimumCents: 100000,
    timing: 'standard',
  });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionContext, setSessionContext] = useState('');
  const ledgerVersion = useRef<string | null>(null);
  const snapshot = demo.snapshot;
  const [selectedAccountId, setSelectedAccountId] = useState(
    initialDemo.snapshot.accounts[0]?.id,
  );
  const selectedAccount =
    snapshot.accounts.find((account) => account.id === selectedAccountId) ??
    snapshot.accounts[0];
  const accountTransactions = snapshot.transactions
    .filter((transaction) => transaction.accountId === selectedAccount?.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const sandbox = snapshot.source === 'plaid_sandbox';
  const demoSessionReady =
    sandbox ||
    (!!sessionId &&
      sessionContext ===
        growthContext(demo, fundingSettings.savingsMinimumCents));
  const [forecastBusy, setForecastBusy] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const forecastInFlight = useRef(false);
  useEffect(() => registerAccountReader(snapshot), [snapshot]);
  const chatVersion = useRef(0);
  const [draft, setDraft] = useState('');
  const conversationRef = useRef<HTMLDivElement>(null);
  const assistantRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: sandbox
        ? `Your Plaid Sandbox test accounts are connected. Ask about saving and investing, balances, forecasts, or recent activity. I start with a spending estimate from your transactions and adjustable savings targets. ${initialDemo.sampleRothProfile ? 'This demo uses Alex’s labeled sample Roth profile.' : 'Roth eligibility details need your input.'} I use scripted replies; these are test records and no real money is connected.`
        : 'Hi Alex. Let’s make room for your savings and retirement goals while protecting the money you need for spending. Ask me to explain your Save and invest plan, your balances, or upcoming bills. This demo uses synthetic accounts and a sample financial profile.',
    },
  ]);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    const panel = assistantRef.current;
    if (!panel) return;
    const desktop = window.matchMedia('(min-width: 781px)');
    let frame = 0;
    const resize = () => {
      frame = 0;
      if (!desktop.matches) {
        panel.style.removeProperty('--chat-panel-height');
        return;
      }
      const top = Math.max(20, panel.getBoundingClientRect().top);
      const height = `${Math.max(0, Math.floor(window.innerHeight - top - 20))}px`;
      if (panel.style.getPropertyValue('--chat-panel-height') === height)
        return;
      const conversation = conversationRef.current;
      const atBottom =
        conversation &&
        conversation.scrollHeight -
          conversation.clientHeight -
          conversation.scrollTop <
          24;
      panel.style.setProperty('--chat-panel-height', height);
      if (conversation && atBottom)
        conversation.scrollTop = conversation.scrollHeight;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(resize);
    };
    const observer = new ResizeObserver(schedule);
    if (panel.parentElement) observer.observe(panel.parentElement);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    desktop.addEventListener('change', schedule);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      desktop.removeEventListener('change', schedule);
    };
  }, []);

  const onSession = useCallback(
    (state: MonitorView) => {
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
      setSessionContext(
        growthContext(state.demo, state.config.savingsMinimumCents),
      );
      setDemo((previous) =>
        previous.scenario === state.demo.scenario &&
        JSON.stringify(previous.corrections) ===
          JSON.stringify(state.demo.corrections)
          ? state.demo
          : previous,
      );
    },
    [setMessages],
  );

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
                  growth: growthInputs,
                }
              : {
                  message,
                  scenario: demo.scenario,
                  corrections: demo.corrections,
                  monitoring: fundingSettings,
                  growth: growthInputs,
                  growthContext: growthContext(
                    demo,
                    fundingSettings.savingsMinimumCents,
                  ),
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
      <main
        id="main"
        className={`workspace${sandbox ? ' sandbox-workspace' : ''}`}
      >
        <div className="page-heading">
          <div>
            <p className="eyebrow">
              {sandbox ? 'YOUR MONEY, IN VIEW' : 'YOUR NEXT STEP, IN REACH'}
            </p>
            {sandbox ? (
              <h1 className="sr-only">Your finances</h1>
            ) : (
              <>
                <h1>
                  A little saved.
                  <br /> A future built.
                </h1>
                <p className="intro">
                  Turn money left after spending into progress toward your
                  savings and retirement goals.
                </p>
              </>
            )}
          </div>
        </div>
        {!sandbox && (
          <div className="scenario-controls">
            <label htmlFor="scenario">Demo scenario</label>
            <select
              id="scenario"
              value={demo.scenario}
              disabled={busy || forecastBusy || !demoSessionReady}
              onChange={(event) => {
                void changeDemo({
                  scenario: event.target.value as DemoScenario,
                  corrections: [],
                });
              }}
            >
              <option value="growth">Save and invest</option>
              <option value="shortfall">Subscription shortfall</option>
              <option value="sufficient">Sufficient funds</option>
              <option value="uncertain">Uncertain payment dates</option>
              <option value="stale">Stale account data</option>
            </select>
            <span>All scenarios use synthetic data.</span>
            {sandboxAvailable && (
              <Link href="/sandbox">Plaid Sandbox accounts</Link>
            )}
            <a href="#assistant-heading">Ask assistant</a>
            {forecastBusy && <output>Updating forecast…</output>}
          </div>
        )}
        {forecastError && (
          <p className="error-message" role="alert">
            {forecastError}
          </p>
        )}
        <div className="dashboard-grid">
          <Tabs defaultValue="activity" className="overview detail-tabs">
            <TabsList
              className="detail-tab-list"
              aria-label="Dashboard details"
            >
              <TabsTrigger value="activity">Overview</TabsTrigger>
              <TabsTrigger value="growth">Save &amp; invest</TabsTrigger>
              <TabsTrigger value="bills">Bills</TabsTrigger>
            </TabsList>
            <TabsContent value="activity" className="detail-panel" keepMounted>
              <div className="section-heading">
                <h2>Your accounts</h2>
                <div className="account-heading-actions">
                  <span>
                    {snapshot.accounts.length}{' '}
                    {sandbox ? 'Sandbox' : 'synthetic'} accounts · USD
                  </span>
                  {sandbox && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Refresh Sandbox data"
                      title="Refresh Sandbox data"
                      disabled={busy || forecastBusy || !demoSessionReady}
                      onClick={() => {
                        void refreshSandbox();
                      }}
                    >
                      <RefreshCw
                        className={forecastBusy ? 'animate-spin' : ''}
                      />
                    </Button>
                  )}
                </div>
              </div>
              <div className="account-grid">
                {snapshot.accounts.map((account) => (
                  <article
                    key={account.id}
                    className={`account-card ${account.kind} ${selectedAccount?.id === account.id ? 'selected' : ''}`}
                  >
                    <button
                      type="button"
                      className="account-select"
                      aria-label={`Show activity for ${account.name}${account.mask ? ` ending in ${account.mask}` : ''}`}
                      aria-pressed={selectedAccount?.id === account.id}
                      aria-controls="account-activity"
                      onClick={() => setSelectedAccountId(account.id)}
                    />
                    <div className="account-top">
                      <span className="account-icon">
                        {account.kind === 'checking' ? (
                          <Wallet size={22} />
                        ) : (
                          <Landmark size={22} />
                        )}
                      </span>
                      <span>
                        {account.mask
                          ? `•• ${account.mask}`
                          : 'No mask provided'}
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
                    <span className="account-activity-label" aria-hidden="true">
                      {selectedAccount?.id === account.id
                        ? 'Showing activity'
                        : 'View activity'}
                      <ArrowRight size={14} />
                    </span>
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
              <section
                id="account-activity"
                className="activity"
                aria-labelledby="activity-heading"
              >
                <div className="section-heading">
                  <h2 id="activity-heading">Recent activity</h2>
                  <span>
                    {sandbox ? 'Plaid Sandbox history' : 'Synthetic history'}
                  </span>
                </div>
                <output className="activity-account">
                  {selectedAccount?.name ?? 'No account selected'}
                  {selectedAccount?.mask ? ` · •• ${selectedAccount.mask}` : ''}
                </output>
                {accountTransactions.length === 0 ? (
                  <p className="activity-empty">
                    No transactions for this account in the loaded history.
                  </p>
                ) : (
                  <ul className="transaction-list">
                    {accountTransactions.slice(0, 6).map((transaction) => (
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
                )}
              </section>
            </TabsContent>
            <TabsContent value="growth" className="detail-panel" keepMounted>
              <GrowthPanel
                demo={demo}
                inputs={growthInputs}
                savingsMinimumCents={
                  sandbox ? 0 : fundingSettings.savingsMinimumCents
                }
                sessionId={demoSessionReady ? sessionId : null}
                busy={busy || forecastBusy}
                onChange={(next) => {
                  setGrowthInputs(next);
                  setMessages([]);
                  chatVersion.current++;
                }}
                onAsk={() => {
                  document
                    .getElementById('assistant-heading')
                    ?.scrollIntoView({ block: 'start' });
                  void ask('Explain my savings and Roth plan');
                }}
              />
            </TabsContent>
            <TabsContent value="bills" className="detail-panel" keepMounted>
              {sandbox ? (
                <section
                  className="bill-suggestion"
                  aria-labelledby="bill-suggestion-heading"
                  aria-busy={forecastBusy}
                >
                  <p className="eyebrow">A SUGGESTED NEXT STEP</p>
                  <h2 id="bill-suggestion-heading">
                    {demo.billSuggestion?.title ?? 'Review your bill forecast'}
                  </h2>
                  <p>
                    {demo.billSuggestion?.explanation ??
                      'Ask the assistant to explain the upcoming bills and your options for covering them.'}
                  </p>
                  <p className="bill-suggestion-boundary">
                    You decide what to do in your bank app. This suggestion
                    moves no money and pays no bills.
                  </p>
                  <Button
                    variant="outline"
                    disabled={busy || forecastBusy}
                    onClick={() => {
                      document
                        .getElementById('assistant-heading')
                        ?.scrollIntoView({ block: 'start' });
                      void ask('How can I cover upcoming bills?');
                    }}
                  >
                    Explain this suggestion
                  </Button>
                </section>
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
            </TabsContent>
          </Tabs>
          <aside
            ref={assistantRef}
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
              ref={conversationRef}
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
                      {message.reply.reads[0] === 'get_growth_plan'
                        ? 'savings and Roth plan'
                        : message.reply.reads[0] === 'get_funding_proposal'
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
                    disabled={busy || forecastBusy || !demoSessionReady}
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
                  disabled={busy || forecastBusy || !demoSessionReady}
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
          <span>PennyAhead · A little saved. A future built.</span>
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
