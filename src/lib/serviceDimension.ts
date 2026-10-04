/**
 * Origen metrics: Service and Service offering context of an incident population.
 *
 * Every function here is a pure, descriptive aggregation over the incidents it
 * is given — normally the incidents visible under the global filters. Nothing
 * is inferred: an Assignment group seen with a Service is observed handling,
 * not ownership or a reassignment path, and Service → Offering is an observed
 * relationship, not a hierarchy.
 *
 * Missing values are never values. An incident with no Service is counted in a
 * separate "no value" row; it is never ranked, never a top Service, never part
 * of a distinct count and never merged into a display "Others" bucket.
 * Percentages over an empty population are null, not 0.
 */
import { parseMonthKey } from './analytics';
import { getDimension } from './dimensions';
import type { AnnotatedIncident } from './problems';
import { ALL_VALUES, filterIncidents, type GlobalFilters } from './problemView';

export type OrigenDimension = 'service' | 'serviceOffering' | 'assignmentGroup';

type OrigenIncident = Pick<AnnotatedIncident, 'Opened' | 'extraFields' | 'Assignment group' | 'clusterId'>;

/** The incident's value for a dimension, trimmed, or null when blank or missing. */
export function dimensionValue(incident: OrigenIncident, dimension: OrigenDimension): string | null {
  if (dimension === 'assignmentGroup') {
    const value = incident['Assignment group'];
    const text = typeof value === 'string' ? value.trim() : '';
    return text === '' ? null : text;
  }
  return getDimension(incident, dimension);
}

/** part / whole as a fraction, or null when whole is 0. */
export function fraction(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

const compareValues = (a: string, b: string) => a.localeCompare(b, 'en');

/** Most incidents first; equal counts in value order, for a stable display only. */
function rank<T extends { value: string | null; incidents: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => b.incidents - a.incidents || compareValues(a.value ?? '', b.value ?? ''));
}

function distinctKnown(set: Set<string | null>): number {
  return set.has(null) ? set.size - 1 : set.size;
}

// ---------------------------------------------------------------------------
// One dimension: Service, Service offering or Assignment group
// ---------------------------------------------------------------------------

export interface DimensionRow {
  /** null for the "no value" row. */
  value: string | null;
  incidents: number;
  /** incidents / all visible incidents (the no-value row included), or null when nothing is visible. */
  shareOfVisible: number | null;
  /** Distinct known values among this row's incidents (blank never counts). */
  distinctAssignmentGroups: number;
  distinctServices: number;
  distinctServiceOfferings: number;
  /** Problems in the current list with at least one of this row's incidents. */
  candidates: number;
}

export interface DimensionTable {
  /** Known values, ranked. */
  rows: DimensionRow[];
  /** Incidents with no value, or null when every visible incident has one. */
  missing: DimensionRow | null;
  visible: number;
  withValue: number;
  /** withValue / visible, or null when nothing is visible. */
  coverage: number | null;
}

/**
 * One row per value of `dimension` among `incidents`.
 *
 * `candidateIds` are the problems currently listed (recurring problems of the
 * visible population); a row's `candidates` counts those it shares incidents with.
 */
export function dimensionTable(
  incidents: OrigenIncident[],
  dimension: OrigenDimension,
  candidateIds: ReadonlySet<string>,
): DimensionTable {
  interface Acc { incidents: number; ags: Set<string | null>; services: Set<string | null>; offerings: Set<string | null>; clusters: Set<string> }
  const groups = new Map<string | null, Acc>();
  for (const inc of incidents) {
    const value = dimensionValue(inc, dimension);
    let acc = groups.get(value);
    if (!acc) groups.set(value, (acc = { incidents: 0, ags: new Set(), services: new Set(), offerings: new Set(), clusters: new Set() }));
    acc.incidents++;
    acc.ags.add(dimensionValue(inc, 'assignmentGroup'));
    acc.services.add(dimensionValue(inc, 'service'));
    acc.offerings.add(dimensionValue(inc, 'serviceOffering'));
    if (candidateIds.has(inc.clusterId)) acc.clusters.add(inc.clusterId);
  }

  const visible = incidents.length;
  const toRow = (value: string | null, acc: Acc): DimensionRow => ({
    value,
    incidents: acc.incidents,
    shareOfVisible: fraction(acc.incidents, visible),
    distinctAssignmentGroups: distinctKnown(acc.ags),
    distinctServices: distinctKnown(acc.services),
    distinctServiceOfferings: distinctKnown(acc.offerings),
    candidates: acc.clusters.size,
  });

  const rows = rank([...groups.entries()].filter(([v]) => v !== null).map(([v, acc]) => toRow(v, acc)));
  const missingAcc = groups.get(null);
  const withValue = visible - (missingAcc?.incidents ?? 0);
  return {
    rows,
    missing: missingAcc ? toRow(null, missingAcc) : null,
    visible,
    withValue,
    coverage: fraction(withValue, visible),
  };
}

