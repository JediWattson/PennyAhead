'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { DemoForecast } from '../lib/contracts';
import { Dashboard } from './dashboard';
import { Button } from './ui/button';
import { PageLoading } from './page-loading';

export function SandboxDashboard({
  assistantProvider = 'mock',
}: {
  assistantProvider?: 'mock' | 'openai' | 'bedrock';
}) {
  const [demo, setDemo] = useState<DemoForecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setError(null);
      try {
        const response = await fetch('/api/sandbox', {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(40000),
          ]),
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? 'Plaid Sandbox could not be read.');
        setDemo(body);
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : 'Plaid Sandbox could not be read.',
          );
      }
    })();
    return () => controller.abort();
  }, [attempt]);
  if (demo)
    return (
      <Dashboard
        initialDemo={demo}
        assistantProvider={assistantProvider}
        sandboxAvailable
      />
    );
  if (!error) return <PageLoading />;
  return (
    <main className="workspace sandbox-loading">
      <p className="eyebrow">PENNYAHEAD · PLAID SANDBOX</p>
      <h1>Your test accounts.</h1>
      {error ? (
        <>
          <p className="error-message" role="alert">
            {error}
          </p>
          <Button onClick={() => setAttempt((value) => value + 1)}>
            Retry Sandbox connection
          </Button>
        </>
      ) : (
        <output>Reading test balances and transaction history…</output>
      )}
      <p>
        These are provider-generated test accounts. No real bank or money
        movement is connected.
      </p>
      <Link href="/">Open the synthetic demo</Link>
    </main>
  );
}
