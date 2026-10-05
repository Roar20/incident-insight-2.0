import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '@/context/AppContext';
import GlobalFilters from '@/components/GlobalFilters';
import { EmptyState } from '@/components/ui/dashboard-primitives';
import { FAMILIES_COPY, FAMILIES_DISPLAY, FAMILIES_RESEARCH, familiesEnabled } from '@/config/families';
import { useIncidentFamilies, type FamiliesState } from '@/hooks/useIncidentFamilies';
import { dimensionValue } from '@/lib/serviceDimension';
import { isDimensionFiltered } from '@/lib/problemView';
import { dataThrough, formatDataThrough } from '@/lib/weeklyComposition';
import { thresholdRow } from '@/lib/families/view';
import { buildVariant, fitTemplates, openTimeText, type TextVariant } from '@/lib/families/variants';
import {
  averageLabel, breakdownRows, calendarWeeks, cleanedGroupName, composition, distribution, factLine, formatCount,
  groupActivity, groupCards, groupHistory, groupIdentity, groupName, groupTexts, isWeekComparable, largestRemainderPct,
  lastCoveredLine, lastSeenText, membersNewestFirst, monthTicks, periodLabel, qualityView, settingSummary, shareLabel,
  shortDate, sparklineHeights, termVectors, typicalText, utcDateKey, weekMonthLabel, weekOptionText, weekRangeText,
  weekSummary, type ActivityWeek, type BreakdownRow, type GroupCard, type GroupSort, type TopShare,
} from '@/lib/families/presentation';
import type { AnnotatedIncident } from '@/lib/problems';
import { ChevronDown, ChevronRight, FlaskConical, X } from 'lucide-react';

type Strictness = keyof typeof FAMILIES_DISPLAY.strictness;
type Ready = Extract<FamiliesState, { status: 'ready' }>;

const NEUTRAL = 'hsl(215,14%,72%)';
const ACCENT = 'hsl(209,96%,35%)';
/** Composition bar: repeating in the app's blue, one-off in neutral gray. */
const REPEATING_FILL = 'hsl(209,60%,38%)';
const ONE_OFF_FILL = 'hsl(215,10%,80%)';
const MUTED_BAR = 'hsl(215,10%,86%)';
const selectClass = 'bg-secondary border border-border rounded-md px-3 py-1.5 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary';
const sectionTitle = 'text-[15px] font-semibold text-foreground';
const cardTitle = 'text-[14px] font-semibold text-card-foreground';
const subTitle = 'text-[12px] font-medium text-card-foreground/70';
const smallButton = 'text-[12px] px-2.5 py-1.5 rounded-md border border-border bg-secondary text-secondary-foreground';

function shareText(share: TopShare, missing: string): string {
  if (share.value === null) return missing;
  return `${share.value} (${share.pct}%)${share.mixed ? ` · ${FAMILIES_COPY.mixed}` : ''}`;
}

const incidentsText = (n: number) => `${formatCount(n)} ${n === 1 ? 'incident' : 'incidents'}`;
const weeksText = (seen: number, of: number) => `seen in ${seen} of ${of} ${of === 1 ? 'week' : 'weeks'}`;

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
              <title>{`${weekRangeText(calendar[i])}: ${incidentsText(v)}${covered ? '' : ` · data through ${shortDate(dataThroughDate)}`}`}</title>
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

/** One incident: date · Service · Handled by, the short description; the source text only on request. */
function IncidentLine({ inc }: { inc: AnnotatedIncident }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-card-foreground/10 first:border-t-0 py-2.5" data-testid="incident-line">
      <div className="text-[11px] text-card-foreground/55">
        {inc.Opened ? inc.Opened.slice(0, 16) : 'No date'} · {dimensionValue(inc, 'service') ?? FAMILIES_COPY.noService} · Handled by {dimensionValue(inc, 'assignmentGroup') ?? FAMILIES_COPY.noHandlingGroup}
      </div>
      <div className="text-[13px] text-card-foreground font-medium mt-0.5">{inc.shortDescClean || '(no short description)'}</div>
      {inc.descClean && (
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="mt-1 flex items-center gap-1 text-[12px] text-card-foreground/65 hover:text-card-foreground">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          {open ? FAMILIES_COPY.hideIncidentDetails : FAMILIES_COPY.viewIncidentDetails}
        </button>
      )}
      {open && inc.descClean && <div className="text-[12px] text-card-foreground/70 mt-1 whitespace-pre-wrap pl-4" data-testid="incident-details">{inc.descClean}</div>}
    </div>
  );
}

