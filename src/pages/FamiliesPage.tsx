import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '@/context/AppContext';
import GlobalFilters from '@/components/GlobalFilters';
import { EmptyState } from '@/components/ui/dashboard-primitives';
import { FAMILIES_COPY, FAMILIES_DISPLAY, FAMILIES_RESEARCH, familiesEnabled } from '@/config/families';
import { useIncidentFamilies, type FamiliesState } from '@/hooks/useIncidentFamilies';
import { weekLabel } from '@/lib/periods';
import { dimensionValue } from '@/lib/serviceDimension';
import { dataThrough, formatDataThrough } from '@/lib/weeklyComposition';
import { thresholdRow } from '@/lib/families/view';
import { buildVariant, openTimeText, type TextVariant } from '@/lib/families/variants';
import {
  breakdown, calendarWeeks, distribution, factLine, formatCount, groupCards, groupIdentity, groupTexts,
  isWeekComparable, largestRemainderPct, lastCoveredLine, lastSeenText, membersNewestFirst, qualityView,
  settingSummary, shortDate, sparklineHeights, termVectors, utcDateKey, weekMonthLabel, weekOptionText,
  weekRangeText, weekSummary, type DistributionSegment, type GroupCard, type GroupSort, type TopShare,
} from '@/lib/families/presentation';
import type { AnnotatedIncident } from '@/lib/problems';
import { BarChart, Bar, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronRight, FlaskConical, X } from 'lucide-react';

type Strictness = keyof typeof FAMILIES_DISPLAY.strictness;
type Ready = Extract<FamiliesState, { status: 'ready' }>;

const NEUTRAL = 'hsl(215,14%,72%)';
const ACCENT = 'hsl(209,96%,35%)';
/** Distribution bar: one hue, darkest for the largest groups; one-off incidents in neutral gray. */
const SEGMENT_FILL: Record<DistributionSegment['key'], string> = {
  top: 'hsl(209,60%,32%)',
  next: 'hsl(209,45%,50%)',
  remaining: 'hsl(209,40%,70%)',
  oneOff: 'hsl(215,10%,84%)',
};
const selectClass = 'bg-secondary border border-border rounded-md px-3 py-1.5 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary';
const sectionTitle = 'text-[15px] font-semibold text-foreground';
const subTitle = 'text-[12px] font-medium text-card-foreground/70';

function shareText(share: TopShare, missing: string): string {
  if (share.value === null) return missing;
  return `${share.value} (${share.pct}%)${share.mixed ? ` · ${FAMILIES_COPY.mixed}` : ''}`;
}

/**
 * Weekly counts as small bars. The selected week is drawn in the accent
 * colour; a week the data does not fully cover is drawn hollow. Each bar's
 * tooltip gives the true count; the minimum bar height is drawing only.
 */
