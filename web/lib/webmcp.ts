import type { BankSnapshot } from './contracts';

interface ModelContext {
  registerTool(
    tool: {
      name: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute(input: unknown): unknown;
    },
    options: { signal: AbortSignal },
  ): void | Promise<void>;
}

/** Optional browser capability. Ordinary browsers need no polyfill. */
export function registerAccountReader(snapshot: BankSnapshot): () => void {
  const context = (document as Document & { modelContext?: ModelContext })
    .modelContext;
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  try {
    void Promise.resolve(
      context.registerTool(
        {
          name: 'read_demo_accounts',
          description:
            'Read the synthetic account balances displayed in PennyAhead. No real bank connection or live model is involved.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute(input: unknown) {
            if (
              !input ||
              typeof input !== 'object' ||
              Array.isArray(input) ||
              Object.keys(input).length
            ) {
              throw new Error('This read takes an empty object.');
            }
            return {
              source: snapshot.source,
              asOf: snapshot.asOf,
              accounts: structuredClone(snapshot.accounts),
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => lifecycle.abort());
  } catch {
    lifecycle.abort();
  }
  return () => lifecycle.abort();
}
