export interface BrokerConnection {
  source: 'alpaca_sandbox';
  status:
    | 'not_configured'
    | 'needs_roth'
    | 'choose_account'
    | 'connected'
    | 'unavailable';
  message: string;
  observedAt: string | null;
  account: null | {
    mask: string;
    status: string;
    cashCents: number | null;
    portfolioValueCents: number | null;
  };
  execution: 'not_connected';
}
