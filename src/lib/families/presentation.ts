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

/** "Example: …" name of a group from its representative incident; full text for the tooltip. */
export function groupName(incident: Pick<Incident, 'shortDescClean' | 'descClean'>): { short: string; full: string } {
  const max = FAMILIES_DISPLAY.nameMaxChars;
  const source = incident.shortDescClean.trim() || incident.descClean.replace(/\s+/g, ' ').trim();
  if (!source) return { short: 'Group without text', full: 'Group without text' };
  const short = source.length > max ? `${source.slice(0, max).trimEnd()}…` : source;
  return { short: `Example: ${short}`, full: `Example: ${source}` };
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

export interface GroupCard {
  label: number;
  id: string;
  name: { short: string; full: string };
  /** Incidents in the selected week (displayed population). */
  count: number;
  /** null when the selected week has no baseline weeks. */
  typical: number | null;
  change: number | null;
  /** Percent change, only when typical > 0. */
  pct: number | null;
  newThisPeriod: boolean;
  /** Weekly counts over every calendar week of the file (displayed population). */
  sparkline: number[];
  handledBy: TopShare;
  service: TopShare;
  /** All members of the group in the file. */
  size: number;
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
}

export function groupCards({ incidents, view, labels, identity, texts, weeksWithData, selectedWeek }: GroupContext): GroupCard[] {
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
  const baseline = baselineWeeksFor(weeksWithData, selectedWeek);
  const cards: GroupCard[] = [];
  for (const [label, series] of viewWeekly) {
    const count = col.has(selectedWeek) ? series[col.get(selectedWeek)!] : 0;
    if (count === 0) continue;
    const members = all.get(label)!;
    const typical = baseline.length ? baseline.reduce((s, w) => s + series[col.get(w)!], 0) / baseline.length : null;
    const change = typical === null ? null : count - typical;
    cards.push({
      label,
      id: identity.ids.get(label)!,
      name: groupName(incidents[texts.get(label)!.representative]),
      count, typical, change,
      pct: typical !== null && typical > 0 ? Math.round((change! / typical) * 100) : null,
      newThisPeriod: typical === 0,
      sparkline: series,
      handledBy: topShare(members.map(i => dimensionValue(incidents[i], 'assignmentGroup'))),
      service: topShare(members.map(i => dimensionValue(incidents[i], 'service'))),
      size: members.length,
      weeksAppeared: new Set(members.map(i => incidents[i].week).filter(Boolean)).size,
      totalWeeks: calendar.length,
    });
  }
  return cards.sort((a, b) => b.count - a.count || b.size - a.size || identity.rank.get(a.label)! - identity.rank.get(b.label)!);
}

/** "14 this week · typical 9 · +5" pieces, or "New this period". */
export function factLine(card: Pick<GroupCard, 'count' | 'typical' | 'change' | 'newThisPeriod'>): string {
  const head = `${formatCount(card.count)} this week`;
  if (card.newThisPeriod) return `${head} · New this period`;
  if (card.typical === null) return `${head} · no earlier weeks to compare`;
  const rounded = Math.round(card.change! * 10) / 10;
  const delta = rounded === 0 ? '±0' : `${rounded > 0 ? '+' : '−'}${typicalText(Math.abs(rounded))}`;
  return `${head} · typical ${typicalText(card.typical)} · ${delta}`;
}

/** Incidents of one group or the one-off incidents, in the displayed population, newest first. */
export function membersNewestFirst<T extends Incident>(incidents: T[], view: T[], labels: Int32Array, label: number | 'one-off', week?: string): T[] {
  const rowOf = new Map<T, number>();
  incidents.forEach((inc, i) => rowOf.set(inc, i));
  return view
    .filter(inc => (label === 'one-off' ? labels[rowOf.get(inc)!] < 0 : labels[rowOf.get(inc)!] === label) && (!week || inc.week === week))
    .sort((a, b) => b.Opened.localeCompare(a.Opened));
}
