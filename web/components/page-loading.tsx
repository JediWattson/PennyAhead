import { ArrowUpRight, LoaderCircle } from 'lucide-react';

export function PageLoading() {
  return (
    <main className="page-loading" aria-busy="true" data-testid="page-loading">
      <div className="brand loading-brand" aria-label="PennyAhead">
        <span className="brand-mark" aria-hidden="true">
          <ArrowUpRight size={32} />
        </span>
        <span>
          PennyAhead<span className="brand-dot">.</span>
        </span>
      </div>
      <output aria-label="Loading PennyAhead">
        <LoaderCircle
          className="spin loading-spinner"
          size={30}
          aria-hidden="true"
        />
        <span className="sr-only">Loading PennyAhead…</span>
      </output>
    </main>
  );
}
