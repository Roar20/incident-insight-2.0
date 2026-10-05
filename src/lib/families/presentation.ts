/**
 * Presentation layer of the experimental Repeating Incident Groups view
 * (FAM-01.1). Nothing here changes how groups are built: it reads the frozen
 * M1 labels and describes them in plain language — names, weekly facts,
 * sparklines, who handles them.
 *
 * Group names and common words come from the same word TF-IDF representation
 * the groups were built from (same tokens, same weights). Sums here run in a
 * row-order-independent order, so names do not change when a file's rows are
 * shuffled; they are never used to decide membership.
 */
import { FAMILIES_DISPLAY } from '../../config/familiesDisplay';
import type { AnnotatedIncident } from '../problems';
import { weekKey, weekStart } from '../periods';
import { baselineWeeksFor } from '../weekly';
import { dimensionValue } from '../serviceDimension';
import { FAMILIES_RESEARCH } from '../../config/familiesResearch';
import { familyIdentity } from './view';
import { pyCollapseSpace, pyDigitsToZero, pyLower, pyStrip, pyWords } from './pyText';
import { identifierType, type Templates } from './variants';

type Incident = Pick<AnnotatedIncident,
  'Number' | 'Opened' | 'week' | 'extraFields' | 'Assignment group' | 'clusterId' | 'shortDescClean' | 'descClean'>;

// ---------------------------------------------------------------------------
// Weeks
// ---------------------------------------------------------------------------

/** Every ISO week from the first to the last week with data, empty weeks included. */
export function calendarWeeks(weeksWithData: string[]): string[] {
  if (weeksWithData.length === 0) return [];
  const out: string[] = [];
  const last = weekStart(weeksWithData[weeksWithData.length - 1])!.getTime();
  for (let d = weekStart(weeksWithData[0])!; d.getTime() <= last; d = new Date(d.getTime() + 7 * 86400000)) {
    out.push(weekKey(d.toISOString().slice(0, 19).replace('T', ' ')));
  }
  return out;
}

const monthDay = (d: Date) => d.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "Sep 29 – Oct 5": the ISO week's Monday to Sunday. */
export function weekRangeText(key: string): string {
  const start = weekStart(key);
  if (!start) return key;
  return `${monthDay(start)} – ${monthDay(new Date(start.getTime() + 6 * 86400000))}`;
}

// ---------------------------------------------------------------------------
// Coverage: which weeks the file's data fully covers
// ---------------------------------------------------------------------------

/** UTC calendar date "YYYY-MM-DD" of a timestamp, as week bucketing reads it. */
export function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Calendar date of the ISO week's Sunday, "YYYY-MM-DD". */
export function weekEndDate(key: string): string {
  const start = weekStart(key);
  return start ? utcDateKey(new Date(start.getTime() + 6 * 86400000)) : '';
}

/** "Sep 30" for a "YYYY-MM-DD" calendar date. */
export function shortDate(dateKey: string): string {
  return monthDay(new Date(`${dateKey}T00:00:00Z`));
}

/**
 * A week is compared with typical only when the file's data reaches its
 * Sunday: `dataThroughDate >= weekEndDate`, by calendar date. Nothing is
 * inferred about incidents after the Data-through date.
 */
export function isWeekComparable(week: string, dataThroughDate: string): boolean {
  return !!dataThroughDate && dataThroughDate >= weekEndDate(week);
}

/** Week selector label: the ISO range, plus "data through <date>" when the data ends inside the week. */
export function weekOptionText(week: string, dataThroughDate: string): string {
  return isWeekComparable(week, dataThroughDate)
    ? weekRangeText(week)
    : `${weekRangeText(week)} · data through ${shortDate(dataThroughDate)}`;
}

/** "3", "2.5" — one decimal only when not a whole number. */
export function typicalText(typical: number): string {
  const rounded = Math.round(typical * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export const formatCount = (n: number) => n.toLocaleString('en-US');
export const wholePct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * Whole percentages of `counts` that always sum to 100 — or to `points`, to
 * split an already rounded share among its parts (largest-remainder method):
 * floors first, then the leftover points go to the largest remainders, ties
 * to the earlier position. All zeros when the total is 0.
 */
export function largestRemainderPct(counts: number[], points = 100): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return counts.map(() => 0);
  const exact = counts.map(c => (c * points) / total);
  const out = exact.map(Math.floor);
  let left = points - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ r: x - Math.floor(x), i })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i]++;
  return out;
}

// ---------------------------------------------------------------------------
// Group identity: G01, G02… by total size, then canonical order
// ---------------------------------------------------------------------------

