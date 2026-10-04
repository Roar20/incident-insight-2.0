/**
 * The weekly operational review.
 *
 * A week in isolation is just a count. What makes it actionable is the
 * comparison: against last week, against the recent baseline, and against the
 * problems already known to recur. This module assembles that comparison.
 */
import type { IncidentScore } from './scorer';
import type { AnnotatedIncident, ProblemCluster } from './problems';
import { computeProblemClusters, recommendActions, type ProblemAction } from './problems';
import { computePeriodTrends, type PeriodTrend } from './trends';
import { weekRangeLabel } from './periods';

/** Weeks of history averaged to decide whether the current week is unusual. */
const BASELINE_WEEKS = 4;

/**
 * The baseline window for a week: the up-to-BASELINE_WEEKS weeks with data
 * before it, oldest first. The one definition used by the digest and by any
 * per-value "typical" (weekly composition), so they cannot diverge.
 */
export function baselineWeeksFor(weeks: string[], weekKey: string): string[] {
  const position = weeks.indexOf(weekKey);
  if (position < 0) return [];
  return weeks.slice(Math.max(0, position - BASELINE_WEEKS), position);
}

/** A category must move by at least this much to be called out as a movement. */
const MOVEMENT_THRESHOLD_PCT = 25;

/** And must have at least this many incidents, so small numbers do not shout. */
const MOVEMENT_MIN_COUNT = 3;

export interface CategoryMovement {
  name: string;
  count: number;
  /** Mean count over the preceding baseline weeks, rounded for display. */
  baseline: number;
  /** The same mean, unrounded — what `change` and the ordering use. */
  typical: number;
  /** count − typical, unrounded. */
  change: number;
  /** Change against that baseline, in percent. */
  deltaPct: number;
  direction: 'up' | 'down';
}

export interface WeeklyDigest {
  weekKey: string;
  rangeLabel: string;
  current: PeriodTrend;
  previous: PeriodTrend | null;
  /** Mean weekly volume over the preceding baseline weeks. */
  baselineCount: number;
  volumeDeltaPct: number;
  categoryMovements: CategoryMovement[];
  /** Problems seen this week that did not appear in the baseline window. */
  newProblems: ProblemCluster[];
  /** Problems seen this week that were already recurring beforehand. */
  recurringProblems: ProblemCluster[];
  topProblems: ProblemCluster[];
  actions: ProblemAction[];
  incidentCount: number;
}

function countByCategory(incidents: AnnotatedIncident[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const inc of incidents) {
    counts.set(inc.category, (counts.get(inc.category) ?? 0) + 1);
  }
  return counts;
}

/** Every week present in the data, oldest first. */
export function availableWeeks(incidents: AnnotatedIncident[]): string[] {
  const weeks = new Set<string>();
  for (const inc of incidents) {
    if (inc.week) weeks.add(inc.week);
  }
  return [...weeks].sort();
}

/**
 * Build the digest for one week.
 *
 * Returns null when the requested week holds no incidents, so callers can render
 * an empty state rather than a page of zeroes.
 */
export function computeWeeklyDigest(
  incidents: AnnotatedIncident[],
  scores: IncidentScore[],
  weekKey: string,
): WeeklyDigest | null {
  const weeks = availableWeeks(incidents);
  const position = weeks.indexOf(weekKey);
  if (position < 0) return null;

  const currentIncidents = incidents.filter(i => i.week === weekKey);
  if (currentIncidents.length === 0) return null;

  const baselineWeeks = baselineWeeksFor(weeks, weekKey);
  const baselineSet = new Set(baselineWeeks);
  const baselineIncidents = incidents.filter(i => baselineSet.has(i.week));

  const trends = computePeriodTrends(incidents, scores, 'week');
  const trendByKey = new Map(trends.map(t => [t.key, t]));
  const current = trendByKey.get(weekKey);
  if (!current) return null;

  const previousKey = position > 0 ? weeks[position - 1] : null;
  const previous = previousKey ? trendByKey.get(previousKey) ?? null : null;

  // Volume baseline
  const baselineCounts = baselineWeeks.map(w => trendByKey.get(w)?.count ?? 0);
  const baselineCount = baselineCounts.length
    ? baselineCounts.reduce((a, b) => a + b, 0) / baselineCounts.length
    : 0;
  const volumeDeltaPct = baselineCount > 0
    ? Math.round(((current.count - baselineCount) / baselineCount) * 100)
    : 0;

  // Category movements against the same baseline window
  const currentByCategory = countByCategory(currentIncidents);
  const baselineByCategory = countByCategory(baselineIncidents);
  const weekSpan = Math.max(1, baselineWeeks.length);

  const categoryMovements: CategoryMovement[] = [];
  for (const [name, count] of currentByCategory) {
    const baseline = (baselineByCategory.get(name) ?? 0) / weekSpan;
    if (count < MOVEMENT_MIN_COUNT) continue;

    // A category with no history at all is a movement only if it arrived in volume.
    const deltaPct = baseline > 0
      ? Math.round(((count - baseline) / baseline) * 100)
      : 100;

    if (Math.abs(deltaPct) < MOVEMENT_THRESHOLD_PCT) continue;
    categoryMovements.push({
      name,
      count,
      baseline: Math.round(baseline * 10) / 10,
      typical: baseline,
      change: count - baseline,
      deltaPct,
      direction: deltaPct >= 0 ? 'up' : 'down',
    });
  }
  // Largest absolute change vs typical first (a percentage on a tiny base must
  // not dominate); ties by this week's count, then name.
  categoryMovements.sort((a, b) =>
    Math.abs(b.change) - Math.abs(a.change) || b.count - a.count || a.name.localeCompare(b.name, 'en'));

  // Problems in this week, split by whether they are already known.
  const weekClusters = computeProblemClusters(currentIncidents, scores, 1);
  const knownClusterIds = new Set(baselineIncidents.map(i => i.clusterId));
  const recurringOverall = new Map(
    computeProblemClusters(incidents, scores, 2).map(c => [c.id, c]),
  );

  const newProblems: ProblemCluster[] = [];
  const recurringProblems: ProblemCluster[] = [];
  for (const cluster of weekClusters) {
    if (knownClusterIds.has(cluster.id)) {
      // Report the whole-dataset week span so "recurring" reflects real history.
      recurringProblems.push({
        ...cluster,
        weeksActive: recurringOverall.get(cluster.id)?.weeksActive ?? cluster.weeksActive,
        isChronic: recurringOverall.get(cluster.id)?.isChronic ?? cluster.isChronic,
      });
    } else if (cluster.count >= 2) {
      newProblems.push(cluster);
    }
  }

  return {
    weekKey,
    rangeLabel: weekRangeLabel(weekKey),
    current,
    previous,
    baselineCount: Math.round(baselineCount * 10) / 10,
    volumeDeltaPct,
    categoryMovements: categoryMovements.slice(0, 6),
    newProblems: newProblems.slice(0, 8),
    recurringProblems: recurringProblems.slice(0, 8),
    topProblems: weekClusters.filter(c => c.count >= 2).slice(0, 10),
    actions: recommendActions(weekClusters.filter(c => c.count >= 2), currentIncidents.length).slice(0, 6),
    incidentCount: currentIncidents.length,
  };
}
