/**
 * The filters that decide which incidents and problems the user is looking at.
 *
 * The dashboard and the export both go through these functions, so what is
 * exported is exactly what is on screen.
 */
import { parseMonthKey } from './analytics';
import { getDimension } from './dimensions';
import type { AnnotatedIncident, ProblemCluster } from './problems';

/** Filters local to the Problems view, applied on top of the month filter. */
export interface ProblemListFilters {
  search: string;
  /** A category name, or 'all'. */
  category: string;
  /** Keep only problems where under half the incidents document a cause. */
  onlyUndocumented: boolean;
}

/** Incidents opened in one of the given `YYYY-MM` months. */
export function filterByMonths<T extends Pick<AnnotatedIncident, 'Opened'>>(incidents: T[], months: string[]): T[] {
  const selected = new Set(months);
  return incidents.filter(inc => selected.has(parseMonthKey(inc.Opened)));
}

/** The problems the Problems view lists for the given filters. */
export function filterVisibleProblems(problems: ProblemCluster[], filters: ProblemListFilters): ProblemCluster[] {
  const q = filters.search.trim().toLowerCase();
  return problems.filter(p => {
    if (filters.category !== 'all' && p.category !== filters.category) return false;
    if (filters.onlyUndocumented && p.rcaCoverage >= 50) return false;
    if (q && !p.title.toLowerCase().includes(q) && !p.category.toLowerCase().includes(q)) return false;
    return true;
  });
}

/**
 * A selection on one optional dimension (Service or Service offering).
 *
 * No values and no `includeMissing` means no filter — "All", which keeps
 * incidents with and without a value. Otherwise an incident is kept when its
 * value is one of `values`, or when it has no value and `includeMissing` is set.
 */
export interface DimensionSelection {
  values: string[];
  /** Keep incidents with no value for the dimension ("No Service" / "No Offering"). */
  includeMissing: boolean;
}

export const ALL_VALUES: DimensionSelection = { values: [], includeMissing: false };

/** The global filters, applied together as an intersection. */
export interface GlobalFilters {
  /** `YYYY-MM` months; empty means every month. */
  months: string[];
  services: DimensionSelection;
  serviceOfferings: DimensionSelection;
}

export function isDimensionFiltered(selection: DimensionSelection): boolean {
  return selection.values.length > 0 || selection.includeMissing;
}

export function isAnyFilterActive(filters: GlobalFilters): boolean {
  return filters.months.length > 0 || isDimensionFiltered(filters.services) || isDimensionFiltered(filters.serviceOfferings);
}

/**
 * Multi-select toggle of one value: adds it when absent, removes it when present,
 * and keeps every other value and the missing-value choice as they are.
 * The one rule shared by every control that edits a dimension selection.
 */
export function toggleSelectionValue(selection: DimensionSelection, value: string): DimensionSelection {
  const values = selection.values.includes(value) ? selection.values.filter(v => v !== value) : [...selection.values, value];
  return { ...selection, values };
}

/** Multi-select toggle of the missing-value option ("No Service" / "No Offering"); values are kept. */
export function toggleSelectionMissing(selection: DimensionSelection): DimensionSelection {
  return { ...selection, includeMissing: !selection.includeMissing };
}

/** A predicate for one dimension selection, or null when it does not filter. */
function dimensionPredicate(selection: DimensionSelection): ((value: string | null) => boolean) | null {
  if (!isDimensionFiltered(selection)) return null;
  const values = new Set(selection.values);
  return value => (value === null ? selection.includeMissing : values.has(value));
}

/**
 * The incidents visible under the global filters: month ∩ Service ∩ Service offering.
 *
 * Filtering only narrows the population. clusterId was assigned once over the
 * whole dataset and is never touched here, so problems regrouped from the
 * result keep their identity. With no filter active the input array itself is
 * returned, so every view sees exactly the unfiltered data.
 */
export function filterIncidents<T extends Pick<AnnotatedIncident, 'Opened' | 'extraFields'>>(incidents: T[], filters: GlobalFilters): T[] {
  if (!isAnyFilterActive(filters)) return incidents;
  const months = filters.months.length > 0 ? new Set(filters.months) : null;
  const service = dimensionPredicate(filters.services);
  const offering = dimensionPredicate(filters.serviceOfferings);
  return incidents.filter(inc =>
    (!months || months.has(parseMonthKey(inc.Opened)))
    && (!service || service(getDimension(inc, 'service')))
    && (!offering || offering(getDimension(inc, 'serviceOffering'))));
}
