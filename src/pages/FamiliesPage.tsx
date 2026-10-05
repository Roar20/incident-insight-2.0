import { useMemo, useState } from 'react';
import { useAppContext } from '@/context/AppContext';
import GlobalFilters from '@/components/GlobalFilters';
import { EmptyState } from '@/components/ui/dashboard-primitives';
import { FAMILIES_COPY, FAMILIES_DISPLAY, FAMILIES_RESEARCH, familiesEnabled } from '@/config/families';
import { WEEKLY_COPY } from '@/config/weekly';
import { useIncidentFamilies } from '@/hooks/useIncidentFamilies';
import { weekLabel } from '@/lib/periods';
import { dimensionValue } from '@/lib/serviceDimension';
import { dataThrough, formatDataThrough } from '@/lib/weeklyComposition';
import { thresholdRow } from '@/lib/families/view';
import { buildVariant, openTimeText, type TextVariant } from '@/lib/families/variants';
import {
  breakdown, calendarWeeks, factLine, formatCount, groupCards, groupIdentity, groupTexts,
  membersNewestFirst, weekRangeText, weekSummary, wholePct, type GroupCard, type TopShare,
} from '@/lib/families/presentation';
import type { AnnotatedIncident } from '@/lib/problems';
import { BarChart, Bar, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronRight, FlaskConical, X } from 'lucide-react';

type Strictness = keyof typeof FAMILIES_DISPLAY.strictness;

const NEUTRAL = 'hsl(215,14%,72%)';
const ACCENT = 'hsl(209,96%,35%)';
const selectClass = 'bg-secondary border border-border rounded-md px-3 py-1.5 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary';
const labelClass = 'font-mono text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground';

function shareText(share: TopShare, missing: string): string {
  if (share.value === null) return missing;
  return `${share.value} (${share.pct}%)${share.mixed ? ` · ${FAMILIES_COPY.mixed}` : ''}`;
}

/** Weekly counts as small bars; the selected week in the accent colour. */
function Sparkline({ series, selected }: { series: number[]; selected: number }) {
  const max = Math.max(1, ...series);
  const w = 3;
  const gap = 1;
  const h = 24;
  return (
    <svg viewBox={`0 0 ${series.length * (w + gap)} ${h}`} preserveAspectRatio="none" height={h} style={{ width: '100%', maxWidth: series.length * (w + gap) }}
      role="img" aria-label="Incidents per week" data-testid="sparkline" data-weeks={series.length}>
      {series.map((v, i) => {
        const bh = v === 0 ? 1 : Math.max(2, (v / max) * h);
        return <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh} fill={i === selected ? ACCENT : NEUTRAL} />;
      })}
    </svg>
  );
}

function IncidentLine({ inc }: { inc: AnnotatedIncident }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-card-foreground/10 first:border-t-0 py-2.5">
      <div className="font-mono text-[11px] text-card-foreground/50">
        {inc.Opened ? inc.Opened.slice(0, 16) : 'No date'} · {dimensionValue(inc, 'service') ?? FAMILIES_COPY.noService} · Handled by {dimensionValue(inc, 'assignmentGroup') ?? FAMILIES_COPY.noHandlingGroup}
      </div>
      <button type="button" onClick={() => setOpen(o => !o)} className="text-left text-[13px] text-card-foreground font-medium mt-0.5 flex items-start gap-1" disabled={!inc.descClean}>
        {inc.descClean && (open ? <ChevronDown className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />)}
        <span>{inc.shortDescClean || '(no short description)'}</span>
      </button>
      {open && inc.descClean && <div className="text-[12px] text-card-foreground/70 mt-1 whitespace-pre-wrap pl-4">{inc.descClean}</div>}
    </div>
  );
}

