import type { ReactNode } from 'react';

/** A fraction as a percentage, or an em dash when there is no population. */
export function Pct({ value }: { value: number | null }) {
  return <>{value === null ? '—' : `${(value * 100).toFixed(1)}%`}</>;
}

/** A dimension value, or its "no value" label styled so it never reads as a value. */
export function ValueLabel({ value, missing }: { value: string | null; missing: string }) {
  if (value === null) return <span className="italic text-card-foreground/50">{missing}</span>;
  return <>{value}</>;
}

/** The display-only "Others" bucket: always labelled with how much it groups. */
export function OthersLabel({ entries, noun }: { entries: number; noun: string }) {
  return (
    <span className="italic text-card-foreground/50" title="Display grouping only — not a value. Every entry is in the full table.">
      Others ({entries} {noun})
    </span>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-3 mb-3 flex-wrap">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-foreground/75">{title}</h3>
        {hint && <span className="text-[11px] text-foreground/70">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export function NotAvailable({ message }: { message: string }) {
  return (
    <div className="v1-card p-4 text-[13px] text-card-foreground/60">{message}</div>
  );
}

/** Page through a list at the configured page size. */
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-card-foreground/10 font-mono text-[11px] text-card-foreground/60">
      <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} className="px-2 disabled:opacity-30">‹ Prev</button>
      <span>{page + 1} / {pages}</span>
      <button type="button" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} className="px-2 disabled:opacity-30">Next ›</button>
    </div>
  );
}

export const thClass = 'px-3 py-2.5 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-card-foreground/50 whitespace-nowrap';
export const tdClass = 'px-3 py-2 text-[12px] text-card-foreground/80';
export const numClass = 'px-3 py-2 font-mono text-[12px] text-card-foreground/70 whitespace-nowrap';
