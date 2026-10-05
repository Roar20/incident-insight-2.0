import { useMemo, useState } from 'react';
import { useAppContext } from '@/context/AppContext';
import GlobalFilters from '@/components/GlobalFilters';
import { EmptyState, SectionTitle } from '@/components/ui/dashboard-primitives';
import { FAMILIES_COPY, FAMILIES_DISPLAY, FAMILIES_RESEARCH, familiesEnabled } from '@/config/families';
import { WEEKLY_COPY } from '@/config/weekly';
import { useIncidentFamilies } from '@/hooks/useIncidentFamilies';
import { weekLabel } from '@/lib/periods';
import { dimensionValue } from '@/lib/serviceDimension';
import { dataThrough, formatChange, formatDataThrough } from '@/lib/weeklyComposition';
import {
  familyIdentity, familyMembersInView, familyRows, thresholdRow, weeklyReconciliation, type FamilyRow,
} from '@/lib/families/view';
import type { TextVariant } from '@/lib/families/variants';
import { FlaskConical, X } from 'lucide-react';

/** Weeks of reconciliation shown up to the selected week, as Weekly Review's chart. */
const RECONCILIATION_WEEKS = 12;

const selectClass = 'bg-secondary border border-border rounded-md px-3 py-1.5 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary';
const labelClass = 'font-mono text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground';

function pct(share: number): string {
  return `${(Math.round(share * 1000) / 10).toFixed(1)}%`;
}

