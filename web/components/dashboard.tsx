'use client';

import { useEffect, useRef, useState, type SubmitEvent } from 'react';
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
import type { AssistantReply, BankSnapshot } from '../lib/contracts';
import { formatMoney } from '../lib/money';
import { registerAccountReader } from '../lib/webmcp';

type Message =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; reply?: AssistantReply };
const suggestions = [
  'What are my balances?',
  'Why is my available balance lower?',
  'Show recent transactions',
];

export function Dashboard({ snapshot }: { snapshot: BankSnapshot }) {
  useEffect(() => registerAccountReader(snapshot), [snapshot]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: 'Hi Alex. Let’s take a look at your accounts. Ask me about your balances or recent activity. I’m using mock responses and synthetic data for now.',
    },
  ]);

  async function ask(message: string) {
    if (inFlight.current || !message.trim()) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('The assistant could not answer.');
      const reply: AssistantReply = await response.json();
      setMessages((previous) => [
        ...previous,
        { role: 'user', text: message },
        { role: 'assistant', text: reply.text, reply },
      ]);
      setDraft('');
    } catch {
      setError(
        'The assistant could not answer. Your message is still here; please try again.',
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
          Synthetic demo
        </span>
      </header>
      <main id="main" className="workspace">
        <div className="page-heading">
          <div>
            <p className="eyebrow">YOUR MONEY, IN VIEW</p>
            <h1>
              Your accounts.
              <br />A little more clarity.
            </h1>
            <p className="intro">
              Welcome back, Alex. Here’s where your accounts stand.
            </p>
          </div>
          <div className="snapshot-note">
            <span className="status-dot" />
            Fixed demo snapshot
            <br />
            <strong>September 8, 2026 · 4:00 p.m. UTC</strong>
          </div>
        </div>
        <div className="dashboard-grid">
          <section className="overview" aria-label="Account overview">
            <div className="section-heading">
              <h2>Your accounts</h2>
              <span>2 synthetic accounts · USD</span>
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
                    <span>•• {account.mask}</span>
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
                The <strong>$30.50 pending debit</strong> is already included in
                your checking account’s available balance.
              </p>
            </div>
            <section className="activity" aria-labelledby="activity-heading">
              <div className="section-heading">
                <h2 id="activity-heading">Recent activity</h2>
                <span>Synthetic history</span>
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
                        · Checking
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
              <strong>Mock assistant</strong>
              <span>Scripted replies · No live AI connected</span>
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
                    {message.role === 'user' ? 'YOU' : 'PENNYAHEAD · MOCK'}
                  </span>
                  <p>{message.text}</p>
                  {message.role === 'assistant' &&
                  message.reply?.reads.length ? (
                    <span className="read-receipt">
                      <ShieldCheck size={13} /> Read synthetic{' '}
                      {message.reply.reads[0] === 'get_accounts'
                        ? 'account balances'
                        : 'transaction history'}{' '}
                      · Sep 8 snapshot
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
                    disabled={busy}
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
                  disabled={busy}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Ask about your accounts…"
                />
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Send message"
                  disabled={busy || !draft.trim()}
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
                Balances & activity now. Live Strands AI later.
              </p>
            </div>
          </aside>
        </div>
        <footer>
          <span>PennyAhead · Stay a step ahead of your bills.</span>
          <span>Demo only. No bank connections or money movement.</span>
        </footer>
      </main>
    </div>
  );
}
