/** Money is always integer US cents. Dates are ISO 8601, in UTC. */
export type DataSource = 'synthetic' | 'plaid_sandbox';
export interface Account {
  id: string;
  ownerId: string;
  name: string;
  kind: 'checking' | 'savings';
  currency: 'USD';
  currentCents: number;
  availableCents: number;
  mask: string;
  observedAt: string;
}
export interface Transaction {
  id: string;
  accountId: string;
  merchant: string;
  /** Negative = debit; positive = credit. */
  amountCents: number;
  date: string;
  status: 'posted' | 'pending';
  pendingTransactionId?: string;
  /** Required for pending activity: whether the provider already reflected it in available funds. */
  availableBalanceEffect?: 'included' | 'excluded' | 'unknown';
}
export interface BankSnapshot {
  source: DataSource;
  asOf: string;
  accounts: Account[];
  transactions: Transaction[];
  /** Provider coverage is separate from balance freshness and bill detection. */
  coverage?: {
    totalAccounts: number;
    excludedAccounts: number;
    historyComplete: boolean;
    transactionsUpdatedAt: string | null;
    warnings: string[];
  };
}
export interface BankDataProvider {
  readonly source: DataSource;
  /** Scope comes from server context, never model input. */
  getSnapshot(ownerId: string): Promise<BankSnapshot>;
}
/** Server-bound approval. Concrete stores must independently enforce authorization. */
export interface ApprovedTransfer {
  approvalId: string;
  ownerId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountCents: number;
  currency: 'USD';
  idempotencyKey: string;
}
export interface TransferRecord {
  id: string;
  environment: 'local_simulation' | 'dwolla_sandbox';
  status: 'pending' | 'completed' | 'failed';
  approvedTransfer: ApprovedTransfer;
  estimatedArrival: string | null;
}
export interface TransferProvider {
  readonly environment: TransferRecord['environment'];
  createApprovedTransfer(transfer: ApprovedTransfer): Promise<TransferRecord>;
  getTransfer(ownerId: string, transferId: string): Promise<TransferRecord>;
}
export interface AssistantReply {
  mode: 'mock' | 'strands';
  provider?: 'openai' | 'bedrock';
  text: string;
  source: DataSource;
  asOf: string | null;
  /** Backend reads actually executed; live responses also include a tool trace. */
  reads: Array<
    | 'get_growth_plan'
    | 'get_accounts'
    | 'get_transactions'
    | 'get_forecast'
    | 'get_funding_proposal'
    | 'compare_funding_accounts'
    | 'check_transfer_timing'
  >;
  toolTrace?: Array<{ name: string; status: 'completed' }>;
}
export type DemoScenario =
  | 'growth'
  | 'shortfall'
  | 'sufficient'
  | 'uncertain'
  | 'stale';
export interface BillCorrection {
  billId: string;
  amountCents: number;
  nextDate: string;
  enabled: boolean;
}
export interface DemoOptions {
  scenario: DemoScenario;
  corrections: BillCorrection[];
}
export interface DetectedBill {
  id: string;
  accountId: string;
  merchant: string;
  amountCents: number;
  maximumCents: number;
  nextDate: string;
  earliestDate: string;
  latestDate: string;
  evidenceIds: string[];
  uncertain: boolean;
  corrected: boolean;
  enabled: boolean;
  overdue: boolean;
  pendingTransactionId: string | null;
}
export interface ForecastDay {
  date: string;
  balanceCents: number;
  cautiousBalanceCents: number;
  billIds: string[];
}
export interface ForecastReport {
  accountId: string;
  evaluatedAt: string;
  observedAt: string;
  ageHours: number;
  status: 'shortfall' | 'sufficient' | 'watch' | 'stale' | 'incomplete';
  startingCents: number;
  endingCents: number;
  minimumCents: number;
  shortageCents: number;
  firstShortfall: string | null;
  cautiousShortageCents: number;
  cautiousFirstShortfall: string | null;
  scheduledCents: number;
  bills: DetectedBill[];
  days: ForecastDay[];
  warnings: string[];
}
export interface DemoForecast extends DemoOptions {
  clock: 'fixed-demo' | 'provider-observation';
  /** Identifies an immutable, expiring Sandbox observation. Never a bank token. */
  snapshotId?: string;
  snapshot: BankSnapshot;
  forecast: ForecastReport;
}
export interface Assistant {
  reply(
    ownerId: string,
    message: string,
    options?: DemoOptions,
  ): Promise<AssistantReply>;
}

export interface MonitorConfig extends DemoOptions {
  enabled: boolean;
  savingsMinimumCents: number;
  timing: 'standard' | 'delayed';
}
export interface FundingCandidate {
  accountId: string;
  name: string;
  spendableCents: number;
  remainingCents: number;
  eligible: boolean;
  reason: string;
}
export interface FundingPlan {
  mode: 'deterministic-demo';
  status: 'proposed' | 'blocked' | 'no_shortfall' | 'pending_funding';
  reason: string;
  amountCents: number;
  sourceAccountId: string | null;
  destinationAccountId: string;
  expectedArrival: string;
  neededBefore: string | null;
  remainingSavingsCents: number | null;
  savingsMinimumCents: number;
  candidates: FundingCandidate[];
  forecastStatus: ForecastReport['status'];
}
export interface MonitorAlert {
  id: string;
  createdAt: string;
  resolvedAt: string | null;
  acknowledgedAt: string | null;
  plan: FundingPlan;
}
export interface MonitorState {
  id: string;
  revision: number;
  config: MonitorConfig;
  createdAt: string;
  expiresAt: string;
  nextRunAt: string;
  lastCheckedAt: string | null;
  checkCount: number;
  error: string | null;
  plan: FundingPlan | null;
  alerts: MonitorAlert[];
  proposalId: string | null;
  proposalStatus: 'open' | 'declined' | 'submitted' | null;
  transfers: SessionTransfer[];
  generation: number;
  rule: AutomationRule | null;
}

export interface SessionTransfer extends TransferRecord {
  generation: number;
  createdAt: string;
  updatedAt: string;
  initiatedBy: 'approval' | 'automation';
  execution: 'queued' | 'submitting' | 'uncertain' | 'submitted';
  providerId: string | null;
  failureReason: string | null;
  nextAttemptAt: string;
  attempts: number;
}
export interface AutomationRule {
  id: string;
  enabled: boolean;
  sourceAccountId: string;
  destinationAccountId: string;
  capCents: number;
  spentCents: number;
  savingsMinimumCents: number;
  createdAt: string;
  revokedAt: string | null;
}
export interface ApprovalInput {
  proposalId: string;
  revision: number;
  amountCents: number;
  sourceAccountId: string;
  destinationAccountId: string;
}
export interface MonitorView extends MonitorState {
  demo: DemoForecast;
  transferEnvironment: TransferRecord['environment'];
}
