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
}
export interface BankSnapshot {
  source: DataSource;
  asOf: string;
  accounts: Account[];
  transactions: Transaction[];
}
export interface BankDataProvider {
  readonly source: DataSource;
  /** Scope comes from server context, never model input. */
  getSnapshot(ownerId: string): Promise<BankSnapshot>;
}
/** Reserved for M4. The interface does not itself enforce transfer authorization. */
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
  mode: 'mock';
  text: string;
  source: DataSource;
  asOf: string | null;
  /** Deterministic backend reads, not Strands/model tool calls. */
  reads: Array<'get_accounts' | 'get_transactions'>;
}
export interface Assistant {
  reply(ownerId: string, message: string): Promise<AssistantReply>;
}
