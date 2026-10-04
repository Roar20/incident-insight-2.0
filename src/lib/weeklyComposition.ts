/**
 * Weekly Review composition: where each week's demand was associated.
 *
 * Pure, descriptive aggregations over the population Weekly Review passes in
 * (today the loaded incidents; Weekly Review has no filters). Every segment
 * counts exactly the incidents "Incidents per week" counts, so the stacked
 * total of a week always equals that week's bar. Missing values are never
 * values: they form their own "No …" segment, never ranked and never part of
 * "Others". Nothing here infers completeness of a week.
 */
import type { AnnotatedIncident } from './problems';
import type { DimensionAvailability } from './dimensions';
import { parseTimestamp } from './periods';
import { dimensionValue, type OrigenDimension } from './serviceDimension';

type Incident = Pick<AnnotatedIncident, 'Number' | 'Opened' | 'week' | 'extraFields' | 'Assignment group' | 'clusterId'>;

// ---------------------------------------------------------------------------
// Data through
// ---------------------------------------------------------------------------

/** The latest valid Opened timestamp in `incidents` (the full loaded file), or null. */
export function dataThrough(incidents: Pick<AnnotatedIncident, 'Opened'>[]): Date | null {
  let latest: Date | null = null;
  for (const inc of incidents) {
    const d = parseTimestamp(inc.Opened);
    if (d && (!latest || d.getTime() > latest.getTime())) latest = d;
  }
  return latest;
}

