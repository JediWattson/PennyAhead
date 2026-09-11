export interface InvestmentPreferences {
  horizonYears: number;
  risk: 'cautious' | 'balanced' | 'growth' | 'unknown';
  reviewed: boolean;
}

/** Investment assets never enter the checking/savings forecast or contribution limit. */
export interface RothHoldings {
  status: 'observed' | 'unavailable' | 'not_connected';
  source: 'synthetic' | 'plaid_sandbox';
  retrievedAt: string;
  accounts: Array<{
    id: string;
    name: string;
    valueCents: number | null;
    holdings: Array<{
      id: string;
      name: string;
      ticker: string | null;
      valueCents: number;
      priceAsOf: string | null;
      cashEquivalent: boolean;
    }>;
  }>;
}

export interface InvestmentPlan {
  status: 'preview' | 'needs_review' | 'no_contribution';
  basis: 'proposed_roth_contribution';
  amountCents: number;
  title: string;
  explanation: string;
  preferences: InvestmentPreferences | null;
  allocations: Array<{
    label: string;
    percent: number;
    amountCents: number;
    exampleTicker: string;
    exampleName: string;
    sourceUrl: string;
  }>;
  holdings: RothHoldings | null;
  execution: 'not_connected';
}