/** Incidents, newest first: 5 at first, more on request, never all at once. */
function IncidentList({ incidents }: { incidents: AnnotatedIncident[] }) {
  const first = FAMILIES_DISPLAY.incidentFirst;
  const [shown, setShown] = useState<number>(first);
  return (
    <div data-testid="incident-list" data-count={incidents.length}>
      {incidents.slice(0, shown).map((inc, i) => <IncidentLine key={i} inc={inc} />)}
      <div className="flex flex-wrap items-center gap-3 mt-2">
        {shown < incidents.length && (
          <button type="button" onClick={() => setShown(s => s + FAMILIES_DISPLAY.incidentStep)} className={smallButton}>{FAMILIES_COPY.showMoreIncidentsLabel}</button>
        )}
        {shown > first && <button type="button" onClick={() => setShown(first)} className={smallButton}>{FAMILIES_COPY.showFewerIncidents}</button>}
        {incidents.length > first && (
          <span className="text-[12px] text-card-foreground/55">{FAMILIES_COPY.showing(Math.min(shown, incidents.length), incidents.length)}</span>
        )}
      </div>
    </div>
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
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

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
  const months = useMemo(() => globalFilters?.months ?? [], [globalFilters]);
  const otherFilters = (filterLabel ?? 'all') !== 'all'
    || (!!globalFilters && (isDimensionFiltered(globalFilters.services) || isDimensionFiltered(globalFilters.serviceOfferings)));
  const labelsFor = (s: Strictness) => (partitions ? partitions.labels[partitions.thresholds.indexOf(FAMILIES_DISPLAY.strictness[s])] : null);
  const labels = labelsFor(shownStrictness);

  // The same text the groups were built from, for naming them.
  const rawTexts = useMemo(() => incidents.map(i => openTimeText(i.shortDescClean, i.descClean)), [incidents]);
  const docs = useMemo(
    () => (partitions ? buildVariant(rawTexts, { variant: partitions.variant, tau: partitions.variant === 'R0' ? undefined : partitions.tau }) : null),
    [partitions, rawTexts],
  );
  // Templates of the active text cleaning, refitted on the same texts, for readable names only.
  const templates = useMemo(
    () => (partitions && partitions.variant !== 'R0' ? fitTemplates(rawTexts, partitions.tau!) : null),
    [partitions, rawTexts],
  );
  const nameOf = useMemo(() => {
    const cleanVariant = partitions?.variant;
    return (row: number) => (templates && cleanVariant && cleanVariant !== 'R0' ? cleanedGroupName(incidents[row], templates, cleanVariant) : null)
      ?? groupName(incidents[row]);
  }, [templates, partitions, incidents]);
  const vectors = useMemo(() => (docs ? termVectors(docs) : null), [docs]);
  const identity = useMemo(() => (labels ? groupIdentity(incidents, labels) : null), [incidents, labels]);
  const texts = useMemo(() => (labels && docs && vectors ? groupTexts(incidents, docs, labels, vectors) : null), [incidents, docs, vectors, labels]);
  const summary = useMemo(() => (labels ? weekSummary(incidents, view, labels, selectedWeek) : null), [incidents, view, labels, selectedWeek]);
  const cards = useMemo(
    () => (labels && identity && texts
      ? groupCards({ incidents, view, labels, identity, texts, weeksWithData: weeks, selectedWeek, dataThroughDate: throughDate, sort, months, nameOf })
      : []),
    [incidents, view, labels, identity, texts, weeks, selectedWeek, throughDate, sort, months, nameOf],
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
    const sameText = previous.variant === partitions?.variant && previous.tau === partitions?.tau;
    return { name: sameText ? FAMILIES_COPY.strictnessLabels[previous.strictness] : 'Before', groups: s.groups, oneOff: composition(s).oneOffPct };
  }, [previous, incidents, view, partitions]);

  const calendar = useMemo(() => calendarWeeks(weeks), [weeks]);
  const selectedIndex = calendar.indexOf(selectedWeek);
  const comparable = isWeekComparable(selectedWeek, throughDate);
  const oneOffs = useMemo(
    () => (labels && oneOffOpen ? membersNewestFirst(incidents, view, labels, 'one-off', selectedWeek) : []),
    [incidents, view, labels, oneOffOpen, selectedWeek],
  );
  const explorer = useMemo(
    () => (partitions && settingsOpen ? partitions.thresholds.map((s, i) => thresholdRow(s, partitions.labels[i])) : []),
    [partitions, settingsOpen],
  );

  if (!familiesEnabled()) return <EmptyState message="This view is not available." />;

  const changeSetting = (apply: () => void) => {
    apply();
    setOpenGroup(null);
    setCardsShown(FAMILIES_DISPLAY.topCards);
  };
  const openSettings = () => {
    setSettingsOpen(true);
    requestAnimationFrame(() => settingsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  };
  const visibleCards = cards.slice(0, cardsShown);
  const detailCard = openGroup !== null ? cards.find(c => c.label === openGroup) ?? null : null;
  const isExploratoryDefault = variant === FAMILIES_DISPLAY.defaultVariant && tau === FAMILIES_DISPLAY.defaultTau && strictness === 'balanced';
  const kpiPct = summary ? largestRemainderPct([summary.grouped, summary.oneOff]) : [0, 0];
  const mix = current ? composition(current) : null;
  // Top 5 / next 20 / remaining split the displayed repeating share, so every number on the page adds up.
  const repeatingParts = segments.filter(s => s.key !== 'oneOff');
  const partPcts = mix ? largestRemainderPct(repeatingParts.map(s => s.incidents), mix.repeatingPct) : [];
  const period = periodLabel(months, firstOpened.slice(0, 10), throughDate);
  const moreCards = Math.min(FAMILIES_DISPLAY.topCards, cards.length - visibleCards.length);
  const groupingStatus = `${FAMILIES_COPY.grouping}: ${FAMILIES_COPY.strictnessLabels[strictness]} · ${FAMILIES_COPY.textCleaningLabels[variant]}`;

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

      {ready && labels && identity && summary && current && mix && (
        <>
          {!identity.numbersUnique && (
            <div className="mb-4 text-[12px] text-muted-foreground" data-testid="numbers-not-unique">{FAMILIES_COPY.numbersNotUnique}</div>
          )}

          {/* 1. Selected week */}
          <section className="v1-card p-5 mb-6" data-testid="week-summary" aria-label={FAMILIES_COPY.selectedWeek}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex flex-wrap items-center gap-3 min-w-0 max-w-full">
                <h2 className={cardTitle}>{FAMILIES_COPY.selectedWeek}</h2>
                <select aria-label="Week" value={selectedWeek} onChange={e => setSelectedWeek(e.target.value)} className={`${selectClass} max-w-full min-w-0`}>
                  {[...weeks].reverse().map(w => <option key={w} value={w}>{weekOptionText(w, throughDate)}</option>)}
                </select>
              </div>
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
                <div className="text-[12px] text-card-foreground/80 mt-1">repeating</div>
                <div className="text-[12px] text-card-foreground/60" data-testid="kpi-grouped">{formatCount(summary.grouped)} incidents · {formatCount(summary.groups)} {summary.groups === 1 ? 'group' : 'groups'}</div>
              </div>
              <div>
                <div className="text-[22px] font-bold text-card-foreground leading-none tabular-nums" data-testid="kpi-one-off-pct">{kpiPct[1]}%</div>
                <div className="text-[12px] text-card-foreground/80 mt-1">one-off</div>
                <div className="text-[12px] text-card-foreground/60" data-testid="kpi-one-off">{formatCount(summary.oneOff)} incidents</div>
              </div>
            </div>
            {!comparable && through && (
              <p className="text-[12px] text-card-foreground/70 mt-4" data-testid="coverage-message">{FAMILIES_COPY.coverageMessage(shortDate(throughDate))}</p>
            )}
          </section>

          {/* 2–3. Selected period: how much repeats, and how concentrated */}
          <section className="v1-card p-5 mb-6" data-testid="period-summary" aria-label={FAMILIES_COPY.selectedPeriod}>
            <h2 className={cardTitle}>{FAMILIES_COPY.selectedPeriod}</h2>
            <p className="text-[13px] text-card-foreground/80 mt-1" data-testid="period-label">
              {period} · {incidentsText(view.length)}{otherFilters ? ' · current filters' : ''}
            </p>
            <div className="mt-4" data-testid="distribution">
              <h3 className={subTitle}>{FAMILIES_COPY.distributionTitle}</h3>
              <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1.5 text-card-foreground">
                <span><span className="text-[22px] font-bold tabular-nums" data-testid="composition-repeating">{mix.repeatingPct}%</span> <span className="text-[13px]">repeating patterns</span></span>
                <span><span className="text-[22px] font-bold tabular-nums" data-testid="composition-one-off">{mix.oneOffPct}%</span> <span className="text-[13px]">one-off incidents</span></span>
              </div>
              {view.length > 0 && (
                <div className="flex w-full h-3 gap-[2px] mt-2" role="img" aria-label={`Repeating patterns ${mix.repeatingPct}%, one-off incidents ${mix.oneOffPct}%`}>
                  {[{ key: 'repeating', n: mix.repeating, pct: mix.repeatingPct, fill: REPEATING_FILL, label: 'Repeating patterns' },
                    { key: 'oneOff', n: mix.oneOff, pct: mix.oneOffPct, fill: ONE_OFF_FILL, label: 'One-off incidents' }]
                    .filter(s => s.n > 0)
                    .map((s, i, all) => (
                      <div key={s.key} data-testid="distribution-segment" data-key={s.key} data-count={s.n} data-pct={s.pct}
                        title={`${s.label}: ${incidentsText(s.n)} of ${formatCount(view.length)} (${s.pct}%)`}
                        className={`${i === 0 ? 'rounded-l' : ''} ${i === all.length - 1 ? 'rounded-r' : ''}`}
                        style={{ flexGrow: s.n, flexBasis: 0, minWidth: 2, background: s.fill }} />
                    ))}
                </div>
              )}
              <div className="text-[11px] text-card-foreground/55 mt-1">{formatCount(mix.repeating)} repeating · {formatCount(mix.oneOff)} one-off</div>
              <div className="mt-3 text-[13px] text-card-foreground space-y-0.5" data-testid="concentration">
                {current.groups === 0 && <p>No repeating groups in the selected period.</p>}
                {current.groups > 0 && current.groups <= FAMILIES_DISPLAY.distributionTop && (
                  <p>{current.groups === 1 ? 'The only repeating group accounts for' : `The ${current.groups} repeating groups account for`} {shareLabel(mix.repeatingPct, mix.repeating)} of all incidents.</p>
                )}
                {current.groups > FAMILIES_DISPLAY.distributionTop && (
                  <>
                    <p>Top {FAMILIES_DISPLAY.distributionTop} repeating groups account for <strong>{shareLabel(partPcts[0], repeatingParts[0].incidents)}</strong> of all incidents.</p>
                    <p>The remaining repeating incidents are spread across {formatCount(current.groups - FAMILIES_DISPLAY.distributionTop)} other {current.groups - FAMILIES_DISPLAY.distributionTop === 1 ? 'group' : 'groups'}.</p>
                  </>
                )}
              </div>
              {repeatingParts.length > 1 && (
                <div className="mt-2">
                  <button type="button" onClick={() => setBreakdownOpen(o => !o)} aria-expanded={breakdownOpen} className="flex items-center gap-1.5 text-[12px] text-card-foreground/65">
                    {breakdownOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    {FAMILIES_COPY.repeatingBreakdown}
                  </button>
                  {breakdownOpen && (
                    <ul className="mt-2 text-[12px] text-card-foreground/80 space-y-0.5" data-testid="repeating-breakdown">
                      {repeatingParts.map((s, i) => (
                        <li key={s.key} data-count={s.incidents} data-pct={partPcts[i]}>{s.label}: {incidentsText(s.incidents)} · {shareLabel(partPcts[i], s.incidents)} of all incidents</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* 4. Largest repeating groups */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
            <h2 className={sectionTitle}>{FAMILIES_COPY.cardsTitle}</h2>
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
              {FAMILIES_COPY.sortLabel}
              <select aria-label="Sort by" value={sort} onChange={e => setSort(e.target.value as GroupSort)} className={selectClass}>
                <option value="largest">{FAMILIES_COPY.sortLabels.largest}</option>
                <option value="selectedWeek">{FAMILIES_COPY.sortLabels.selectedWeek}</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-4 text-[12px] text-muted-foreground" data-testid="grouping-status">
            <span>{groupingStatus}</span>
            <button type="button" onClick={openSettings} className="underline underline-offset-2 hover:text-foreground">{FAMILIES_COPY.changeGrouping}</button>
            {updating && <span className="text-foreground" data-testid="updating">· {FAMILIES_COPY.updating}</span>}
          </div>
          {cards.length === 0 ? (
            <EmptyState message={FAMILIES_COPY.noGroupsThisWeek} />
          ) : (
            <>
              <div className={`grid grid-cols-1 lg:grid-cols-2 gap-4 ${updating ? 'opacity-60' : ''}`} data-testid="group-cards">
                {visibleCards.map(card => (
                  <GroupCardView key={card.label} card={card} sort={sort} calendar={calendar} selectedIndex={selectedIndex} throughDate={throughDate} onOpen={() => setOpenGroup(card.label)} />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                {moreCards > 0 && (
                  <button type="button" onClick={() => setCardsShown(n => n + FAMILIES_DISPLAY.topCards)} className={smallButton}>{FAMILIES_COPY.showMore(moreCards)}</button>
                )}
                {cardsShown > FAMILIES_DISPLAY.topCards && (
                  <button type="button" onClick={() => setCardsShown(FAMILIES_DISPLAY.topCards)} className={smallButton}>{FAMILIES_COPY.showFewer}</button>
                )}
                <span className="text-[12px] text-muted-foreground" data-testid="cards-showing">({FAMILIES_COPY.showing(visibleCards.length, cards.length)})</span>
              </div>
            </>
          )}

          {/* One-off incidents of the selected week */}
          {summary.oneOff > 0 && (
            <section className="v1-card mt-6" data-testid="one-off-row" aria-label={FAMILIES_COPY.oneOffTitle}>
              <button type="button" onClick={() => setOneOffOpen(o => !o)} aria-expanded={oneOffOpen} className="w-full flex flex-wrap items-center gap-2 p-4 text-left text-[13px] text-card-foreground">
                {oneOffOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <span>
                  <span className="font-medium">{FAMILIES_COPY.oneOffLine(summary.oneOff)}</span> · <span className="underline-offset-2 hover:underline">{oneOffOpen ? FAMILIES_COPY.hideIncidents : FAMILIES_COPY.viewIncidents}</span>
                </span>
              </button>
              {oneOffOpen && <div className="px-5 pb-4" data-testid="one-off-list"><IncidentList incidents={oneOffs} /></div>}
            </section>
          )}

          {/* Grouping settings · For analysts */}
          <div className="v1-card mt-6 text-card-foreground scroll-mt-4" data-testid="settings-panel" ref={settingsRef}>
            <button type="button" onClick={() => setSettingsOpen(o => !o)} aria-expanded={settingsOpen} className="w-full flex flex-wrap items-center gap-2 p-4 text-left text-[13px]">
              {settingsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              <span className="font-medium">{FAMILIES_COPY.settingsTitle}</span>
              <span className="text-card-foreground/55">· {FAMILIES_COPY.analystDetails}</span>
            </button>
            {settingsOpen && (
              <div className="px-5 pb-5 space-y-4" data-testid="settings-body">
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
                <div className="text-[13px]" aria-live="polite" data-testid="result-line">
                  {updating ? (
                    <span className="text-card-foreground/70">{FAMILIES_COPY.updating}</span>
                  ) : (
                    <>
                      <span className="font-medium">{FAMILIES_COPY.strictnessLabels[shownStrictness]}: {formatCount(current.groups)} {current.groups === 1 ? 'group' : 'groups'} · {mix.oneOffPct}% one-off</span>
                      {previousSummary && ' '}
                      {previousSummary && (
                        <span className="text-card-foreground/60" data-testid="previous-setting">({previousSummary.name}: {formatCount(previousSummary.groups)} · {previousSummary.oneOff}%)</span>
                      )}
                    </>
                  )}
                </div>
                <div className="space-y-4 text-[12px]">
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
              </div>
            )}
          </div>

          {detailCard && texts && (
            <GroupDetail
              card={detailCard}
              words={texts.get(detailCard.label)!.commonWords}
              calendar={calendar}
              months={months}
              period={period}
              otherFilters={otherFilters}
              selectedWeek={selectedWeek}
              throughDate={throughDate}
              fileMembers={incidents.filter((_, i) => labels[i] === detailCard.label)}
              members={membersNewestFirst(incidents, view, labels, detailCard.label)}
              onClose={() => setOpenGroup(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

/** The selected week's line for a card or the detail, plus the last fully covered week when the data ends inside it. */
function WeekLines({ card, throughDate, muted }: { card: GroupCard; throughDate: string; muted: boolean }) {
  return (
    <div className={muted ? 'text-[12px] text-card-foreground/55 space-y-0.5' : 'text-[13px] text-card-foreground space-y-0.5'}>
      <div data-testid="fact-line">
        {muted ? 'Selected week: ' : ''}{factLine(card, throughDate)}
        {card.comparable && card.pct !== null && <span className="text-card-foreground/45 ml-1.5 text-[11px]">({card.pct > 0 ? '+' : ''}{card.pct}%)</span>}
      </div>
      {card.lastCovered && <div className={muted ? '' : 'text-[12px] text-card-foreground/70'} data-testid="last-covered-line">{lastCoveredLine(card.lastCovered)}</div>}
    </div>
  );
}

function GroupCardView({ card, sort, calendar, selectedIndex, throughDate, onOpen }: {
  card: GroupCard; sort: GroupSort; calendar: string[]; selectedIndex: number; throughDate: string; onOpen: () => void;
}) {
  const weekFirst = sort === 'selectedWeek';
  return (
    <div className="v1-card p-5 flex flex-col gap-2.5 min-w-0" data-testid="group-card">
      <div className="text-[14px] font-semibold text-card-foreground leading-snug min-w-0 break-words" title={card.name.full} data-testid="group-name">{card.name.short}</div>
      <div className="text-[13px] text-card-foreground" data-testid="card-totals">
        {incidentsText(card.total)} · {weeksText(card.weeksAppeared, card.totalWeeks)}
        {card.lastSeen && <span className="text-card-foreground/60" data-testid="last-seen"> · {lastSeenText(card.lastSeen)}</span>}
      </div>
      {weekFirst && <WeekLines card={card} throughDate={throughDate} muted={false} />}
      <div className="text-[12px] text-card-foreground/75 space-y-0.5">
        <div data-testid="card-service">Main service: {shareText(card.service, FAMILIES_COPY.noService)}</div>
        <div data-testid="card-handled">Mostly handled by {shareText(card.handledBy, FAMILIES_COPY.noHandlingGroup)}</div>
      </div>
      <Sparkline series={card.sparkline} calendar={calendar} selected={selectedIndex} dataThroughDate={throughDate} />
      {!weekFirst && <WeekLines card={card} throughDate={throughDate} muted />}
      <div className="flex justify-end">
        <button type="button" onClick={onOpen} className="text-[12px] text-card-foreground font-medium hover:underline">{FAMILIES_COPY.seeIncidents}</button>
      </div>
    </div>
  );
}

/** Weekly bars over every calendar week; weeks outside the selected period drawn muted and not counted. */
function ActivityChart({ activity, throughDate }: { activity: ActivityWeek[]; throughDate: string }) {
  const h = 96;
  const w = 6;
  const gap = 2;
  const width = activity.length * (w + gap);
  const values = activity.map(a => (a.inPeriod ? a.count : a.fileCount));
  const max = Math.max(1, ...values);
  const ticks = monthTicks(activity.map(a => a.week));
  return (
    <div data-testid="activity-chart">
      <svg viewBox={`0 0 ${width} ${h + 1}`} preserveAspectRatio="none" height={h + 1} style={{ width: '100%' }} role="img" aria-label="Incidents per week">
        <line x1={0} x2={width} y1={h + 0.5} y2={h + 0.5} stroke={NEUTRAL} strokeWidth={0.5} />
        {activity.map((a, i) => {
          const v = values[i];
          const bar = v === 0 ? 0 : Math.max(3, (v / max) * h);
          const covered = isWeekComparable(a.week, throughDate);
          const color = a.inPeriod ? ACCENT : MUTED_BAR;
          return (
            <rect key={a.week} x={i * (w + gap)} y={h - bar} width={w} height={bar} data-testid="activity-week" data-week={a.week}
              data-count={a.count} data-in-period={a.inPeriod} fill={covered ? color : 'none'} stroke={covered ? 'none' : color} strokeWidth={covered ? 0 : 1}>
              <title>{a.inPeriod
                ? `${weekRangeText(a.week)}: ${incidentsText(a.count)}${covered ? '' : ` · data through ${shortDate(throughDate)}`}`
                : `${weekRangeText(a.week)}: ${incidentsText(a.fileCount)} in the whole file · outside the selected period`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="relative h-4 mt-1 text-[10px] text-card-foreground/55" data-testid="activity-axis">
        {ticks.map(t => (
          <span key={t.index} className="absolute whitespace-nowrap" style={{ left: `${(t.index / activity.length) * 100}%` }}>{t.label}</span>
        ))}
      </div>
    </div>
  );
}

function BreakdownList({ title, rows, missing, testId }: { title: string; rows: BreakdownRow[]; missing: string; testId: string }) {
  return (
    <div data-testid={testId}>
      <h3 className={cardTitle}>{title}</h3>
      <ul className="mt-2 space-y-1 text-[12px] text-card-foreground">
        {rows.map((r, i) => (
          <li key={i} className={`flex justify-between gap-3 ${i === 0 ? 'font-medium' : 'text-card-foreground/80'}`} data-testid="breakdown-row" data-count={r.count}>
            <span className="truncate">{r.otherValues ? `Other (${r.otherValues} more)` : r.value ?? missing}</span>
            <span className="shrink-0 tabular-nums">{formatCount(r.count)} · {r.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GroupDetail({ card, words, calendar, months, period, otherFilters, selectedWeek, throughDate, fileMembers, members, onClose }: {
  card: GroupCard; words: string[]; calendar: string[]; months: string[]; period: string; otherFilters: boolean; selectedWeek: string;
  throughDate: string; fileMembers: AnnotatedIncident[]; members: AnnotatedIncident[]; onClose: () => void;
}) {
  const [analystOpen, setAnalystOpen] = useState(false);
  // One population throughout: the group's incidents in the displayed population (`members`).
  const n = members.length;
  const activity = groupActivity(members, fileMembers, calendar, months);
  const periodWeekCount = activity.filter(a => a.inPeriod).length;
  const seenWeeks = activity.filter(a => a.inPeriod && a.count > 0).length;
  const undated = members.filter(m => !m.week).length;
  const services = breakdownRows(members.map(m => dimensionValue(m, 'service')));
  const handled = breakdownRows(members.map(m => dimensionValue(m, 'assignmentGroup')));
  const history = groupHistory(fileMembers);
  const filtered = months.length > 0 || otherFilters;
  const since = history.firstDate ? formatDataThrough(new Date(`${history.firstDate}T00:00:00Z`)) : '';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={onClose}>
      <div className="v1-card w-full max-w-3xl max-h-[88vh] overflow-y-auto m-4 shadow-xl" onClick={e => e.stopPropagation()} data-testid="group-detail" role="dialog" aria-label={card.name.short}>
        <div className="flex items-start justify-between gap-3 p-5 border-b border-card-foreground/10">
          <div className="min-w-0">
            <h2 className="text-[16px] font-bold text-card-foreground leading-snug break-words" title={card.name.full}>{card.name.short}</h2>
            <div className="text-[13px] text-card-foreground mt-1.5" data-testid="detail-count" data-count={n}>{incidentsText(n)} · {weeksText(seenWeeks, periodWeekCount)}</div>
            <div className="text-[12px] text-card-foreground/65 mt-0.5" data-testid="detail-context">
              {filtered
                ? `${incidentsText(n)} in ${period}${otherFilters ? ' with the current filters' : ''} · ${incidentsText(history.total)} in the whole file since ${since}`
                : `${incidentsText(history.total)} since ${since}`}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-card-foreground/50 hover:text-card-foreground p-1 shrink-0"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-6">
          <div>
            <h3 className={cardTitle}>{FAMILIES_COPY.recentTitle}</h3>
            <div className="mt-1.5">
              <div className="text-[12px] text-card-foreground/60">Selected week ({weekRangeText(selectedWeek)})</div>
              <WeekLines card={card} throughDate={throughDate} muted={false} />
            </div>
          </div>
          <div>
            <h3 className={cardTitle}>{FAMILIES_COPY.activityTitle}</h3>
            <p className="text-[12px] text-card-foreground/70 mt-0.5 mb-2" data-testid="activity-context">
              {incidentsText(n - undated)} across {seenWeeks} of {periodWeekCount} {periodWeekCount === 1 ? 'week' : 'weeks'}{undated > 0 ? ` · ${incidentsText(undated)} without a date` : ''}
            </p>
            <ActivityChart activity={activity} throughDate={throughDate} />
            <div className="text-[11px] text-card-foreground/55 mt-1 space-y-0.5">
              {!isWeekComparable(calendar[calendar.length - 1] ?? '', throughDate) && <p>Outlined bar: week with data through {shortDate(throughDate)}.</p>}
              {months.length > 0 && <p>Lighter bars: weeks outside {period}, from the whole file; not counted above.</p>}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <BreakdownList title="Service" rows={services} missing={FAMILIES_COPY.noService} testId="detail-service" />
            <BreakdownList title="Handled by" rows={handled} missing={FAMILIES_COPY.noHandlingGroup} testId="detail-handled" />
          </div>
          <div>
            <h3 className={cardTitle}>Incidents ({formatCount(n)}) · newest first</h3>
            <div className="mt-1"><IncidentList incidents={members} /></div>
          </div>
          <div className="border-t border-card-foreground/10 pt-3">
            <button type="button" onClick={() => setAnalystOpen(o => !o)} aria-expanded={analystOpen} className="flex items-center gap-1.5 text-[12px] text-card-foreground/65">
              {analystOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              {FAMILIES_COPY.analystDetails}
            </button>
            {analystOpen && (
              <div className="mt-2 space-y-2 text-[12px] text-card-foreground/80" data-testid="detail-analyst">
                <div title={FAMILIES_COPY.groupIdTooltip} data-testid="group-id">Group number within the current grouping setting: {card.id}</div>
                {card.comparable && card.typical !== null && (
                  <div>{averageLabel(card.baselineWeeks)}: {typicalText(card.typical)} — mean weekly count of this group over the {card.baselineWeeks === 1 ? 'week' : `${card.baselineWeeks} weeks`} with data just before the selected week (weeks with none count as 0).</div>
                )}
                {words.length > 0 && (
                  <div>
                    <div className={subTitle}>{FAMILIES_COPY.commonWords}</div>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {words.map(w => <span key={w} className="px-2 py-0.5 rounded border border-border text-[12px] text-card-foreground">{w}</span>)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