// ---------------------------------------------------------------------------
// Two dimensions
// ---------------------------------------------------------------------------

export interface CrossTabRow {
  value: string | null;
  incidents: number;
  /** Count per column value (null = no value). */
  cells: Map<string | null, number>;
}

export interface CrossTab {
  /** Known row values ranked, then the no-value row if any. */
  rows: CrossTabRow[];
  /** Known column values ranked, then the no-value column if any. */
  columns: { value: string | null; incidents: number }[];
  total: number;
}

/** Counts of incidents by (row value, column value), including no-value rows and columns. */
export function crossTab(incidents: OrigenIncident[], rowDimension: OrigenDimension, columnDimension: OrigenDimension): CrossTab {
  const rows = new Map<string | null, CrossTabRow>();
  const columns = new Map<string | null, number>();
  for (const inc of incidents) {
    const r = dimensionValue(inc, rowDimension);
    const c = dimensionValue(inc, columnDimension);
    let row = rows.get(r);
    if (!row) rows.set(r, (row = { value: r, incidents: 0, cells: new Map() }));
    row.incidents++;
    row.cells.set(c, (row.cells.get(c) ?? 0) + 1);
    columns.set(c, (columns.get(c) ?? 0) + 1);
  }
  const knownLast = <T extends { value: string | null; incidents: number }>(list: T[]) =>
    [...rank(list.filter(x => x.value !== null)), ...list.filter(x => x.value === null)];
  return {
    rows: knownLast([...rows.values()]),
    columns: knownLast([...columns.entries()].map(([value, n]) => ({ value, incidents: n }))),
    total: incidents.length,
  };
}

export interface PairRow {
  left: string | null;
  right: string | null;
  incidents: number;
  shareOfVisible: number | null;
  distinctAssignmentGroups: number;
  candidates: number;
}

/**
 * One row per observed (left, right) pair, e.g. Service × Service offering.
 * Pairs with both values known come first, ranked; pairs missing a side follow.
 */
export function pairTable(
  incidents: OrigenIncident[],
  left: OrigenDimension,
  right: OrigenDimension,
  candidateIds: ReadonlySet<string>,
): { pairs: PairRow[]; partial: PairRow[]; visible: number } {
  const groups = new Map<string, { left: string | null; right: string | null; incidents: number; ags: Set<string | null>; clusters: Set<string> }>();
  for (const inc of incidents) {
    const l = dimensionValue(inc, left);
    const r = dimensionValue(inc, right);
    const key = JSON.stringify([l, r]);
    let acc = groups.get(key);
    if (!acc) groups.set(key, (acc = { left: l, right: r, incidents: 0, ags: new Set(), clusters: new Set() }));
    acc.incidents++;
    acc.ags.add(dimensionValue(inc, 'assignmentGroup'));
    if (candidateIds.has(inc.clusterId)) acc.clusters.add(inc.clusterId);
  }
  const rows = [...groups.values()].map(g => ({
    left: g.left,
    right: g.right,
    incidents: g.incidents,
    shareOfVisible: fraction(g.incidents, incidents.length),
    distinctAssignmentGroups: distinctKnown(g.ags),
    candidates: g.clusters.size,
  }));
  const order = (a: PairRow, b: PairRow) =>
    b.incidents - a.incidents || compareValues(a.left ?? '', b.left ?? '') || compareValues(a.right ?? '', b.right ?? '');
  return {
    pairs: rows.filter(r => r.left !== null && r.right !== null).sort(order),
    partial: rows.filter(r => r.left === null || r.right === null).sort(order),
    visible: incidents.length,
  };
}

