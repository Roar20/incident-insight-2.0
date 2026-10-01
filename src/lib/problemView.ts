/**
 * The filters that decide which incidents and problems the user is looking at.
 *
 * The dashboard and the export both go through these functions, so what is
 * exported is exactly what is on screen.
 */
import { parseMonthKey } from './analytics';
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