export default function FamiliesPage() {
  const { incidents, filteredIncidents, availableWeeks: weeks, selectedWeek, setSelectedWeek } = useAppContext();
  const [strictness, setStrictness] = useState<Strictness>('balanced');
  const [variant, setVariant] = useState<TextVariant>(FAMILIES_DISPLAY.defaultVariant);
  const [tau, setTau] = useState<number>(FAMILIES_DISPLAY.defaultTau);
  const [showAll, setShowAll] = useState(false);
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [oneOffOpen, setOneOffOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Groups are built once over the full loaded file; filters never reach the computation.
  const groups = useIncidentFamilies(incidents, variant, tau);
  const through = useMemo(() => dataThrough(incidents), [incidents]);
  const threshold = FAMILIES_DISPLAY.strictness[strictness];
  const ready = groups.status === 'ready' ? groups : null;
  const labels = ready ? ready.partitions.labels[ready.partitions.thresholds.indexOf(threshold)] : null;

  // The same text the groups were built from, for naming them.
  const docs = useMemo(
    () => (ready ? buildVariant(incidents.map(i => openTimeText(i.shortDescClean, i.descClean)), { variant, tau: variant === 'R0' ? undefined : tau }) : null),
    [ready, incidents, variant, tau],
  );
  const identity = useMemo(() => (labels ? groupIdentity(incidents, labels) : null), [incidents, labels]);
  const texts = useMemo(() => (labels && docs ? groupTexts(incidents, docs, labels) : null), [incidents, docs, labels]);
  const summary = useMemo(() => (labels ? weekSummary(incidents, filteredIncidents, labels, selectedWeek) : null), [incidents, filteredIncidents, labels, selectedWeek]);
  const cards = useMemo(
    () => (labels && identity && texts ? groupCards({ incidents, view: filteredIncidents, labels, identity, texts, weeksWithData: weeks, selectedWeek }) : []),
    [incidents, filteredIncidents, labels, identity, texts, weeks, selectedWeek],
  );
  const calendar = useMemo(() => calendarWeeks(weeks), [weeks]);
  const selectedIndex = calendar.indexOf(selectedWeek);
  const oneOffs = useMemo(
    () => (labels && oneOffOpen ? membersNewestFirst(incidents, filteredIncidents, labels, 'one-off', selectedWeek) : []),
    [incidents, filteredIncidents, labels, oneOffOpen, selectedWeek],
  );
  const explorer = useMemo(
    () => (ready && advancedOpen ? ready.partitions.thresholds.map((s, i) => thresholdRow(s, ready.partitions.labels[i])) : []),
    [ready, advancedOpen],
  );

  if (!familiesEnabled()) return <EmptyState message="This view is not available." />;

  const visibleCards = showAll ? cards : cards.slice(0, FAMILIES_DISPLAY.topCards);
  const detailCard = openGroup !== null ? cards.find(c => c.label === openGroup) ?? null : null;

  return (
    <div className="max-w-6xl min-w-0 break-words">
      <div className="mb-3">
        <h1 className="text-2xl font-bold text-foreground break-words">{FAMILIES_COPY.title}</h1>
        <p className="text-[13px] text-muted-foreground mt-1">{FAMILIES_COPY.subtitle}</p>
      </div>
      <div className="flex items-start gap-2 mb-6 text-[12px] text-muted-foreground" role="note" data-testid="families-banner">
        <FlaskConical className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{FAMILIES_COPY.banner}</span>
      </div>

      <GlobalFilters />

      {groups.status === 'too-large' && <EmptyState message={FAMILIES_COPY.tooLarge} />}
      {groups.status === 'computing' && <EmptyState message={FAMILIES_COPY.computing} />}
      {groups.status === 'error' && <EmptyState message={`Groups could not be built: ${groups.message}`} />}

      {ready && labels && identity && summary && (
        <>
          {!identity.numbersUnique && (
            <div className="mb-4 text-[12px] text-muted-foreground" data-testid="numbers-not-unique">{FAMILIES_COPY.numbersNotUnique}</div>
          )}

          {/* Week KPI block */}
          <div className="v1-card p-5 mb-6" data-testid="week-summary">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <label className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
                <span className={labelClass}>Week of</span>
                <select aria-label="Week" value={selectedWeek} onChange={e => setSelectedWeek(e.target.value)} className={`${selectClass} max-w-full min-w-0`}>
                  {[...weeks].reverse().map(w => <option key={w} value={w}>{weekRangeText(w)}</option>)}
                </select>
              </label>
              {through && (
                <span className="text-[12px] text-card-foreground/60" data-testid="data-through" title={WEEKLY_COPY.dataThroughCaveat}>
                  Data through {formatDataThrough(through)}
                </span>
              )}
            </div>
            <div className="font-mono text-[11px] uppercase tracking-wider text-card-foreground/50 break-words" data-testid="week-label">Week of {weekRangeText(selectedWeek)}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
              <div>
                <div className="font-mono text-[28px] font-bold text-card-foreground leading-none" data-testid="kpi-total">{formatCount(summary.total)}</div>
                <div className="text-[12px] text-card-foreground/60 mt-1">incidents</div>
              </div>
              <div>
                <div className="font-mono text-[22px] font-bold text-card-foreground leading-none">{wholePct(summary.grouped, summary.total)}%</div>
                <div className="text-[12px] text-card-foreground/80 mt-1">in repeating groups</div>
                <div className="text-[12px] text-card-foreground/60" data-testid="kpi-grouped">{formatCount(summary.grouped)} incidents · {formatCount(summary.groups)} {summary.groups === 1 ? 'group' : 'groups'}</div>
              </div>
              <div>
                <div className="font-mono text-[22px] font-bold text-card-foreground leading-none">{wholePct(summary.oneOff, summary.total)}%</div>
                <div className="text-[12px] text-card-foreground/80 mt-1">one-off incidents</div>
                <div className="text-[12px] text-card-foreground/60" data-testid="kpi-one-off">{formatCount(summary.oneOff)} incidents</div>
              </div>
            </div>
          </div>

          {/* Cards */}
          {/* Same look as SectionTitle, but allowed to wrap on narrow screens. */}
          <div className="flex items-center gap-3 mb-4 mt-8">
            <h2 className="font-mono text-[11px] font-bold tracking-[0.14em] uppercase text-muted-foreground">{FAMILIES_COPY.cardsTitle}</h2>
            <span className="flex-1 h-px bg-border min-w-4" />
          </div>
          {summary.total === 0 ? (
            <EmptyState message={FAMILIES_COPY.noIncidentsThisWeek} />
          ) : cards.length === 0 ? (
            <EmptyState message={FAMILIES_COPY.noGroupsThisWeek} />
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="group-cards">
                {visibleCards.map(card => (
                  <GroupCardView key={card.label} card={card} selectedIndex={selectedIndex} onOpen={() => setOpenGroup(card.label)} />
                ))}
              </div>
              {cards.length > FAMILIES_DISPLAY.topCards && (
                <button type="button" onClick={() => setShowAll(v => !v)} className="mt-3 font-mono text-[11px] px-2.5 py-1.5 rounded-md border border-border bg-secondary text-secondary-foreground">
                  {showAll ? FAMILIES_COPY.showFewer : FAMILIES_COPY.showAll(cards.length)}
                </button>
              )}
            </>
          )}

          {/* One-off incidents */}
          {summary.oneOff > 0 && (
            <div className="v1-card mt-6" data-testid="one-off-row">
              <button type="button" onClick={() => setOneOffOpen(o => !o)} className="w-full flex items-center gap-2 p-4 text-left text-[13px] text-card-foreground">
                {oneOffOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                {FAMILIES_COPY.oneOffRow(summary.oneOff)}
              </button>
              {oneOffOpen && <div className="px-5 pb-4">{oneOffs.map((inc, i) => <IncidentLine key={i} inc={inc} />)}</div>}
            </div>
          )}

          {/* Grouping settings */}
          <div className="v1-card mt-6" data-testid="settings-panel">
            <button type="button" onClick={() => setSettingsOpen(o => !o)} className="w-full flex flex-wrap items-center gap-2 p-4 text-left text-[13px] text-card-foreground">
              {settingsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              {FAMILIES_COPY.settingsTitle}
              <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-card-foreground/50 whitespace-nowrap">{FAMILIES_COPY.settingsTag}</span>
            </button>
            {settingsOpen && (
              <div className="px-5 pb-5 space-y-5 text-card-foreground" data-testid="settings-body">
                <fieldset>
                  <legend className="text-[13px] font-medium mb-2">{FAMILIES_COPY.strictnessQuestion}</legend>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(FAMILIES_DISPLAY.strictness) as Strictness[]).map(k => (
                      <label key={k} className={`px-3 py-1.5 rounded-md border text-[13px] cursor-pointer ${strictness === k ? 'border-primary bg-primary text-primary-foreground font-medium' : 'border-border'}`}>
                        <input type="radio" name="strictness" value={k} checked={strictness === k} onChange={() => { setStrictness(k); setOpenGroup(null); }} className="sr-only" />
                        {FAMILIES_COPY.strictnessLabels[k]}
                      </label>
                    ))}
                  </div>
                  <p className="text-[12px] text-card-foreground/60 mt-2">{FAMILIES_COPY.strictnessNote}</p>
                </fieldset>
                <label className="flex flex-col gap-1 max-w-sm">
                  <span className="text-[13px] font-medium">{FAMILIES_COPY.textCleaning}</span>
                  <select aria-label={FAMILIES_COPY.textCleaning} value={variant} onChange={e => { setVariant(e.target.value as TextVariant); setOpenGroup(null); }} className={selectClass}>
                    {FAMILIES_RESEARCH.variants.map(v => <option key={v} value={v}>{FAMILIES_COPY.textCleaningLabels[v]}</option>)}
                  </select>
                </label>
                <div>
                  <button type="button" onClick={() => setAdvancedOpen(o => !o)} className="flex items-center gap-1.5 text-[12px] text-card-foreground/70">
                    {advancedOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    {FAMILIES_COPY.advanced}
                  </button>
                  {advancedOpen && (
                    <div className="mt-3 space-y-4" data-testid="advanced-panel">
                      <label className="flex items-center gap-2 text-[12px]">
                        Template frequency level (for “Remove repeated templates” and “Remove templates and IDs”)
                        <select aria-label="Template frequency level" value={tau} onChange={e => { setTau(Number(e.target.value)); setOpenGroup(null); }} className={selectClass}>
                          {FAMILIES_RESEARCH.taus.map(t => <option key={t} value={t}>{t.toFixed(2)}</option>)}
                        </select>
                      </label>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[12px]" data-testid="threshold-explorer">
                          <thead>
                            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-card-foreground/50">
                              <th className="py-1.5 pr-4">Similarity level</th><th className="pr-4">Groups (2+ incidents)</th><th className="pr-4">Groups (5+ incidents)</th>
                              <th className="pr-4">Largest group share</th><th>One-off incidents</th>
                            </tr>
                          </thead>
                          <tbody>
                            {explorer.map(r => (
                              <tr key={r.threshold} className="border-t border-card-foreground/10 font-mono">
                                <td className="py-1.5 pr-4">{r.threshold.toFixed(2)}</td><td className="pr-4">{formatCount(r.familiesGe2)}</td><td className="pr-4">{formatCount(r.familiesGe5)}</td>
                                <td className="pr-4">{Math.round(r.largestShare * 100)}%</td><td>{Math.round(r.singletonShare * 100)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="text-[11px] text-card-foreground/50 mt-2">Whole file. Built in the browser in {Math.round(ready.elapsedMs)} ms.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {detailCard && texts && (
            <GroupDetail
              card={detailCard}
              words={texts.get(detailCard.label)!.commonWords}
              calendar={calendar}
              selectedIndex={selectedIndex}
              allMembers={incidents.filter((_, i) => labels[i] === detailCard.label)}
              members={membersNewestFirst(incidents, filteredIncidents, labels, detailCard.label)}
              onClose={() => setOpenGroup(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function GroupCardView({ card, selectedIndex, onOpen }: { card: GroupCard; selectedIndex: number; onOpen: () => void }) {
  return (
    <div className="v1-card p-5 flex flex-col gap-3 min-w-0" data-testid="group-card">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[14px] font-medium text-card-foreground leading-snug min-w-0 break-words" title={card.name.full} data-testid="group-name">{card.name.short}</div>
        <span className="font-mono text-[10px] text-card-foreground/45 shrink-0">{card.id}</span>
      </div>
      <div className="font-mono text-[13px] text-card-foreground" data-testid="fact-line">
        {factLine(card)}
        {card.pct !== null && <span className="text-card-foreground/45 ml-1.5 text-[11px]">({card.pct > 0 ? '+' : ''}{card.pct}%)</span>}
      </div>
      <Sparkline series={card.sparkline} selected={selectedIndex} />
      <div className="text-[12px] text-card-foreground/75 space-y-0.5">
        <div>Mostly handled by {shareText(card.handledBy, FAMILIES_COPY.noHandlingGroup)}</div>
        <div>Main service: {shareText(card.service, FAMILIES_COPY.noService)}</div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-card-foreground/60">
        <span>{formatCount(card.size)} incidents · appeared in {card.weeksAppeared} of {card.totalWeeks} weeks</span>
        <button type="button" onClick={onOpen} className="text-card-foreground font-medium hover:underline">{FAMILIES_COPY.seeIncidents}</button>
      </div>
    </div>
  );
}

function GroupDetail({ card, words, calendar, selectedIndex, allMembers, members, onClose }: {
  card: GroupCard; words: string[]; calendar: string[]; selectedIndex: number;
  allMembers: AnnotatedIncident[]; members: AnnotatedIncident[]; onClose: () => void;
}) {
  const handled = breakdown(allMembers.map(m => dimensionValue(m, 'assignmentGroup')));
  const services = breakdown(allMembers.map(m => dimensionValue(m, 'service')));
  const chart = calendar.map((w, i) => ({ week: weekLabel(w), count: card.sparkline[i] }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={onClose}>
      <div className="v1-card w-full max-w-3xl max-h-[88vh] overflow-y-auto m-4 shadow-xl" onClick={e => e.stopPropagation()} data-testid="group-detail">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-card-foreground/10">
          <div className="min-w-0">
            <h2 className="text-[16px] font-bold text-card-foreground leading-snug break-words">{card.name.full}</h2>
            <div className="font-mono text-[12px] text-card-foreground mt-1.5">{factLine(card)} <span className="text-card-foreground/45 ml-2">{card.id}</span></div>
            <div className="text-[12px] text-card-foreground/60 mt-0.5">{formatCount(card.size)} incidents · appeared in {card.weeksAppeared} of {card.totalWeeks} weeks</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-card-foreground/50 hover:text-card-foreground p-1 shrink-0"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-6">
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'hsl(215,12%,50%)' }} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'hsl(215,12%,50%)' }} width={28} />
                <Tooltip />
                <Bar dataKey="count" name="Incidents">
                  {chart.map((_, i) => <Cell key={i} fill={i === selectedIndex ? ACCENT : NEUTRAL} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {[{ title: 'Handled by', rows: handled, missing: FAMILIES_COPY.noHandlingGroup }, { title: 'Service', rows: services, missing: FAMILIES_COPY.noService }].map(b => (
              <div key={b.title}>
                <div className={labelClass}>{b.title}</div>
                <ul className="mt-2 space-y-1 text-[12px] text-card-foreground">
                  {b.rows.slice(0, 6).map((r, i) => (
                    <li key={i} className="flex justify-between gap-3"><span className="truncate">{r.value ?? b.missing}</span><span className="font-mono shrink-0">{formatCount(r.count)} · {r.pct}%</span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {words.length > 0 && (
            <div>
              <div className={labelClass}>Common words</div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {words.map(w => <span key={w} className="px-2 py-0.5 rounded border border-border text-[12px] text-card-foreground">{w}</span>)}
              </div>
            </div>
          )}
          <div>
            <div className={labelClass}>Incidents in view · newest first ({formatCount(members.length)})</div>
            <div className="mt-1">{members.map((inc, i) => <IncidentLine key={i} inc={inc} />)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