// ---------------------------------------------------------------------------
// Monthly
// ---------------------------------------------------------------------------

export interface MonthlySeries {
  /** The month axis, as given. */
  months: string[];
  /** Known values ranked by total, then the no-value series if any. */
  series: { value: string | null; incidents: number; counts: number[] }[];
  /** Visible incidents per month (no-value incidents included). */
  monthTotals: number[];
  /** Visible incidents with no usable Opened date, outside the axis. */
  undated: number;
}

/**
 * Incidents per month for each value of `dimension`.
 *
 * `months` is the axis: the selected months when a month filter is on, every
 * month of the dataset otherwise, so a month with no visible incidents is a
 * real zero rather than a gap.
 */
export function monthlySeries(incidents: OrigenIncident[], dimension: OrigenDimension, months: string[]): MonthlySeries {
  const index = new Map(months.map((m, i) => [m, i]));
  const byValue = new Map<string | null, number[]>();
  const monthTotals = months.map(() => 0);
  let undated = 0;
  for (const inc of incidents) {
    const position = index.get(parseMonthKey(inc.Opened));
    if (position === undefined) { undated++; continue; }
    const value = dimensionValue(inc, dimension);
    let counts = byValue.get(value);
    if (!counts) byValue.set(value, (counts = months.map(() => 0)));
    counts[position]++;
    monthTotals[position]++;
  }
  const series = [...byValue.entries()].map(([value, counts]) => ({ value, incidents: counts.reduce((a, b) => a + b, 0), counts }));
  return {
    months,
    series: [...rank(series.filter(s => s.value !== null)), ...series.filter(s => s.value === null)],
    monthTotals,
    undated,
  };
}

// ---------------------------------------------------------------------------
// Display helper
// ---------------------------------------------------------------------------

/**
 * The first `limit` ranked entries, and how many entries and incidents the rest
 * hold. Display only: the caller still has every entry for full tables, and no
 * metric is computed from the "Others" aggregate.
 */
export function topWithOthers<T extends { incidents: number }>(ranked: T[], limit: number): {
  shown: T[];
  others: { entries: number; incidents: number } | null;
} {
  if (ranked.length <= limit) return { shown: ranked, others: null };
  const rest = ranked.slice(limit);
  return { shown: ranked.slice(0, limit), others: { entries: rest.length, incidents: rest.reduce((a, r) => a + r.incidents, 0) } };
}

// ---------------------------------------------------------------------------
// Problem candidates
// ---------------------------------------------------------------------------

/** How many incidents carry each clusterId — over the whole dataset, this is the full candidate membership. */
export function clusterSizes(incidents: Pick<AnnotatedIncident, 'clusterId'>[]): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const inc of incidents) sizes.set(inc.clusterId, (sizes.get(inc.clusterId) ?? 0) + 1);
  return sizes;
}

/** Visible incidents grouped by clusterId. */
export function membersByCluster<T extends Pick<AnnotatedIncident, 'clusterId'>>(incidents: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const inc of incidents) {
    const list = groups.get(inc.clusterId);
    if (list) list.push(inc);
    else groups.set(inc.clusterId, [inc]);
  }
  return groups;
}

export type TopService =
  | { state: 'NOT_AVAILABLE' }
  /** Visible incidents exist but none has a Service. */
  | { state: 'NO_KNOWN_SERVICE' }
  | { state: 'SINGLE'; service: string; count: number; share: number }
  /** Two or more Services share the highest count; none is picked. */
  | { state: 'TIE'; services: string[]; count: number; share: number };

export interface ValueCount {
  value: string;
  count: number;
}

