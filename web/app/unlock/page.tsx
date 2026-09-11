'use client';

import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { ArrowRight, LockKeyhole, Sprout } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ThemeSelector } from '../../components/theme-selector';

export default function UnlockPage() {
  const [token, setToken] = useState('');
  const linkedToken = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function unlock(value: string) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: value.trim() }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? 'Unable to unlock. Please try again.');
        setBusy(false);
        return;
      }
      window.location.replace('/');
    } catch {
      setError('Unable to connect. Please try again.');
      setBusy(false);
    }
  }

  useEffect(() => {
    // Fragments never reach HTTP logs. Remove the token before exchanging it for an HttpOnly cookie.
    const invitation =
      linkedToken.current ??
      new URLSearchParams(window.location.hash.slice(1)).get('token');
    linkedToken.current = invitation;
    if (window.location.hash) window.history.replaceState(null, '', '/unlock');
    if (!invitation) return;
    const timer = window.setTimeout(() => {
      void unlock(invitation);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void unlock(token);
  }

  return (
    <main className="invite-shell">
      <div className="invite-theme">
        <ThemeSelector />
      </div>
      <div className="brand">
        <span className="brand-mark">
          <Sprout size={24} />
        </span>
        PennyAhead
      </div>
      <section className="invite-card" aria-labelledby="invite-title">
        <span className="invite-icon">
          <LockKeyhole size={26} />
        </span>
        <p className="eyebrow">A private preview</p>
        <h1 id="invite-title">A step ahead starts here.</h1>
        <p className="invite-intro">
          Welcome, judges. Explore PennyAhead’s savings and retirement plans,
          with spending and bill protection built in.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="invite-token">Invitation token</label>
          <Input
            id="invite-token"
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={128}
            placeholder="Paste your invitation token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            disabled={busy}
            aria-describedby={error ? 'invite-error' : undefined}
            aria-invalid={!!error}
          />
          {error && (
            <p id="invite-error" className="invite-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? 'Unlocking…' : 'Unlock PennyAhead'}
            {!busy && <ArrowRight size={17} />}
          </Button>
        </form>
        <p className="invite-help">
          Have a private invitation link? Open it to unlock automatically.
          Otherwise, ask the PennyAhead team for access.
        </p>
      </section>
      <p className="invite-footnote">
        An interactive demo with test accounts. No real money moves.
      </p>
    </main>
  );
}