function Sparkline({ series, calendar, selected, dataThroughDate }: { series: number[]; calendar: string[]; selected: number; dataThroughDate: string }) {
  const h = FAMILIES_DISPLAY.sparklineHeight;
  const heights = sparklineHeights(series, h, FAMILIES_DISPLAY.sparklineMinBar);
  const w = 3;
  const gap = 1;
  const width = series.length * (w + gap);
  return (
    <div className="min-w-0" style={{ maxWidth: width }}>
      <svg viewBox={`0 0 ${width} ${h + 1}`} preserveAspectRatio="none" height={h + 1} style={{ width: '100%' }}
        role="img" aria-label="Incidents per week" data-testid="sparkline" data-weeks={series.length}>
        <line x1={0} x2={width} y1={h + 0.5} y2={h + 0.5} stroke={NEUTRAL} strokeWidth={0.5} />
        {series.map((v, i) => {
          const covered = isWeekComparable(calendar[i], dataThroughDate);
          const color = i === selected ? ACCENT : NEUTRAL;
          return (
            <rect key={i} x={i * (w + gap)} y={h - heights[i]} width={w} height={heights[i]} data-count={v}
              fill={covered ? color : 'none'} stroke={covered ? 'none' : color} strokeWidth={covered ? 0 : 0.8}>
              <title>{`${weekRangeText(calendar[i])}: ${v} ${v === 1 ? 'incident' : 'incidents'}${covered ? '' : ` · data through ${shortDate(dataThroughDate)}`}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-card-foreground/45 mt-0.5" data-testid="sparkline-months">
        <span>{weekMonthLabel(calendar[0])}</span>
        <span>{weekMonthLabel(calendar[calendar.length - 1])}</span>
      </div>
    </div>
  );
}

function IncidentLine({ inc }: { inc: AnnotatedIncident }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-card-foreground/10 first:border-t-0 py-2.5" data-testid="incident-line">
      <div className="text-[11px] text-card-foreground/55">
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

/** Incidents, newest first, mounted 20 at a time. */
function IncidentList({ incidents }: { incidents: AnnotatedIncident[] }) {
  const step = FAMILIES_DISPLAY.incidentPage;
  const [shown, setShown] = useState<number>(step);
  const rest = incidents.length - shown;
  return (
    <div>
      {incidents.slice(0, shown).map((inc, i) => <IncidentLine key={i} inc={inc} />)}
      {rest > 0 && (
        <button type="button" onClick={() => setShown(s => s + step)} className="mt-2 text-[12px] px-2.5 py-1.5 rounded-md border border-border bg-secondary text-secondary-foreground">
          {FAMILIES_COPY.showMoreIncidents(Math.min(step, rest))}
        </button>
      )}
    </div>
  );
}

function DistributionBar({ segments, population, caption }: { segments: DistributionSegment[]; population: number; caption: string }) {
  return (
    <section className="mb-6" data-testid="distribution" aria-label={FAMILIES_COPY.distributionTitle}>
      <h2 className={`${sectionTitle} mb-2`}>{FAMILIES_COPY.distributionTitle}</h2>
      <div className="flex w-full h-3 gap-[2px]" role="img" aria-label={segments.map(s => `${s.label}: ${s.pct}%`).join(', ')}>
        {segments.map((s, i) => (
          <div key={s.key} data-testid="distribution-segment" data-key={s.key} data-count={s.incidents} data-pct={s.pct}
            title={`${s.label}: ${formatCount(s.incidents)} of ${formatCount(population)} incidents (${s.pct}%)`}
            className={`${i === 0 ? 'rounded-l' : ''} ${i === segments.length - 1 ? 'rounded-r' : ''}`}
            style={{ flexGrow: s.incidents, flexBasis: 0, minWidth: 2, background: SEGMENT_FILL[s.key] }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12px] text-muted-foreground" data-testid="distribution-labels">
        {segments.map(s => (
          <span key={s.key} className="flex items-center gap-1.5" title={`${formatCount(s.incidents)} incidents`}>
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SEGMENT_FILL[s.key] }} />
            {s.label}: <span className="text-foreground">{s.pct}%</span>
          </span>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">{caption}</p>
    </section>
  );
}

export default function FamiliesPage() {
  const { incidents, filteredIncidents, scores, filterLabel, availableWeeks: weeks, selectedWeek, setSelectedWeek, globalFilters } = useAppContext();
  const [strictness, setStrictness] = useState<Strictness>('balanced');
  // The click updates the selector at once; the groups follow in a deferred render.
  const shownStrictness = useDeferredValue(strictness);
  const [variant, setVariant] = useState<TextVariant>(FAMILIES_DISPLAY.defaultVariant);
  const [tau, setTau] = useState<number>(FAMILIES_DISPLAY.defaultTau);
  const [sort, setSort] = useState<GroupSort>('largest');
  const [cardsShown, setCardsShown] = useState<number>(FAMILIES_DISPLAY.topCards);
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [oneOffOpen, setOneOffOpen] = useState(false);
  const [analystOpen, setAnalystOpen] = useState(false);

  // Groups are built once over the full loaded file; filters never reach the computation.
  const groups = useIncidentFamilies(incidents, variant, tau);
  // While a new text cleaning is computed, the last result for this file stays on screen.
  const lastReady = useRef<{ incidents: AnnotatedIncident[]; state: Ready } | null>(null);
  if (groups.status === 'ready') lastReady.current = { incidents, state: groups };
  const ready: Ready | null = groups.status === 'ready' ? groups
    : groups.status === 'computing' && lastReady.current?.incidents === incidents ? lastReady.current.state : null;
  const partitions = ready?.partitions ?? null;
  const updating = (groups.status === 'computing' && ready !== null) || strictness !== shownStrictness;

  // Coverage comes from the full file: filters never change it.
  const through = useMemo(() => dataThrough(incidents), [incidents]);
  const throughDate = through ? utcDateKey(through) : '';
  const firstOpened = useMemo(() => {
    let first = '';
    for (const i of incidents) if (i.Opened && (!first || i.Opened < first)) first = i.Opened;
    return first;
  }, [incidents]);
  // The displayed population: global filters plus the sidebar Quality filter. Display only.
  const view = useMemo(
    () => qualityView(incidents, scores ?? [], filteredIncidents, filterLabel ?? 'all'),
    [incidents, scores, filteredIncidents, filterLabel],
  );
  const labelsFor = (s: Strictness) => (partitions ? partitions.labels[partitions.thresholds.indexOf(FAMILIES_DISPLAY.strictness[s])] : null);
  const labels = labelsFor(shownStrictness);

  // The same text the groups were built from, for naming them.
  const docs = useMemo(
    () => (partitions ? buildVariant(incidents.map(i => openTimeText(i.shortDescClean, i.descClean)), { variant: partitions.variant, tau: partitions.variant === 'R0' ? undefined : partitions.tau }) : null),
    [partitions, incidents],
  );
  const vectors = useMemo(() => (docs ? termVectors(docs) : null), [docs]);
  const identity = useMemo(() => (labels ? groupIdentity(incidents, labels) : null), [incidents, labels]);
  const texts = useMemo(() => (labels && docs && vectors ? groupTexts(incidents, docs, labels, vectors) : null), [incidents, docs, vectors, labels]);
  const summary = useMemo(() => (labels ? weekSummary(incidents, view, labels, selectedWeek) : null), [incidents, view, labels, selectedWeek]);
  const cards = useMemo(
    () => (labels && identity && texts
      ? groupCards({ incidents, view, labels, identity, texts, weeksWithData: weeks, selectedWeek, dataThroughDate: throughDate, sort })
      : []),
    [incidents, view, labels, identity, texts, weeks, selectedWeek, throughDate, sort],
  );
  const segments = useMemo(() => (labels ? distribution(incidents, view, labels) : []), [incidents, view, labels]);
  const current = useMemo(() => (labels ? settingSummary(incidents, view, labels) : null), [incidents, view, labels]);

  // The previous grouping setting of this session, recomputed for the current filters.
  const settingKey = `${shownStrictness}|${partitions?.variant}|${partitions?.tau}`;
  const lastSetting = useRef<{ key: string; strictness: Strictness; variant: string; tau: number | undefined; labels: Int32Array } | null>(null);
  const [previous, setPrevious] = useState<NonNullable<typeof lastSetting.current> | null>(null);
  useEffect(() => {
    lastSetting.current = null;
    setPrevious(null);
  }, [incidents]);
  useEffect(() => {
    if (updating || !labels || !partitions) return;
    const now = { key: settingKey, strictness: shownStrictness, variant: partitions.variant, tau: partitions.tau, labels };
    if (lastSetting.current && lastSetting.current.key !== settingKey) setPrevious(lastSetting.current);
    lastSetting.current = now;
  }, [settingKey, updating, labels, partitions, shownStrictness]);
  const previousSummary = useMemo(() => {
    if (!previous) return null;
    const s = settingSummary(incidents, view, previous.labels);
    const oneOff = distribution(incidents, view, previous.labels).find(x => x.key === 'oneOff')?.pct ?? 0;
    const sameText = previous.variant === partitions?.variant && previous.tau === partitions?.tau;
    return { name: sameText ? FAMILIES_COPY.strictnessLabels[previous.strictness] : 'Before', groups: s.groups, oneOff };
  }, [previous, incidents, view, partitions]);

  const calendar = useMemo(() => calendarWeeks(weeks), [weeks]);
  const selectedIndex = calendar.indexOf(selectedWeek);
  const comparable = isWeekComparable(selectedWeek, throughDate);
  const oneOffs = useMemo(
    () => (labels && oneOffOpen ? membersNewestFirst(incidents, view, labels, 'one-off', selectedWeek) : []),
    [incidents, view, labels, oneOffOpen, selectedWeek],
  );
  const explorer = useMemo(
    () => (partitions && analystOpen ? partitions.thresholds.map((s, i) => thresholdRow(s, partitions.labels[i])) : []),
    [partitions, analystOpen],
  );

  if (!familiesEnabled()) return <EmptyState message="This view is not available." />;

  const changeSetting = (apply: () => void) => {
    apply();
    setOpenGroup(null);
    setCardsShown(FAMILIES_DISPLAY.topCards);
  };
  const visibleCards = cards.slice(0, cardsShown);
  const detailCard = openGroup !== null ? cards.find(c => c.label === openGroup) ?? null : null;
  const isExploratoryDefault = variant === FAMILIES_DISPLAY.defaultVariant && tau === FAMILIES_DISPLAY.defaultTau && strictness === 'balanced';
  const timeFiltered = (globalFilters?.months?.length ?? 0) > 0;
  const kpiPct = summary ? largestRemainderPct([summary.grouped, summary.oneOff]) : [0, 0];
  const oneOffPct = segments.find(s => s.key === 'oneOff')?.pct ?? 0;
  const firstDate = firstOpened ? formatDataThrough(new Date(`${firstOpened.slice(0, 10)}T00:00:00Z`)) : '';
  const populationCaption = `${formatCount(view.length)} incidents ${timeFiltered ? 'in the selected period' : `since ${firstDate}`}.`;
  const moreCards = Math.min(FAMILIES_DISPLAY.topCards, cards.length - visibleCards.length);

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
      {groups.status === 'computing' && !ready && <EmptyState message={FAMILIES_COPY.computing} />}
      {groups.status === 'error' && <EmptyState message={`Groups could not be built: ${groups.message}`} />}

      {ready && labels && identity && summary && current && (
        <>
          {!identity.numbersUnique && (
            <div className="mb-4 text-[12px] text-muted-foreground" data-testid="numbers-not-unique">{FAMILIES_COPY.numbersNotUnique}</div>
          )}

          {/* Week KPI block */}
          <div className="v1-card p-5 mb-6" data-testid="week-summary">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <label className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
                <span className={subTitle}>Week</span>
                <select aria-label="Week" value={selectedWeek} onChange={e => setSelectedWeek(e.target.value)} className={`${selectClass} max-w-full min-w-0`}>
                  {[...weeks].reverse().map(w => <option key={w} value={w}>{weekOptionText(w, throughDate)}</option>)}
                </select>
              </label>
              {through && <span className="text-[12px] text-card-foreground/60" data-testid="data-through">Data through {formatDataThrough(through)}</span>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="text-[28px] font-bold text-card-foreground leading-none tabular-nums" data-testid="kpi-total">{formatCount(summary.total)}</div>
                <div className="text-[12px] text-card-foreground/60 mt-1" data-testid="kpi-total-label">
                  {comparable ? 'incidents' : `incidents through ${shortDate(throughDate)}`}
                </div>
              </div>
              <div>
                <div className="text-[22px] font-bold text-card-foreground leading-none tabular-nums" data-testid="kpi-grouped-pct">{kpiPct[0]}%</div>
                <div className="text-[12px] text-card-foreground/80 mt-1">in repeating groups</div>
                <div className="text-[12px] text-card-foreground/60" data-testid="kpi-grouped">{formatCount(summary.grouped)} incidents · {formatCount(summary.groups)} {summary.groups === 1 ? 'group' : 'groups'}</div>
              </div>
              <div>
                <div className="text-[22px] font-bold text-card-foreground leading-none tabular-nums" data-testid="kpi-one-off-pct">{kpiPct[1]}%</div>
                <div className="text-[12px] text-card-foreground/80 mt-1">one-off incidents</div>
                <div className="text-[12px] text-card-foreground/60" data-testid="kpi-one-off">{formatCount(summary.oneOff)} incidents</div>
              </div>
            </div>
            {!comparable && through && (
              <p className="text-[12px] text-card-foreground/70 mt-4" data-testid="coverage-message">{FAMILIES_COPY.coverageMessage(shortDate(throughDate))}</p>
            )}
          </div>

          {segments.length > 0 && <DistributionBar segments={segments} population={view.length} caption={populationCaption} />}

          {/* Grouping controls */}
          <div className="v1-card p-4 mb-6 text-card-foreground" data-testid="settings-panel">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <fieldset className="flex flex-wrap items-center gap-2">
                <legend className="sr-only">{FAMILIES_COPY.strictnessQuestion}</legend>
                <span className={subTitle} aria-hidden="true">{FAMILIES_COPY.grouping}</span>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(FAMILIES_DISPLAY.strictness) as Strictness[]).map(k => (
                    <label key={k} className={`px-3 py-1.5 rounded-md border text-[13px] cursor-pointer ${strictness === k ? 'border-primary bg-primary text-primary-foreground font-medium' : 'border-border'}`}>
                      <input type="radio" name="strictness" value={k} checked={strictness === k} onChange={() => changeSetting(() => setStrictness(k))} className="sr-only" />
                      {FAMILIES_COPY.strictnessLabels[k]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex flex-wrap items-center gap-2 min-w-0">
                <span className={subTitle}>{FAMILIES_COPY.textCleaning}</span>
                <select aria-label={FAMILIES_COPY.textCleaning} value={variant} onChange={e => changeSetting(() => setVariant(e.target.value as TextVariant))} className={`${selectClass} max-w-full min-w-0`}>
                  {FAMILIES_RESEARCH.variants.map(v => <option key={v} value={v}>{FAMILIES_COPY.textCleaningLabels[v]}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-3 text-[13px]" aria-live="polite" data-testid="result-line">
              {updating ? (
                <span className="text-card-foreground/70" data-testid="updating">{FAMILIES_COPY.updating}</span>
              ) : (
                <>
                  <span className="font-medium">{FAMILIES_COPY.strictnessLabels[shownStrictness]}: {formatCount(current.groups)} {current.groups === 1 ? 'group' : 'groups'} · {oneOffPct}% one-off</span>
                  {previousSummary && ' '}
                  {previousSummary && (
                    <span className="text-card-foreground/60" data-testid="previous-setting">({previousSummary.name}: {formatCount(previousSummary.groups)} · {previousSummary.oneOff}%)</span>
                  )}
                </>
              )}
            </div>
            <div className="mt-3">
              <button type="button" onClick={() => setAnalystOpen(o => !o)} aria-expanded={analystOpen} className="flex items-center gap-1.5 text-[12px] text-card-foreground/70">
                {analystOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                {FAMILIES_COPY.analystDetails}
              </button>
              {analystOpen && (
                <div className="mt-3 space-y-4 text-[12px]" data-testid="settings-body">
                  {isExploratoryDefault && <p className="text-card-foreground/70" data-testid="exploratory-default">{FAMILIES_COPY.exploratoryDefault}</p>}
                  <p className="text-card-foreground/70">{FAMILIES_COPY.strictnessNote}</p>
                  <label className="flex flex-wrap items-center gap-2">
                    Template frequency level (for “{FAMILIES_COPY.textCleaningLabels.R1}” and “{FAMILIES_COPY.textCleaningLabels.R2}”)
                    <select aria-label="Template frequency level" value={tau} onChange={e => changeSetting(() => setTau(Number(e.target.value)))} className={selectClass}>
                      {FAMILIES_RESEARCH.taus.map(t => <option key={t} value={t}>{t.toFixed(2)}</option>)}
                    </select>
                  </label>
                  <div className="overflow-x-auto" data-testid="advanced-panel">
                    <table className="w-full text-[12px] tabular-nums" data-testid="threshold-explorer">
                      <thead>
                        <tr className="text-left text-[11px] font-medium text-card-foreground/60">
                          <th className="py-1.5 pr-4">Similarity level</th><th className="pr-4">Groups (2+ incidents)</th><th className="pr-4">Groups (5+ incidents)</th>
                          <th className="pr-4">Largest group share</th><th>One-off incidents</th>
                        </tr>
                      </thead>
                      <tbody>
                        {explorer.map(r => (
                          <tr key={r.threshold} className="border-t border-card-foreground/10">
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

          {/* Cards */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className={sectionTitle}>{FAMILIES_COPY.cardsTitle}</h2>
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
              {FAMILIES_COPY.sortLabel}
              <select aria-label="Sort by" value={sort} onChange={e => setSort(e.target.value as GroupSort)} className={selectClass}>
                <option value="largest">{FAMILIES_COPY.sortLabels.largest}</option>
                <option value="selectedWeek">{FAMILIES_COPY.sortLabels.selectedWeek}</option>
              </select>
            </label>
          </div>
          {cards.length === 0 ? (
            <EmptyState message={FAMILIES_COPY.noGroupsThisWeek} />
          ) : (
            <>
              <div className={`grid grid-cols-1 lg:grid-cols-2 gap-4 ${updating ? 'opacity-60' : ''}`} data-testid="group-cards">
                {visibleCards.map(card => (
                  <GroupCardView key={card.label} card={card} words={texts!.get(card.label)!.commonWords.slice(0, FAMILIES_DISPLAY.cardWords)}
                    calendar={calendar} selectedIndex={selectedIndex} throughDate={throughDate} onOpen={() => setOpenGroup(card.label)} />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                {moreCards > 0 && (
                  <button type="button" onClick={() => setCardsShown(n => n + FAMILIES_DISPLAY.topCards)} className="text-[12px] px-2.5 py-1.5 rounded-md border border-border bg-secondary text-secondary-foreground">
                    {FAMILIES_COPY.showMore(moreCards)}
                  </button>
                )}
                <span className="text-[12px] text-muted-foreground" data-testid="cards-showing">({FAMILIES_COPY.showing(visibleCards.length, cards.length)})</span>
              </div>
            </>
          )}

          {/* One-off incidents */}
          {summary.oneOff > 0 && (
            <div className="v1-card mt-6" data-testid="one-off-row">
              <button type="button" onClick={() => setOneOffOpen(o => !o)} aria-expanded={oneOffOpen} className="w-full flex flex-wrap items-center gap-2 p-4 text-left text-[13px] text-card-foreground">
                {oneOffOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <span>
                  <span className="font-medium">{FAMILIES_COPY.oneOffTitle}</span> · {formatCount(summary.oneOff)} · <span className="underline-offset-2 hover:underline">{oneOffOpen ? FAMILIES_COPY.hideIncidents : FAMILIES_COPY.viewIncidents}</span>
                </span>
              </button>
              {oneOffOpen && <div className="px-5 pb-4" data-testid="one-off-list"><IncidentList incidents={oneOffs} /></div>}
            </div>
          )}

          {detailCard && texts && (
            <GroupDetail
              card={detailCard}
              words={texts.get(detailCard.label)!.commonWords}
              calendar={calendar}
              selectedIndex={selectedIndex}
              throughDate={throughDate}
              allMembers={incidents.filter((_, i) => labels[i] === detailCard.label)}
              members={membersNewestFirst(incidents, view, labels, detailCard.label)}
              onClose={() => setOpenGroup(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function GroupCardView({ card, words, calendar, selectedIndex, throughDate, onOpen }: {
  card: GroupCard; words: string[]; calendar: string[]; selectedIndex: number; throughDate: string; onOpen: () => void;
}) {
  return (
    <div className="v1-card p-5 flex flex-col gap-2.5 min-w-0" data-testid="group-card">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[14px] font-semibold text-card-foreground leading-snug min-w-0 break-words" title={card.name.full} data-testid="group-name">{card.name.short}</div>
        <span className="text-[11px] text-card-foreground/45 shrink-0 cursor-help" title={FAMILIES_COPY.groupIdTooltip} data-testid="group-id">{card.id}</span>
      </div>
      {words.length > 0 && (
        <div className="text-[12px] text-card-foreground/70" data-testid="card-words">{FAMILIES_COPY.commonWords} {words.join(', ')}</div>
      )}
      <div className="text-[13px] text-card-foreground space-y-0.5">
        <div data-testid="fact-line">
          {factLine(card, throughDate)}
          {card.comparable && card.pct !== null && <span className="text-card-foreground/45 ml-1.5 text-[11px]">({card.pct > 0 ? '+' : ''}{card.pct}%)</span>}
        </div>
        {card.lastCovered && <div className="text-[12px] text-card-foreground/70" data-testid="last-covered-line">{lastCoveredLine(card.lastCovered)}</div>}
        {card.lastSeen && <div className="text-[12px] text-card-foreground/60" data-testid="last-seen">{lastSeenText(card.lastSeen)}</div>}
      </div>
      <Sparkline series={card.sparkline} calendar={calendar} selected={selectedIndex} dataThroughDate={throughDate} />
      <div className="text-[12px] text-card-foreground/75 space-y-0.5">
        <div>Mostly handled by {shareText(card.handledBy, FAMILIES_COPY.noHandlingGroup)}</div>
        <div>Main service: {shareText(card.service, FAMILIES_COPY.noService)}</div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-card-foreground/60">
        <span data-testid="card-totals">{formatCount(card.total)} incidents · appeared in {card.weeksAppeared} of {card.totalWeeks} weeks</span>
        <button type="button" onClick={onOpen} className="text-card-foreground font-medium hover:underline">{FAMILIES_COPY.seeIncidents}</button>
      </div>
    </div>
  );
}

function GroupDetail({ card, words, calendar, selectedIndex, throughDate, allMembers, members, onClose }: {
  card: GroupCard; words: string[]; calendar: string[]; selectedIndex: number; throughDate: string;
  allMembers: AnnotatedIncident[]; members: AnnotatedIncident[]; onClose: () => void;
}) {
  const handled = breakdown(allMembers.map(m => dimensionValue(m, 'assignmentGroup')));
  const services = breakdown(allMembers.map(m => dimensionValue(m, 'service')));
  const chart = calendar.map((w, i) => ({
    week: weekLabel(w),
    count: card.sparkline[i],
    covered: isWeekComparable(w, throughDate),
  }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={onClose}>
      <div className="v1-card w-full max-w-3xl max-h-[88vh] overflow-y-auto m-4 shadow-xl" onClick={e => e.stopPropagation()} data-testid="group-detail">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-card-foreground/10">
          <div className="min-w-0">
            <h2 className="text-[16px] font-bold text-card-foreground leading-snug break-words" title={card.name.full}>{card.name.short}</h2>
            <div className="text-[12px] text-card-foreground mt-1.5">{factLine(card, throughDate)} <span className="text-card-foreground/45 ml-2" title={FAMILIES_COPY.groupIdTooltip}>{card.id}</span></div>
            {card.lastCovered && <div className="text-[12px] text-card-foreground/70 mt-0.5">{lastCoveredLine(card.lastCovered)}</div>}
            <div className="text-[12px] text-card-foreground/60 mt-0.5">{formatCount(card.total)} incidents · appeared in {card.weeksAppeared} of {card.totalWeeks} weeks</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-card-foreground/50 hover:text-card-foreground p-1 shrink-0"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-6">
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'hsl(215,12%,50%)' }} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'hsl(215,12%,50%)' }} width={28} />
                <Tooltip formatter={(value: number, _n, item) => [
                  `${value} ${value === 1 ? 'incident' : 'incidents'}${item?.payload?.covered === false ? ` · data through ${shortDate(throughDate)}` : ''}`, 'Incidents',
                ]} />
                <Bar dataKey="count" name="Incidents">
                  {chart.map((c, i) => {
                    const color = i === selectedIndex ? ACCENT : NEUTRAL;
                    return <Cell key={i} fill={c.covered ? color : 'transparent'} stroke={c.covered ? undefined : color} strokeWidth={c.covered ? 0 : 1.5} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {!card.comparable && <p className="text-[11px] text-card-foreground/55 -mt-4">Outlined bar: week with data through {shortDate(throughDate)}.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {[{ title: 'Handled by', rows: handled, missing: FAMILIES_COPY.noHandlingGroup }, { title: 'Service', rows: services, missing: FAMILIES_COPY.noService }].map(b => (
              <div key={b.title}>
                <div className={subTitle}>{b.title}</div>
                <ul className="mt-2 space-y-1 text-[12px] text-card-foreground">
                  {b.rows.slice(0, 6).map((r, i) => (
                    <li key={i} className="flex justify-between gap-3"><span className="truncate">{r.value ?? b.missing}</span><span className="shrink-0 tabular-nums">{formatCount(r.count)} · {r.pct}%</span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {words.length > 0 && (
            <div>
              <div className={subTitle}>Common words</div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {words.map(w => <span key={w} className="px-2 py-0.5 rounded border border-border text-[12px] text-card-foreground">{w}</span>)}
              </div>
            </div>
          )}
          <div>
            <div className={subTitle}>Incidents in view · newest first ({formatCount(members.length)})</div>
            <div className="mt-1"><IncidentList incidents={members} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
