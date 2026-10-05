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
import { familyIdentity } from './view';
import { pyLower } from './pyText';

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
export function groupTexts(incidents: Incident[], docs: string[], labels: Int32Array): Map<number, GroupText> {
  const vectors = termVectors(docs);
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
  totalWeeks: number;
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
}

/**
 * Every group with incidents in the active filtered population. "largest"
 * orders by that total; "selectedWeek" by the selected week's count, then the
 * total. Ties fall back to the canonical group order. Descriptive orderings only.
 */
export function groupCards({ incidents, view, labels, identity, texts, weeksWithData, selectedWeek, dataThroughDate, sort = 'largest' }: GroupContext): GroupCard[] {
  const calendar = calendarWeeks(weeksWithData);
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
  for (const inc of view) {
    const l = labels[rowOf.get(inc)!];
    if (l < 0 || !col.has(inc.week)) continue;
    let series = viewWeekly.get(l);
    if (!series) viewWeekly.set(l, (series = new Array(calendar.length).fill(0)));
    series[col.get(inc.week)!]++;
  }
  const comparable = isWeekComparable(selectedWeek, dataThroughDate);
  const baseline = baselineWeeksFor(weeksWithData, selectedWeek);
  const cards: GroupCard[] = [];
  for (const [label, series] of viewWeekly) {
    const count = col.has(selectedWeek) ? series[col.get(selectedWeek)!] : 0;
    const members = all.get(label)!;
    const typical = comparable && baseline.length ? baseline.reduce((s, w) => s + series[col.get(w)!], 0) / baseline.length : null;
    const change = typical === null ? null : count - typical;
    cards.push({
      label,
      id: identity.ids.get(label)!,
      name: groupName(incidents[texts.get(label)!.representative]),
      total: series.reduce((a, b) => a + b, 0),
      count, comparable, typical, change,
      pct: typical !== null && typical > 0 ? Math.round((change! / typical) * 100) : null,
      newThisPeriod: typical === 0 && count > 0,
      sparkline: series,
      handledBy: topShare(members.map(i => dimensionValue(incidents[i], 'assignmentGroup'))),
      service: topShare(members.map(i => dimensionValue(incidents[i], 'service'))),
      weeksAppeared: series.filter(v => v > 0).length,
      totalWeeks: calendar.length,
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
export function factLine(card: Pick<GroupCard, 'count' | 'typical' | 'change' | 'newThisPeriod' | 'comparable'>, dataThroughDate = ''): string {
  if (!card.comparable) return `${formatCount(card.count)} ${card.count === 1 ? 'incident' : 'incidents'} through ${shortDate(dataThroughDate)}`;
  const head = `${formatCount(card.count)} this week`;
  if (card.newThisPeriod) return `${head} · New this period`;
  if (card.typical === null) return `${head} · no earlier weeks to compare`;
  const rounded = Math.round(card.change! * 10) / 10;
  const delta = rounded === 0 ? '±0' : `${rounded > 0 ? '+' : '−'}${typicalText(Math.abs(rounded))}`;
  return `${head} · typical ${typicalText(card.typical)} · ${delta}`;
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