function typicalText(typical: number): string {
  const rounded = Math.round(typical * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function WeekCell({ row }: { row: FamilyRow }) {
  const w = row.week;
  if (w.typical === null) return <span className="text-card-foreground/50">{w.count} · no prior weeks</span>;
  if (w.newThisPeriod) return <span>{w.count} · {FAMILIES_COPY.newThisPeriod}</span>;
  return (
    <span>
      {w.count} incidents · {formatChange(w.change!)} vs typical {typicalText(w.typical)}
      {w.pct !== null && <span className="text-card-foreground/45 ml-1.5">({w.pct > 0 ? '+' : ''}{w.pct}%)</span>}
    </span>
  );
}

export default function FamiliesPage() {
  const {
    incidents, filteredIncidents, availableWeeks: weeks, selectedWeek, setSelectedWeek,
  } = useAppContext();
  const [variant, setVariant] = useState<TextVariant>(FAMILIES_DISPLAY.defaultVariant);
  const [tau, setTau] = useState<number>(FAMILIES_DISPLAY.defaultTau);
  const [threshold, setThreshold] = useState<number>(FAMILIES_DISPLAY.defaultThreshold);
  const [shown, setShown] = useState<number>(FAMILIES_DISPLAY.pageSize);
  const [openFamily, setOpenFamily] = useState<number | null>(null);

  // Families are computed once over the full loaded dataset; filters never reach the computation.
  const families = useIncidentFamilies(incidents, variant, tau);
  const through = useMemo(() => dataThrough(incidents), [incidents]);

  const ready = families.status === 'ready' ? families : null;
  const tIndex = ready ? ready.partitions.thresholds.indexOf(threshold) : -1;
  const labels = ready && tIndex >= 0 ? ready.partitions.labels[tIndex] : null;

  const explorer = useMemo(
    () => (ready ? ready.partitions.thresholds.map((s, i) => thresholdRow(s, ready.partitions.labels[i])) : []),
    [ready],
  );
  const identity = useMemo(() => (labels ? familyIdentity(incidents, labels) : null), [incidents, labels]);
  const rows = useMemo(
    () => (labels && identity ? familyRows(incidents, filteredIncidents, labels, identity, weeks, selectedWeek) : []),
    [incidents, filteredIncidents, labels, identity, weeks, selectedWeek],
  );
  const reconciliation = useMemo(() => {
    if (!labels) return [];
    const end = weeks.indexOf(selectedWeek) + 1 || weeks.length;
    return weeklyReconciliation(incidents, filteredIncidents, labels, weeks.slice(Math.max(0, end - RECONCILIATION_WEEKS), end));
  }, [incidents, filteredIncidents, labels, weeks, selectedWeek]);
  const members = useMemo(
    () => (labels && openFamily !== null ? familyMembersInView(incidents, filteredIncidents, labels, openFamily) : []),
    [incidents, filteredIncidents, labels, openFamily],
  );

  if (!familiesEnabled()) return <EmptyState message="This view is not available." />;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">{FAMILIES_COPY.title}</h1>
        <p className="text-[13px] text-muted-foreground mt-1">{FAMILIES_COPY.subtitle}</p>
      </div>
      <div className="flex items-start gap-2.5 mb-6 rounded-md border border-border bg-secondary px-4 py-3 text-[13px] text-foreground" role="note" data-testid="families-banner">
        <FlaskConical className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
        <span>{FAMILIES_COPY.banner}</span>
      </div>

      <GlobalFilters />

      <div className="flex flex-wrap items-end gap-4 mb-6">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Text variant</span>
          <select aria-label="Text variant" value={variant} onChange={e => { setVariant(e.target.value as TextVariant); setOpenFamily(null); }} className={selectClass}>
            {FAMILIES_RESEARCH.variants.map(v => <option key={v} value={v}>{FAMILIES_COPY.variantLabels[v]}</option>)}
          </select>
        </label>
        {variant !== 'R0' && (
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Template level τ</span>
            <select aria-label="Template level" value={tau} onChange={e => { setTau(Number(e.target.value)); setOpenFamily(null); }} className={selectClass}>
              {FAMILIES_RESEARCH.taus.map(t => <option key={t} value={t}>{t.toFixed(2)}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Similarity threshold</span>
          <select aria-label="Similarity threshold" value={threshold} onChange={e => { setThreshold(Number(e.target.value)); setOpenFamily(null); }} className={selectClass}>
            {FAMILIES_RESEARCH.thresholds.map(s => <option key={s} value={s}>{s.toFixed(1)}</option>)}
          </select>
        </label>
        {threshold === FAMILIES_DISPLAY.defaultThreshold && (
          <span className="text-[12px] text-muted-foreground pb-2" data-testid="default-label">{FAMILIES_COPY.defaultLabel}</span>
        )}
      </div>

      {families.status === 'too-large' && <EmptyState message={FAMILIES_COPY.tooLarge} />}
      {families.status === 'computing' && <EmptyState message="Computing families…" />}
      {families.status === 'error' && <EmptyState message={`Families could not be computed: ${families.message}`} />}

      {ready && labels && identity && (
        <>
          {!identity.numbersUnique && (
            <div className="mb-4 text-[12px] text-muted-foreground" data-testid="numbers-not-unique">{FAMILIES_COPY.numbersNotUnique}</div>
          )}

          <SectionTitle>Threshold explorer</SectionTitle>
          <div className="v1-card p-5 mb-6 overflow-x-auto">
            <table className="w-full text-[13px] text-card-foreground" data-testid="threshold-explorer">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-card-foreground/50">
                  <th className="py-1.5 pr-4">Threshold</th><th className="pr-4">Families ≥ 2</th><th className="pr-4">Families ≥ 5</th>
                  <th className="pr-4">Largest family share</th><th>% singletons</th>
                </tr>
              </thead>
              <tbody>
                {explorer.map(r => (
                  <tr key={r.threshold} className="border-t border-card-foreground/10 font-mono">
                    <td className="py-1.5 pr-4">{r.threshold.toFixed(1)}</td><td className="pr-4">{r.familiesGe2}</td><td className="pr-4">{r.familiesGe5}</td>
                    <td className="pr-4">{pct(r.largestShare)}</td><td>{pct(r.singletonShare)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[11px] text-card-foreground/50 mt-3">Full loaded file, {FAMILIES_COPY.variantLabels[variant]}{variant !== 'R0' ? `, τ ${tau.toFixed(2)}` : ''}. Filters do not change family membership. Computed in the browser in {Math.round(ready.elapsedMs)} ms.</div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className={labelClass}>Week of</span>
            <select aria-label="Week" value={selectedWeek} onChange={e => setSelectedWeek(e.target.value)} className={selectClass}>
              {[...weeks].reverse().map(w => <option key={w} value={w}>{weekLabel(w)}</option>)}
            </select>
            {through && (
              <span className="text-[12px] text-muted-foreground" data-testid="data-through" title={WEEKLY_COPY.dataThroughCaveat}>
                Data through {formatDataThrough(through)}
              </span>
            )}
          </div>

          <SectionTitle>Incidents per week in view</SectionTitle>
          <div className="v1-card p-5 mb-6 overflow-x-auto">
            <table className="w-full text-[13px] text-card-foreground" data-testid="weekly-reconciliation">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-card-foreground/50">
                  <th className="py-1.5 pr-4">Week</th><th className="pr-4">In families</th><th className="pr-4">Singletons</th><th>Incidents</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.map(r => (
                  <tr key={r.week} className="border-t border-card-foreground/10 font-mono">
                    <td className="py-1.5 pr-4">{weekLabel(r.week)}</td><td className="pr-4">{r.inFamilies}</td><td className="pr-4">{r.singletons}</td><td>{r.incidents}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SectionTitle>Incident Families · {rows.length} in view</SectionTitle>
          {rows.length === 0 ? (
            <EmptyState message="No family has incidents in this view." />
          ) : (
            <div className="v1-card p-5 overflow-x-auto">
              <table className="w-full text-[13px] text-card-foreground" data-testid="family-list">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-card-foreground/50">
                    <th className="py-1.5 pr-3">Family</th><th className="pr-3">Size</th><th className="pr-3">In view</th>
                    <th className="pr-3">Services</th><th className="pr-3">Offerings</th><th className="pr-3">Handled by</th>
                    <th className="pr-3">% No Service</th><th className="pr-3">Weeks present</th><th>{weekLabel(selectedWeek)}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, shown).map(r => (
                    <tr key={r.label} className="border-t border-card-foreground/10 align-top cursor-pointer hover:bg-card-foreground/5" onClick={() => setOpenFamily(r.label)} data-testid="family-row">
                      <td className="py-1.5 pr-3 font-mono font-bold">
                        {r.displayId}
                        {r.recurring && <span className="ml-2 font-normal text-[10px] uppercase tracking-wider text-card-foreground/50">{FAMILIES_COPY.recurring}</span>}
                      </td>
                      <td className="pr-3 font-mono">{r.size}</td><td className="pr-3 font-mono">{r.inView}</td>
                      <td className="pr-3 font-mono">{r.services}</td><td className="pr-3 font-mono">{r.offerings}</td><td className="pr-3 font-mono">{r.handledBy}</td>
                      <td className="pr-3 font-mono">{pct(r.noServiceShare)}</td><td className="pr-3 font-mono">{r.weeksPresent}</td>
                      <td className="font-mono text-[12px]"><WeekCell row={r} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > shown && (
                <button type="button" onClick={() => setShown(s => s + FAMILIES_DISPLAY.pageSize)} className="mt-3 font-mono text-[11px] px-2.5 py-1.5 rounded-md border border-border bg-secondary text-secondary-foreground">
                  Show more ({rows.length - shown} more)
                </button>
              )}
            </div>
          )}

          {openFamily !== null && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={() => setOpenFamily(null)}>
              <div className="v1-card w-full max-w-3xl max-h-[85vh] overflow-y-auto m-4 shadow-xl" onClick={e => e.stopPropagation()} data-testid="family-drilldown">
                <div className="flex items-center justify-between p-5 border-b border-card-foreground/10">
                  <h2 className="font-mono text-lg font-bold text-card-foreground">
                    {identity.displayIds.get(openFamily)} · {members.length} incidents in view
                  </h2>
                  <button onClick={() => setOpenFamily(null)} aria-label="Close" className="text-card-foreground/50 hover:text-card-foreground p-1"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-5 space-y-3">
                  {members.map((m, i) => (
                    <div key={i} className="border-t border-card-foreground/10 first:border-t-0 pt-3 first:pt-0">
                      <div className="font-mono text-[11px] text-card-foreground/50">
                        {m.Opened || 'No Opened date'} · Associated with {dimensionValue(m, 'service') ?? 'No Service'}
                        {' · '}{dimensionValue(m, 'serviceOffering') ?? 'No Service Offering'} · Handled by {dimensionValue(m, 'assignmentGroup') ?? 'No Handling Group'}
                      </div>
                      <div className="text-[13px] text-card-foreground font-medium mt-1">{m.shortDescClean || '(no short description)'}</div>
                      {m.descClean && <div className="text-[12px] text-card-foreground/70 mt-1 whitespace-pre-wrap line-clamp-4">{m.descClean}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