export interface CandidateOrigenContext {
  /** Visible incidents of the candidate (N). */
  visibleCount: number;
  /** All incidents carrying the candidate's clusterId, regardless of filters (M). */
  totalCount: number;
  /** Visible incidents with a known Service. */
  knownServiceCount: number;
  /** Distinct known Services among the visible incidents. */
  serviceCount: number;
  topService: TopService;
  /** Known Services, ranked. */
  services: ValueCount[];
  missingService: number;
  /** Known Service offerings, ranked; null when the file has no Service offering column. */
  offerings: ValueCount[] | null;
  missingOffering: number;
  distinctAssignmentGroups: number;
  /** Service × Assignment group counts of the visible incidents. */
  serviceByGroup: CrossTab;
}

function rankedCounts(values: (string | null)[]): { counts: ValueCount[]; missing: number } {
  const counts = new Map<string, number>();
  let missing = 0;
  for (const v of values) {
    if (v === null) missing++;
    else counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return {
    counts: [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || compareValues(a.value, b.value)),
    missing,
  };
}

/**
 * Service context of one candidate's visible incidents.
 *
 * Top Service % = visible incidents of the most frequent Service / visible
 * incidents with a known Service. No dominance threshold: a tie is reported as
 * a tie, and a candidate with no known Service has no top Service.
 */
export function candidateOrigenContext(
  visibleMembers: OrigenIncident[],
  totalCount: number,
  available: { service: boolean; serviceOffering: boolean },
): CandidateOrigenContext {
  const svc = rankedCounts(visibleMembers.map(i => dimensionValue(i, 'service')));
  const off = rankedCounts(visibleMembers.map(i => dimensionValue(i, 'serviceOffering')));
  const known = visibleMembers.length - svc.missing;

  let topService: TopService;
  if (!available.service) topService = { state: 'NOT_AVAILABLE' };
  else if (svc.counts.length === 0) topService = { state: 'NO_KNOWN_SERVICE' };
  else {
    const max = svc.counts[0].count;
    const leaders = svc.counts.filter(c => c.count === max).map(c => c.value);
    topService = leaders.length > 1
      ? { state: 'TIE', services: leaders, count: max, share: max / known }
      : { state: 'SINGLE', service: leaders[0], count: max, share: max / known };
  }

  const ags = new Set(visibleMembers.map(i => dimensionValue(i, 'assignmentGroup')));
  return {
    visibleCount: visibleMembers.length,
    totalCount,
    knownServiceCount: known,
    serviceCount: svc.counts.length,
    topService,
    services: svc.counts,
    missingService: svc.missing,
    offerings: available.serviceOffering ? off.counts : null,
    missingOffering: off.missing,
    distinctAssignmentGroups: distinctKnown(ags),
    serviceByGroup: crossTab(visibleMembers, 'service', 'assignmentGroup'),
  };
}

// ---------------------------------------------------------------------------
// Filter options
// ---------------------------------------------------------------------------

export interface DimensionOptions {
  /** Every known value in the file, alphabetical. Static for the loaded file. */
  values: string[];
  /** Whether any incident has no value, so a "no value" option exists. */
  hasMissing: boolean;
}

/** The selectable values of a dimension: the whole file, independent of every filter. */
export function dimensionOptions(allIncidents: OrigenIncident[], dimension: 'service' | 'serviceOffering'): DimensionOptions {
  const values = new Set<string>();
  let hasMissing = false;
  for (const inc of allIncidents) {
    const v = dimensionValue(inc, dimension);
    if (v === null) hasMissing = true;
    else values.add(v);
  }
  return { values: [...values].sort(compareValues), hasMissing };
}

export interface FacetCounts {
  values: Map<string, number>;
  missing: number;
}

/**
 * Incidents per option of `dimension` under every filter except the dimension's
 * own selection, so choosing an option never changes its own count.
 */
export function facetCounts(allIncidents: OrigenIncident[], filters: GlobalFilters, dimension: 'service' | 'serviceOffering'): FacetCounts {
  const population = filterIncidents(allIncidents, {
    ...filters,
    ...(dimension === 'service' ? { services: ALL_VALUES } : { serviceOfferings: ALL_VALUES }),
  });
  const values = new Map<string, number>();
  let missing = 0;
  for (const inc of population) {
    const v = dimensionValue(inc, dimension);
    if (v === null) missing++;
    else values.set(v, (values.get(v) ?? 0) + 1);
  }
  return { values, missing };
}
