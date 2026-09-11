'use client';

import { useEffect, useRef, useState } from 'react';
import type { BrokerConnection } from '../lib/broker-contracts';
import { formatMoney } from '../lib/money';
import { Button } from './ui/button';

export function BrokerConnectionPanel({
  sessionId,
  snapshotId,
}: {
  sessionId: string | null;
  snapshotId?: string;
}) {
  const [result, setResult] = useState<{
    key: string;
    connection?: BrokerConnection;
    error?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const key = JSON.stringify({ sessionId, snapshotId });
  useEffect(() => () => controller.current?.abort(), [key]);
  const current = result?.key === key ? result : null;
  async function check() {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch('/api/broker', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(!snapshotId ? { Authorization: `Bearer ${sessionId}` } : {}),
        },
        body: JSON.stringify(snapshotId ? { snapshotId } : {}),
        signal: AbortSignal.any([active.signal, AbortSignal.timeout(35000)]),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? 'Unable to check the brokerage.');
      if (!active.signal.aborted) setResult({ key, connection: body });
    } catch (error) {
      if (!active.signal.aborted)
        setResult({
          key,
          error:
            error instanceof Error
              ? error.message
              : 'Unable to check the brokerage.',
        });
    } finally {
      if (controller.current === active) setLoading(false);
    }
  }
  const connection = current?.connection;
  return (
    <div className="broker-connection" data-testid="broker-connection">
      <h4>Brokerage connection</h4>
      <p>
        Connect a test Roth with Alpaca Sandbox. This connection check reads
        account data; it does not create a contribution or order.
      </p>
      <Button
        variant="outline"
        disabled={loading || (!sessionId && !snapshotId)}
        onClick={() => void check()}
      >
        {loading ? 'Checking Alpaca…' : 'Check Alpaca connection'}
      </Button>
      {connection && (
        <div>
          <output className="broker-status">{connection.message}</output>
          {connection.account && (
            <div className="investment-account">
              <div>
                <strong>
                  Alpaca test Roth{' '}
                  {connection.account.mask
                    ? `··${connection.account.mask}`
                    : ''}
                </strong>
                <span>{connection.account.status}</span>
              </div>
              <div>
                <span>Cash reported by Alpaca</span>
                <span>
                  {connection.account.cashCents === null
                    ? 'Unavailable'
                    : formatMoney(connection.account.cashCents)}
                </span>
              </div>
              <div>
                <span>Portfolio value</span>
                <span>
                  {connection.account.portfolioValueCents === null
                    ? 'Unavailable'
                    : formatMoney(connection.account.portfolioValueCents)}
                </span>
              </div>
              <p>
                These balances are separate from your contribution preview and
                are not a settled-cash or order approval check.
              </p>
            </div>
          )}
          {connection.observedAt && (
            <small>
              Checked {new Date(connection.observedAt).toLocaleString('en-US')}{' '}
              · Sandbox only
            </small>
          )}
        </div>
      )}
      {current?.error && (
        <p role="alert">
          {current.error} Previous brokerage observations are hidden.
        </p>
      )}
    </div>
  );
}