export interface GroupIdentity {
  /** Group label → "G01"… */
  ids: Map<number, string>;
  /** Group label → canonical rank (0 = first), the final tie-breaker everywhere. */
  rank: Map<number, number>;
  numbersUnique: boolean;
}

export function groupIdentity(incidents: Incident[], labels: Int32Array): GroupIdentity {
  const { displayIds, numbersUnique } = familyIdentity(incidents, labels);
  const ids = new Map<number, string>();
  const rank = new Map<number, number>();
  for (const [label, display] of displayIds) {
    const r = Number(display.slice(1)) - 1;
    rank.set(label, r);
    ids.set(label, `G${String(r + 1).padStart(2, '0')}`);
  }
  return { ids, rank, numbersUnique };
}

// ---------------------------------------------------------------------------
// Week summary (selected week, displayed population)
// ---------------------------------------------------------------------------

export interface WeekSummary {
  total: number;
  grouped: number;
  oneOff: number;
  /** Groups with at least one incident in the week. */
  groups: number;
}

export function weekSummary(incidents: Incident[], view: Incident[], labels: Int32Array, week: string): WeekSummary {
  const rowOf = new Map<Incident, number>();
  incidents.forEach((inc, i) => rowOf.set(inc, i));
  const groups = new Set<number>();
  let total = 0;
  let grouped = 0;
  for (const inc of view) {
    if (inc.week !== week) continue;
    total++;
    const l = labels[rowOf.get(inc)!];
    if (l >= 0) {
      grouped++;
      groups.add(l);
    }
  }
  return { total, grouped, oneOff: total - grouped, groups: groups.size };
}

// ---------------------------------------------------------------------------
// Representative incident and common words
// ---------------------------------------------------------------------------

/** Same tokens as the word TF-IDF that built the groups: `(?u)\b\w\w+\b` and adjacent bigrams. */
const TOKEN = /[\p{L}\p{N}_]{2,}/gu;
/** Type tokens R2 inserts for identifiers; never shown as words. */
const TYPE_TOKEN = /(^|\s)tok(hex|id|num)(\s|$)/;

function termCounts(doc: string): Map<string, number> {
  const tokens = pyLower(doc).match(TOKEN) ?? [];
  const counts = new Map<string, number>();
  const add = (t: string) => counts.set(t, (counts.get(t) ?? 0) + 1);
  tokens.forEach(add);
  for (let i = 0; i + 1 < tokens.length; i++) add(tokens[i] + ' ' + tokens[i + 1]);
  return counts;
}

