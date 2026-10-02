import { ORIGEN_DISPLAY } from '@/config/display';
import { fraction, topWithOthers, type CandidateOrigenContext, type TopService } from '@/lib/serviceDimension';

const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

/** "N of M": shown only when filters hide part of the candidate. */
export function VisibleOfTotal({ context }: { context: CandidateOrigenContext }) {
  if (context.visibleCount >= context.totalCount) return null;
  return (
    <span className="text-card-foreground/50" title="Metrics shown are computed on the visible incidents only.">
      {context.visibleCount} of {context.totalCount} incidents of this problem visible with the current filters
    </span>
  );
}

function topServiceText(top: TopService, known: number): string | null {
  switch (top.state) {
    case 'NOT_AVAILABLE': return null;
    case 'NO_KNOWN_SERVICE': return 'No Service recorded';
    case 'SINGLE': return `Top Service: ${top.service} · ${pct(top.share)} of ${known} with a Service`;
    case 'TIE': {
      const names = top.services.slice(0, 3).join(', ') + (top.services.length > 3 ? ` (+${top.services.length - 3})` : '');
      return `Tied top Services: ${names} · ${pct(top.share)} each of ${known} with a Service`;
    }
  }
}

/** One compact line for cards and problem rows. */
export function ProblemOrigenLine({ context }: { context: CandidateOrigenContext }) {
  const top = topServiceText(context.topService, context.knownServiceCount);
  const parts = [
    top,
    context.topService.state === 'SINGLE' || context.topService.state === 'TIE'
      ? `${context.serviceCount} ${context.serviceCount === 1 ? 'Service' : 'Services'}` : null,
    `${context.distinctAssignmentGroups} ${context.distinctAssignmentGroups === 1 ? 'group' : 'groups'}`,
  ].filter(Boolean);
  return (
    <div className="text-[11px] leading-snug text-card-foreground/55 space-y-0.5">
      <div className="truncate">{parts.join(' · ')}</div>
      <VisibleOfTotal context={context} />
    </div>
  );
}

function Distribution({ title, rows, missing, missingLabel, denominator, note }: {
  title: string;
  rows: { value: string; count: number }[];
  missing: number;
  missingLabel: string;
  denominator: number;
  note?: string;
}) {
  return (
    <div>
      <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-2">{title}</div>
      {note && <div className="text-[11px] text-card-foreground/45 mb-1.5">{note}</div>}
      <div className="space-y-1">
        {rows.map(r => (
          <div key={r.value} className="flex justify-between gap-3 text-[13px]">
            <span className="text-card-foreground/70 truncate">{r.value}</span>
            <span className="font-mono text-card-foreground/50 shrink-0">{r.count} · {pct(fraction(r.count, denominator))}</span>
          </div>
        ))}
        {missing > 0 && (
          <div className="flex justify-between gap-3 text-[13px]">
            <span className="italic text-card-foreground/45">{missingLabel}</span>
            <span className="font-mono text-card-foreground/40 shrink-0">{missing}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Full Origen context for the problem modal. */
export function ProblemOrigenDetail({ context }: { context: CandidateOrigenContext }) {
  const available = context.topService.state !== 'NOT_AVAILABLE';
  const groups = context.serviceByGroup.columns;
  const servicesShown = topWithOthers(context.serviceByGroup.rows.filter(r => r.value !== null), ORIGEN_DISPLAY.matrixServices);

  return (
    <div className="space-y-4">
      <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50">Origen context</div>
      <div className="text-[12px] text-card-foreground/55 space-y-0.5">
        <div>Computed on the visible incidents of this problem.</div>
        <VisibleOfTotal context={context} />
      </div>
      {available ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Distribution
            title={`Services (${context.serviceCount})`}
            rows={context.services}
            missing={context.missingService}
            missingLabel="No Service"
            denominator={context.knownServiceCount}
            note={topServiceText(context.topService, context.knownServiceCount) ?? undefined}
          />
          {context.offerings && (
            <Distribution
              title={`Offerings (${context.offerings.length})`}
              rows={context.offerings}
              missing={context.missingOffering}
              missingLabel="No Offering"
              denominator={context.visibleCount - context.missingOffering}
            />
          )}
        </div>
      ) : (
        <div className="text-[13px] text-card-foreground/50">This file has no Service column.</div>
      )}

      <div>
        <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-2">Handled by Group</div>
        {available && (
          <div className="space-y-1 mb-2">
            {servicesShown.shown.map(row => {
              const n = [...row.cells.keys()].filter(k => k !== null).length;
              return (
                <div key={row.value} className="text-[12px] text-card-foreground/60">
                  The incidents associated with <span className="text-card-foreground/80">{row.value}</span> appear in {n} {n === 1 ? 'Assignment Group' : 'Assignment Groups'}:
                  {' '}{[...row.cells.entries()].sort((a, b) => b[1] - a[1]).map(([g, c]) => `${g ?? 'No assignment group'} (${c})`).join(', ')}
                </div>
              );
            })}
            {servicesShown.others && (
              <div className="text-[12px] italic text-card-foreground/45">…and {servicesShown.others.entries} more Services (display limit).</div>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {groups.map(g => (
            <span key={g.value ?? '__missing__'} className={`font-mono text-[11px] bg-card-foreground/5 border border-card-foreground/10 px-2 py-0.5 rounded ${g.value === null ? 'italic text-card-foreground/45' : 'text-card-foreground/70'}`}>
              {g.value ?? 'No assignment group'} · {g.incidents}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