/** "Sep 29, 2026" — the stored timestamps are read as UTC, as week bucketing does. */
export function formatDataThrough(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// ---------------------------------------------------------------------------
// Which dimension (Cases A–E)
// ---------------------------------------------------------------------------

export type CompositionCase = 'A' | 'B' | 'C' | 'D' | 'E';

export interface CompositionChoice {
  case: CompositionCase;
  /** The dimension drawn, or null when none varies (Case E). */
  dimension: OrigenDimension | null;
  /** Case B: the single known Service and how many incidents have no Service. */
  singleService: { value: string; missing: number } | null;
}

function knownValues(incidents: Incident[], dimension: OrigenDimension): Set<string> {
  const values = new Set<string>();
  for (const inc of incidents) {
    const v = dimensionValue(inc, dimension);
    if (v !== null) values.add(v);
  }
  return values;
}

/**
 * Service first. A dimension is informative when it has two or more known
 * values in `incidents` — the same population "Incidents per week" counts.
 *  A: Service varies → Service.
 *  B: one known Service → say so; Service Offering if it varies.
 *  C: no Service values (or no Service column) → Service Offering if it varies.
 *  D: Offering does not vary either → Handling Group if it varies.
 *  E: nothing varies → no chart.
 */
export function chooseCompositionDimension(incidents: Incident[], availability: DimensionAvailability): CompositionChoice {
  const informative = (d: OrigenDimension) => knownValues(incidents, d).size >= 2;
  const services = availability.service ? knownValues(incidents, 'service') : new Set<string>();
  if (services.size >= 2) return { case: 'A', dimension: 'service', singleService: null };
  const singleService = services.size === 1
    ? { value: [...services][0], missing: incidents.filter(i => dimensionValue(i, 'service') === null).length }
    : null;
  if (availability.serviceOffering && informative('serviceOffering')) {
    return { case: singleService ? 'B' : 'C', dimension: 'serviceOffering', singleService };
  }
  if (availability.assignmentGroup && informative('assignmentGroup')) {
    return { case: 'D', dimension: 'assignmentGroup', singleService };
  }
  return { case: singleService ? 'B' : 'E', dimension: null, singleService };
}

// ---------------------------------------------------------------------------
// Stacked composition
// ---------------------------------------------------------------------------

export const MISSING_LABELS: Record<OrigenDimension, string> = {
  service: 'No Service',
  serviceOffering: 'No Service Offering',
  assignmentGroup: 'No Handling Group',
};

export const OTHERS_KEY = 'others';
export const MISSING_KEY = 'missing';

export interface CompositionSeries {
  /** Recharts data key: `v0`… for named values, then `others`, `missing`. */
  key: string;
  label: string;
  kind: 'value' | 'others' | 'missing';
  /** Named values only: the dimension value. */
  value: string | null;
}

export interface CompositionWeek {
  key: string;
  label: string;
  total: number;
  [segment: string]: number | string;
}

export interface WeeklyComposition {
  dimension: OrigenDimension;
  /** Legend order: Top-N by volume over the visible window, then Others, then No …. */
  series: CompositionSeries[];
  weeks: CompositionWeek[];
}

/**
 * Stacked weekly counts for `weeks` (the visible window, oldest first).
 * `counted` decides which incidents a week's bar counts, so segments sum to
 * exactly that bar. Named values are ranked once over the whole window.
 */
export function weeklyComposition(
  incidents: Incident[],
  counted: (incident: Incident) => boolean,
  weeks: { key: string; label: string }[],
  dimension: OrigenDimension,
  topN: number,
): WeeklyComposition {
  const windowKeys = new Set(weeks.map(w => w.key));
  const members = incidents.filter(i => windowKeys.has(i.week) && counted(i));

  const totals = new Map<string, number>();
  for (const inc of members) {
    const v = dimensionValue(inc, dimension);
    if (v !== null) totals.set(v, (totals.get(v) ?? 0) + 1);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en')).map(([v]) => v);
  const top = ranked.slice(0, topN);
  const topIndex = new Map(top.map((v, i) => [v, i]));
  const hasOthers = ranked.length > top.length;
  const hasMissing = members.some(i => dimensionValue(i, dimension) === null);

  const series: CompositionSeries[] = top.map((v, i) => ({ key: `v${i}`, label: v, kind: 'value', value: v }));
  if (hasOthers) series.push({ key: OTHERS_KEY, label: 'Others', kind: 'others', value: null });
  if (hasMissing) series.push({ key: MISSING_KEY, label: MISSING_LABELS[dimension], kind: 'missing', value: null });

  const rows: CompositionWeek[] = weeks.map(w => {
    const row: CompositionWeek = { key: w.key, label: w.label, total: 0 };
    for (const s of series) row[s.key] = 0;
    return row;
  });
  const rowByKey = new Map(rows.map(r => [r.key, r]));
  for (const inc of members) {
    const row = rowByKey.get(inc.week)!;
    const v = dimensionValue(inc, dimension);
    const key = v === null ? MISSING_KEY : topIndex.has(v) ? `v${topIndex.get(v)}` : OTHERS_KEY;
    row[key] = (row[key] as number) + 1;
    row.total++;
  }
  return { dimension, series, weeks: rows };
}

// ---------------------------------------------------------------------------
// Colors: a stable identity per value, never by rank
// ---------------------------------------------------------------------------

/**
 * Categorical palette for the dark chart card, validated for adjacent-pair
 * colour-vision separation and contrast. No green/red: these are identities,
 * not performance states.
 */
export const CATEGORICAL_PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'] as const;

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A colour per named value from a hash of the value itself, so it does not
 * change when its rank changes. Values are placed in label order and a taken
 * slot moves to the next free one, so the drawn values never share a colour.
 */
export function colorsForValues(values: string[]): Map<string, string> {
  const colors = new Map<string, string>();
  const taken = new Set<number>();
  for (const v of [...values].sort((a, b) => a.localeCompare(b, 'en'))) {
    let slot = fnv1a(v) % CATEGORICAL_PALETTE.length;
    if (taken.size < CATEGORICAL_PALETTE.length) {
      while (taken.has(slot)) slot = (slot + 1) % CATEGORICAL_PALETTE.length;
    }
    taken.add(slot);
    colors.set(v, CATEGORICAL_PALETTE[slot]);
  }
  return colors;
}

// ---------------------------------------------------------------------------
// Bridge insight: the named value whose count moved most vs typical
// ---------------------------------------------------------------------------

export interface BridgeInsight {
  value: string;
  count: number;
  typical: number;
  /** count − typical, unrounded. */
  change: number;
}

/**
 * For each named value: this week's count and its typical — the mean over
 * the baseline weeks Weekly Review already uses, where a baseline week
 * without the value contributes 0. Picks the largest absolute change; ties by
 * count, then label. null when there is no baseline window or no named value
 * changed. "Others" and missing values are never candidates.
 */
export function bridgeInsight(
  incidents: Incident[],
  counted: (incident: Incident) => boolean,
  dimension: OrigenDimension,
  weekKey: string,
  baselineWeeks: string[],
): BridgeInsight | null {
  if (baselineWeeks.length === 0) return null;
  const baselineSet = new Set(baselineWeeks);
  const current = new Map<string, number>();
  const baseline = new Map<string, number>();
  for (const inc of incidents) {
    if (!counted(inc)) continue;
    const v = dimensionValue(inc, dimension);
    if (v === null) continue;
    if (inc.week === weekKey) current.set(v, (current.get(v) ?? 0) + 1);
    else if (baselineSet.has(inc.week)) baseline.set(v, (baseline.get(v) ?? 0) + 1);
  }
  const candidates: BridgeInsight[] = [...new Set([...current.keys(), ...baseline.keys()])].map(value => {
    const count = current.get(value) ?? 0;
    const typical = (baseline.get(value) ?? 0) / baselineWeeks.length;
    return { value, count, typical, change: count - typical };
  }).filter(c => c.change !== 0);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || b.count - a.count || a.value.localeCompare(b.value, 'en'));
  return candidates[0];
}

/** "+12", "−4.5" — one decimal at most, for display only. */
export function formatChange(change: number): string {
  const rounded = Math.round(change * 10) / 10;
  const text = Number.isInteger(rounded) ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(1);
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${text}`;
}