const byTerm = (a: [string, number], b: [string, number]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/** l2-normalised sublinear TF-IDF rows keyed by term, terms sorted (row-order independent). */
export function termVectors(docs: string[]): [string, number][][] {
  const n = docs.length;
  const counts = docs.map(termCounts);
  const df = new Map<string, number>();
  for (const c of counts) for (const t of c.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  return counts.map(c => {
    const row = [...c.entries()].map(([t, k]): [string, number] => [t, (Math.log(k) + 1) * (Math.log((n + 1) / (df.get(t)! + 1)) + 1)]);
    row.sort(byTerm);
    const norm = Math.sqrt(row.reduce((s, [, x]) => s + x * x, 0));
    if (norm > 0) for (const r of row) r[1] /= norm;
    return row;
  });
}

export interface GroupText {
  /** Row index of the most representative member. */
  representative: number;
  /** Up to N common words (highest mean TF-IDF weight in the group), identifier tokens excluded. */
  commonWords: string[];
}

/**
 * Per group: the member with the highest mean cosine similarity to the other
 * members (ties → earliest Opened, then canonical member order), and the
 * group's most characteristic words.
 */
export function groupTexts(incidents: Incident[], docs: string[], labels: Int32Array, vectors = termVectors(docs)): Map<number, GroupText> {
  const memberKey = (i: number) => `${incidents[i].Number.trim()}\u0000${incidents[i].shortDescClean}\u0000${incidents[i].descClean}\u0000${incidents[i].Opened}`;
  const members = new Map<number, number[]>();
  labels.forEach((l, i) => {
    if (l < 0) return;
    const list = members.get(l);
    if (list) list.push(i);
    else members.set(l, [i]);
  });
  const out = new Map<number, GroupText>();
  for (const [label, rowsUnordered] of members) {
    const rows = rowsUnordered.slice().sort((a, b) => (memberKey(a) < memberKey(b) ? -1 : memberKey(a) > memberKey(b) ? 1 : a - b));
    const sum = new Map<string, number>();
    for (const r of rows) for (const [t, x] of vectors[r]) sum.set(t, (sum.get(t) ?? 0) + x);
    let best = -1;
    let bestScore = -Infinity;
    for (const r of rows) {
      let dot = 0;
      let self = 0;
      for (const [t, x] of vectors[r]) {
        dot += x * sum.get(t)!;
        self += x * x;
      }
      // Rounded so floating-point noise never decides between equally typical members.
      const score = Math.round(((dot - self) / (rows.length - 1)) * 1e12);
      const better = score > bestScore
        || (score === bestScore && (incidents[r].Opened || '￿') < (incidents[best].Opened || '￿'));
      if (better) {
        best = r;
        bestScore = score;
      }
    }
    const words = [...sum.entries()]
      .filter(([t]) => !TYPE_TOKEN.test(t))
      .sort((a, b) => b[1] - a[1] || byTerm(a, b))
      .slice(0, FAMILIES_DISPLAY.commonWords)
      .map(([t]) => t);
    out.set(label, { representative: best, commonWords: words });
  }
  return out;
}

/**
 * Display-only tidying of an example text: underscores become spaces, runs of
 * dots become "…", other repeated punctuation collapses to one character,
 * whitespace collapses. Never fed back into grouping or stored.
 */
export function displayText(text: string): string {
  return text
    .replace(/_/g, ' ')
    .replace(/\.{2,}/g, '…')
    .replace(/([!?,;:=*#~-])\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Example: …" name of a group from its representative incident; the original text for the tooltip. */
export function groupName(incident: Pick<Incident, 'shortDescClean' | 'descClean'>): { short: string; full: string } {
  const max = FAMILIES_DISPLAY.nameMaxChars;
  const original = incident.shortDescClean.trim() || incident.descClean.replace(/\s+/g, ' ').trim();
  const shown = displayText(original);
  if (!shown) return { short: 'Group without text', full: 'Group without text' };
  const short = shown.length > max ? `${shown.slice(0, max).trimEnd()}…` : shown;
  return { short: `Example: ${short}`, full: `Example: ${original}` };
}

// ---------------------------------------------------------------------------
// Top shares
// ---------------------------------------------------------------------------

export interface TopShare {
  /** The most frequent known value, or null when none is recorded. */
  value: string | null;
  /** Its share of all members, whole percent. */
  pct: number;
  /** The top value covers under half of the members. */
  mixed: boolean;
}

export interface Breakdown {
  value: string | null;
  count: number;
  pct: number;
}

/** Counts per value (missing values as null), most frequent first, then by name. */
export function breakdown(values: (string | null)[]): Breakdown[] {
  const counts = new Map<string | null, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count, pct: wholePct(count, values.length) }))
    .sort((a, b) => b.count - a.count || (a.value === null ? 1 : b.value === null ? -1 : a.value.localeCompare(b.value, 'en')));
}

export function topShare(values: (string | null)[]): TopShare {
  const known = breakdown(values).filter(b => b.value !== null);
  if (known.length === 0) return { value: null, pct: 0, mixed: false };
  const top = known[0];
  return { value: top.value, pct: top.pct, mixed: top.count / values.length < 0.5 };
}

// ---------------------------------------------------------------------------
// Group cards
// ---------------------------------------------------------------------------

export type GroupSort = 'largest' | 'selectedWeek';

export interface GroupCard {
  label: number;
  id: string;
  name: { short: string; full: string };
  /** Incidents of the group in the active filtered population, all weeks. */
  total: number;
  /** Incidents in the selected week (active filtered population). */
  count: number;
  /** The selected week is fully covered by the file's data. */
  comparable: boolean;
  /** null when the week is not comparable or has no baseline weeks. */
  typical: number | null;
  change: number | null;
  /** Percent change, only when typical > 0. */
  pct: number | null;
  newThisPeriod: boolean;
  /** Weekly counts over every calendar week of the file (active filtered population). */
  sparkline: number[];
  handledBy: TopShare;
  service: TopShare;
  /** Distinct weeks with incidents of the group (active filtered population). */
  weeksAppeared: number;
  /** Calendar weeks of the selected period (every week of the file without a time filter). */
  totalWeeks: number;
  /** Weeks averaged for the selected week's typical (0 when not comparable). */
  baselineWeeks: number;
  /** Latest Opened among the group's incidents in the active filtered population, "YYYY-MM-DD" ('' when none is dated). */
  lastSeen: string;
  /**
   * When the selected week is not fully covered: the same comparison for the
   * latest fully covered week before it (null otherwise, or when there is none).
   */
  lastCovered: WeekComparison | null;
}

/** One week's count compared with typical (Weekly Review's baseline weeks). */
export interface WeekComparison {
  week: string;
  count: number;
  /** Weeks averaged for `typical`: up to 4 weeks with data in the file, just before `week`. */
  baselineWeeks: number;
  typical: number | null;
  change: number | null;
  pct: number | null;
  newThisPeriod: boolean;
}

export interface GroupContext {
  incidents: Incident[];
  view: Incident[];
  labels: Int32Array;
  identity: GroupIdentity;
  texts: Map<number, GroupText>;
  /** Weeks with data in the full file (Weekly Review's baseline list). */
  weeksWithData: string[];
  selectedWeek: string;
  /** Calendar date of the latest Opened in the full file, "YYYY-MM-DD". */
  dataThroughDate: string;
  sort?: GroupSort;
  /** Month filter ("YYYY-MM"); empty = no time filter. Sets the weeks of the selected period. */
  months?: string[];
  /** Display name of a group from its representative row (default: `groupName`). */
  nameOf?: (row: number) => { short: string; full: string };
}

/**
 * Every group with incidents in the active filtered population. "largest"
 * orders by that total; "selectedWeek" by the selected week's count, then the
 * total. Ties fall back to the canonical group order. Descriptive orderings only.
 */
export function groupCards({ incidents, view, labels, identity, texts, weeksWithData, selectedWeek, dataThroughDate, sort = 'largest', months = [], nameOf }: GroupContext): GroupCard[] {
  const calendar = calendarWeeks(weeksWithData);
  const periodWeekCount = periodWeeks(calendar, months).length;
  // Every incident of the group in the displayed population, dated or not.
  const viewTotal = new Map<number, number>();
  const col = new Map(calendar.map((w, i) => [w, i]));
  const rowOf = new Map<Incident, number>();
  incidents.forEach((inc, i) => rowOf.set(inc, i));
  const all = new Map<number, number[]>();
  labels.forEach((l, i) => {
    if (l < 0) return;
    const list = all.get(l);
    if (list) list.push(i);
    else all.set(l, [i]);
  });
  const viewWeekly = new Map<number, number[]>();
  const lastSeen = new Map<number, string>();
  for (const inc of view) {
    const l = labels[rowOf.get(inc)!];
    if (l >= 0) viewTotal.set(l, (viewTotal.get(l) ?? 0) + 1);
    if (l < 0 || !col.has(inc.week)) continue;
    let series = viewWeekly.get(l);
    if (!series) viewWeekly.set(l, (series = new Array(calendar.length).fill(0)));
    series[col.get(inc.week)!]++;
    if (inc.Opened && inc.Opened > (lastSeen.get(l) ?? '')) lastSeen.set(l, inc.Opened);
  }
  const comparable = isWeekComparable(selectedWeek, dataThroughDate);
  const compare = (series: number[], week: string): WeekComparison => {
    const baseline = baselineWeeksFor(weeksWithData, week);
    const count = col.has(week) ? series[col.get(week)!] : 0;
    const typical = baseline.length ? baseline.reduce((s, w) => s + series[col.get(w)!], 0) / baseline.length : null;
    const change = typical === null ? null : count - typical;
    return {
      week, count, baselineWeeks: baseline.length, typical, change,
      pct: typical !== null && typical > 0 ? Math.round((change! / typical) * 100) : null,
      newThisPeriod: typical === 0 && count > 0,
    };
  };
  // The latest fully covered week with data before the selected one (Weekly Review's week list).
  const lastCoveredWeek = comparable ? undefined
    : [...weeksWithData].reverse().find(w => w < selectedWeek && isWeekComparable(w, dataThroughDate));
  const cards: GroupCard[] = [];
  for (const [label, series] of viewWeekly) {
    const members = all.get(label)!;
    const selected = compare(series, selectedWeek);
    const typical = comparable ? selected.typical : null;
    cards.push({
      label,
      id: identity.ids.get(label)!,
      name: (nameOf ?? (r => groupName(incidents[r])))(texts.get(label)!.representative),
      total: viewTotal.get(label)!,
      count: selected.count, comparable, typical,
      change: comparable ? selected.change : null,
      pct: comparable ? selected.pct : null,
      newThisPeriod: comparable && selected.newThisPeriod,
      sparkline: series,
      handledBy: topShare(members.map(i => dimensionValue(incidents[i], 'assignmentGroup'))),
      service: topShare(members.map(i => dimensionValue(incidents[i], 'service'))),
      weeksAppeared: series.filter(v => v > 0).length,
      totalWeeks: periodWeekCount,
      baselineWeeks: comparable ? selected.baselineWeeks : 0,
      lastSeen: (lastSeen.get(label) ?? '').slice(0, 10),
      lastCovered: lastCoveredWeek ? compare(series, lastCoveredWeek) : null,
    });
  }
  const canonical = (a: GroupCard, b: GroupCard) => identity.rank.get(a.label)! - identity.rank.get(b.label)!;
  return cards.sort(sort === 'selectedWeek'
    ? (a, b) => b.count - a.count || b.total - a.total || canonical(a, b)
    : (a, b) => b.total - a.total || canonical(a, b));
}

/**
 * The selected week's fact line. Comparable weeks: "14 this week · typical 9 · +5"
 * or "… · New this period". A week the data does not fully cover: only the
 * count, "3 incidents through Sep 30" — never a comparison.
 */
export function factLine(card: Pick<GroupCard, 'count' | 'typical' | 'change' | 'newThisPeriod' | 'comparable' | 'baselineWeeks'>, dataThroughDate = ''): string {
  if (!card.comparable) return `${formatCount(card.count)} ${card.count === 1 ? 'incident' : 'incidents'} through ${shortDate(dataThroughDate)}`;
  return `${formatCount(card.count)} this week · ${comparisonText(card)}`;
}

/**
 * "previous 4-week average 9 · +5", "New this period" or "no earlier weeks to compare".
 * The average is `typical`: the group's mean weekly count (zeros included) over
 * the up-to-4 weeks with data in the file just before the week.
 */
function comparisonText(c: Pick<WeekComparison, 'typical' | 'change' | 'newThisPeriod' | 'baselineWeeks'>): string {
  if (c.newThisPeriod) return 'New this period';
  if (c.typical === null) return 'no earlier weeks to compare';
  const rounded = Math.round(c.change! * 10) / 10;
  const delta = rounded === 0 ? '±0' : `${rounded > 0 ? '+' : '−'}${typicalText(Math.abs(rounded))}`;
  return `${averageLabel(c.baselineWeeks)} ${typicalText(c.typical)} · ${delta}`;
}

/** "previous 4-week average", "previous week" — names the weeks `typical` averages. */
export function averageLabel(baselineWeeks: number): string {
  return baselineWeeks === 1 ? 'previous week' : `previous ${baselineWeeks}-week average`;
}

/** "Last fully covered week (Sep 22 – Sep 28): 4 · typical 3 · +1". */
export function lastCoveredLine(c: WeekComparison): string {
  return `Last fully covered week (${weekRangeText(c.week)}): ${formatCount(c.count)} · ${comparisonText(c)}`;
}

/** "Last seen Sep 30" ('' when no member in view is dated). */
export function lastSeenText(lastSeen: string): string {
  return lastSeen ? `Last seen ${shortDate(lastSeen)}` : '';
}

// ---------------------------------------------------------------------------
// Population views: Quality filter, setting summary, distribution
// ---------------------------------------------------------------------------

type QualityScore = { number: string; label: string };

/**
 * The active filtered population narrowed by the sidebar Quality filter.
 * Display only: like Month / Service / Offering it never reaches grouping.
 * Scores are row-aligned with the loaded incidents; when they are not, they
 * are matched by incident number.
 */
export function qualityView<T extends Incident>(incidents: T[], scores: QualityScore[], view: T[], quality: string): T[] {
  if (quality === 'all') return view;
  const aligned = scores.length === incidents.length && incidents.every((inc, i) => scores[i].number === inc.Number);
  if (aligned) {
    const keep = new Set<T>();
    incidents.forEach((inc, i) => { if (scores[i].label === quality) keep.add(inc); });
    return view.filter(inc => keep.has(inc));
  }
  const byNumber = new Map(scores.map(s => [s.number, s.label]));
  return view.filter(inc => byNumber.get(inc.Number) === quality);
}

export interface SettingSummary {
  /** Groups with at least one incident in the population. */
  groups: number;
  oneOff: number;
  population: number;
}

/** Groups and one-off incidents of a population under one grouping setting's labels. */
export function settingSummary(incidents: Incident[], view: Incident[], labels: Int32Array): SettingSummary {
  const rowOf = new Map<Incident, number>();
  incidents.forEach((inc, i) => rowOf.set(inc, i));
  const groups = new Set<number>();
  let oneOff = 0;
  for (const inc of view) {
    const l = labels[rowOf.get(inc)!];
    if (l < 0) oneOff++;
    else groups.add(l);
  }
  return { groups: groups.size, oneOff, population: view.length };
}

export interface DistributionSegment {
  key: 'top' | 'next' | 'remaining' | 'oneOff';
  label: string;
  /** Groups in the segment (0 for one-off incidents). */
  groups: number;
  incidents: number;
  /** Largest-remainder whole percent; the segments sum to 100. */
  pct: number;
}

/**
 * Where the population's incidents sit: its 5 largest groups, the next 20,
 * the remaining groups and the one-off incidents. Counts reconcile exactly
 * with the population; empty segments are left out (fewer than 25 groups).
 */
export function distribution(incidents: Incident[], view: Incident[], labels: Int32Array,
  top = FAMILIES_DISPLAY.distributionTop, next = FAMILIES_DISPLAY.distributionNext): DistributionSegment[] {
  const rowOf = new Map<Incident, number>();
  incidents.forEach((inc, i) => rowOf.set(inc, i));
  const sizes = new Map<number, number>();
  let oneOff = 0;
  for (const inc of view) {
    const l = labels[rowOf.get(inc)!];
    if (l < 0) oneOff++;
    else sizes.set(l, (sizes.get(l) ?? 0) + 1);
  }
  const sorted = [...sizes.values()].sort((a, b) => b - a);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const topSizes = sorted.slice(0, top);
  const nextSizes = sorted.slice(top, top + next);
  const restSizes = sorted.slice(top + next);
  const groupsText = (n: number) => `${n} ${n === 1 ? 'group' : 'groups'}`;
  const segments = [
    { key: 'top' as const, label: sorted.length <= top ? `All ${groupsText(sorted.length)}` : `Top ${top} groups`, groups: topSizes.length, incidents: sum(topSizes) },
    { key: 'next' as const, label: nextSizes.length === next ? `Next ${next} groups` : `Next ${groupsText(nextSizes.length)}`, groups: nextSizes.length, incidents: sum(nextSizes) },
    { key: 'remaining' as const, label: `Remaining ${groupsText(restSizes.length)}`, groups: restSizes.length, incidents: sum(restSizes) },
    { key: 'oneOff' as const, label: 'One-off', groups: 0, incidents: oneOff },
  ].filter(s => s.incidents > 0);
  const pcts = largestRemainderPct(segments.map(s => s.incidents));
  return segments.map((s, i) => ({ ...s, pct: pcts[i] }));
}

// ---------------------------------------------------------------------------
// Concentration
// ---------------------------------------------------------------------------

export interface Concentration {
  /** Groups counted: up to 5, the largest in the active filtered population. */
  groups: number;
  /** Their incidents in the active filtered population. */
  incidents: number;
  /** All incidents in the active filtered population (grouped + one-off). */
  population: number;
  pct: number;
}

/** Share of the active filtered population in its largest groups (numerator and denominator from the same population). */
export function concentration(cards: Pick<GroupCard, 'total'>[], population: number, top = FAMILIES_DISPLAY.concentrationTop): Concentration {
  const largest = cards.map(c => c.total).sort((a, b) => b - a).slice(0, top);
  const incidents = largest.reduce((a, b) => a + b, 0);
  return { groups: largest.length, incidents, population, pct: wholePct(incidents, population) };
}

/** "The 5 largest repeating groups account for" / "The 3 repeating groups account for" / "The only repeating group accounts for". */
export function concentrationLead(c: Concentration, top = FAMILIES_DISPLAY.concentrationTop): string {
  if (c.groups === 1) return 'The only repeating group accounts for';
  return c.groups >= top ? `The ${c.groups} largest repeating groups account for` : `The ${c.groups} repeating groups account for`;
}

// ---------------------------------------------------------------------------
// Sparkline geometry (presentation only)
// ---------------------------------------------------------------------------

/**
 * Bar heights for a sparkline. Zero stays zero; any non-zero week is at least
 * `minHeight` tall so a single incident is visible. Heights are drawing only:
 * labels and tooltips always use the true counts.
 */
export function sparklineHeights(series: number[], height: number, minHeight: number): number[] {
  const max = Math.max(1, ...series);
  return series.map(v => (v === 0 ? 0 : Math.max(minHeight, (v / max) * height)));
}

/** "Jan 2026": the month of the ISO week's Thursday, the day that decides which year and month the week belongs to. */
export function weekMonthLabel(key: string): string {
  const start = weekStart(key);
  return start ? new Date(start.getTime() + 3 * 86400000).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
}

/** Incidents of one group or the one-off incidents, in the displayed population, newest first. */
export function membersNewestFirst<T extends Incident>(incidents: T[], view: T[], labels: Int32Array, label: number | 'one-off', week?: string): T[] {
  const rowOf = new Map<T, number>();
  incidents.forEach((inc, i) => rowOf.set(inc, i));
  return view
    .filter(inc => (label === 'one-off' ? labels[rowOf.get(inc)!] < 0 : labels[rowOf.get(inc)!] === label) && (!week || inc.week === week))
    .sort((a, b) => b.Opened.localeCompare(a.Opened));
}

// ---------------------------------------------------------------------------
// FAM-01.4: selected period, shares, readable names, group activity
// ---------------------------------------------------------------------------

const monthKeyOf = (d: Date) => d.toISOString().slice(0, 7);

/** Calendar weeks of the selected period: every week with a day in a selected month (all weeks without a time filter). */
export function periodWeeks(calendar: string[], months: string[]): string[] {
  if (months.length === 0) return calendar;
  const selected = new Set(months);
  return calendar.filter(w => {
    const start = weekStart(w);
    if (!start) return false;
    for (let d = 0; d < 7; d++) if (selected.has(monthKeyOf(new Date(start.getTime() + d * 86400000)))) return true;
    return false;
  });
}

const monthName = (key: string, withYear: boolean) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: withYear ? 'numeric' : undefined, timeZone: 'UTC' });
const nextMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

/**
 * The selected period in words: "Sep 2026", "Jul – Sep 2026", "Nov 2025 – Feb 2026",
 * "Jan, Mar 2026"; without a time filter, the file's first to last date
 * ("Jan 1 – Oct 1, 2026").
 */
export function periodLabel(months: string[], firstDate: string, lastDate: string): string {
  if (months.length === 0) {
    if (!firstDate || !lastDate) return 'All data';
    const year = (k: string) => k.slice(0, 4);
    return year(firstDate) === year(lastDate)
      ? `${shortDate(firstDate)} – ${shortDate(lastDate)}, ${year(lastDate)}`
      : `${shortDate(firstDate)}, ${year(firstDate)} – ${shortDate(lastDate)}, ${year(lastDate)}`;
  }
  const sorted = [...new Set(months)].sort();
  const runs: [string, string][] = [];
  for (const m of sorted) {
    const last = runs[runs.length - 1];
    if (last && nextMonth(last[1]) === m) last[1] = m;
    else runs.push([m, m]);
  }
  const years = new Set(sorted.map(m => m.slice(0, 4)));
  if (runs.length === 1) {
    const [a, b] = runs[0];
    if (a === b) return monthName(a, true);
    return a.slice(0, 4) === b.slice(0, 4) ? `${monthName(a, false)} – ${monthName(b, true)}` : `${monthName(a, true)} – ${monthName(b, true)}`;
  }
  const one = years.size === 1;
  const text = runs.map(([a, b]) => (a === b ? monthName(a, !one) : `${monthName(a, !one)} – ${monthName(b, !one)}`)).join(', ');
  return one ? `${text} ${[...years][0]}` : text;
}

/** "11%", or "<1%" for a non-zero share that rounds to 0. Shares are of all incidents in the population. */
export function shareLabel(pct: number, count: number): string {
  return pct === 0 && count > 0 ? '<1%' : `${pct}%`;
}

/** Repeating vs one-off incidents of a population: counts and largest-remainder percentages (sum to 100). */
export function composition(summary: SettingSummary): { repeating: number; oneOff: number; repeatingPct: number; oneOffPct: number } {
  const repeating = summary.population - summary.oneOff;
  const [repeatingPct, oneOffPct] = largestRemainderPct([repeating, summary.oneOff]);
  return { repeating, oneOff: summary.oneOff, repeatingPct, oneOffPct };
}

// --- Readable names from the active text cleaning (display only) -----------

/** Same keys as the text cleaning uses to recognise a template line and a word n-gram. */
const templateLineKey = (line: string) => pyDigitsToZero(pyStrip(pyCollapseSpace(pyLower(line))));
const templateToken = (token: string) => pyDigitsToZero(pyLower(token));
const HAS_LETTER = /\p{L}/u;

/**
 * The incident's open-time text after the active text cleaning, line by line:
 * template lines removed, template word runs removed, identifier tokens
 * removed for "Additional text normalization". Joined, the lines are exactly
 * the cleaned text the groups were built from (tested), before lowercasing.
 * Display only.
 */
export function cleanedLines(text: string, templates: Templates, variant: 'R1' | 'R2'): string[][] {
  const n = FAMILIES_RESEARCH.ngramN;
  const lines = text.split('\n').filter(l => !templates.lines.has(templateLineKey(l))).map(l => pyWords(l));
  const flat = lines.flat();
  const drop = new Uint8Array(flat.length);
  if (templates.grams.size > 0) {
    const toks = flat.map(templateToken);
    for (let i = 0; i + n <= toks.length; i++) {
      if (templates.grams.has(toks.slice(i, i + n).join('\u0001'))) drop.fill(1, i, i + n);
    }
  }
  let k = 0;
  return lines.map(words => words.filter(w => {
    const keep = !drop[k++];
    return keep && (variant === 'R1' || identifierType(w) === null);
  }));
}

/**
 * Group name for "Remove repeated templates" / "Additional text normalization":
 * the representative incident's first cleaned line with at least 3 words,
 * tidied for display and trimmed. null when no line qualifies (callers fall
 * back to `groupName`). The tooltip keeps the original text.
 */
export function cleanedGroupName(incident: Pick<Incident, 'shortDescClean' | 'descClean'>, templates: Templates, variant: 'R1' | 'R2'): { short: string; full: string } | null {
  const text = (incident.shortDescClean || '') + '\n' + (incident.descClean || '');
  const line = cleanedLines(text, templates, variant).find(ws => ws.filter(w => HAS_LETTER.test(w)).length >= 3);
  if (!line) return null;
  const max = FAMILIES_DISPLAY.cleanedNameMaxChars;
  const shown = displayText(line.join(' '));
  const short = shown.length > max ? `${shown.slice(0, max).trimEnd()}…` : shown;
  return { short: `Example: ${short}`, full: groupName(incident).full };
}

// --- Group detail: one population -----------------------------------------

export interface BreakdownRow {
  value: string | null;
  count: number;
  /** Largest-remainder whole percent of the group's incidents in view; rows sum to 100. */
  pct: number;
  /** "Other" row aggregating the remaining values. */
  otherValues?: number;
}

/** Top values plus one "Other" row, so the rows always add up to the incidents counted. */
export function breakdownRows(values: (string | null)[], top = 5): BreakdownRow[] {
  const all = breakdown(values);
  const head = all.slice(0, top).map(b => ({ value: b.value, count: b.count }));
  const rest = all.slice(top);
  const rows: Omit<BreakdownRow, 'pct'>[] = rest.length
    ? [...head, { value: null, count: rest.reduce((a, b) => a + b.count, 0), otherValues: rest.length }]
    : head;
  const pcts = largestRemainderPct(rows.map(r => r.count));
  return rows.map((r, i) => ({ ...r, pct: pcts[i] }));
}

export interface ActivityWeek {
  week: string;
  /** Incidents of the group in the displayed population (0 outside the selected period). */
  count: number;
  /** The week belongs to the selected period. */
  inPeriod: boolean;
  /** Whole-file incidents of the group, drawn muted for weeks outside the selected period. */
  fileCount: number;
}

/** Weekly activity of one group over every calendar week of the file. */
export function groupActivity(members: Incident[], fileMembers: Incident[], calendar: string[], months: string[]): ActivityWeek[] {
  const inPeriod = new Set(periodWeeks(calendar, months));
  const count = new Map<string, number>();
  const file = new Map<string, number>();
  for (const m of members) if (m.week) count.set(m.week, (count.get(m.week) ?? 0) + 1);
  for (const m of fileMembers) if (m.week) file.set(m.week, (file.get(m.week) ?? 0) + 1);
  return calendar.map(week => ({ week, count: inPeriod.has(week) ? count.get(week) ?? 0 : 0, inPeriod: inPeriod.has(week), fileCount: file.get(week) ?? 0 }));
}

/** Month tick positions for a weekly axis: the first week of each month (by its Thursday), "Jan" or "Jan 2026" at a year change. */
export function monthTicks(calendar: string[]): { index: number; label: string }[] {
  const out: { index: number; label: string }[] = [];
  let prev = '';
  calendar.forEach((w, i) => {
    const start = weekStart(w);
    if (!start) return;
    const key = monthKeyOf(new Date(start.getTime() + 3 * 86400000));
    if (key === prev) return;
    out.push({ index: i, label: monthName(key, !prev || key.slice(0, 4) !== prev.slice(0, 4)) });
    prev = key;
  });
  return out;
}

/** Full-file context of a group: incidents and first Opened date ("YYYY-MM-DD"). */
export function groupHistory(fileMembers: Pick<Incident, 'Opened'>[]): { total: number; firstDate: string } {
  let first = '';
  for (const m of fileMembers) if (m.Opened && (!first || m.Opened < first)) first = m.Opened;
  return { total: fileMembers.length, firstDate: first.slice(0, 10) };
}
