/**
 * Period-over-period aggregation, for both the monthly and weekly views.
 */
import type { IncidentScore } from './scorer';
import type { AnnotatedIncident } from './problems';
import { parseMonthKey, monthLabel } from './analytics';
import { weekLabel, type Period } from './periods';

export interface PeriodTrend {
  /** '2025-03' for a month, '2025-W14' for a week. */
  key: string;
  label: string;
  count: number;
  avgScore: number;
  excellent: number;
  good: number;
  poor: number;
  critical: number;
  excellentPct: number;
  poorOrCriticalPct: number;
  avgDescQuality: number;
  avgRootCause: number;
  avgSteps: number;
  avgSpelling: number;
  avgProfessionalism: number;
  noRootCausePct: number;
  highNoisePct: number;
  /** Typical time to resolve, in hours. Null when nothing in the period closed. */
  medianResolutionHours: number | null;
  /** Share of closed incidents that missed SLA. Null when no closed incident records Made SLA. */
  slaBreachPct: number | null;
  /** Share of incidents with a root cause actually written down. */
  rcaCoveragePct: number;
  /** Incidents opened in the period that are still not closed or resolved. */
  openCount: number;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return round1(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

function wholePct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/**
 * Group incidents into calendar periods, chronologically.
 *
 * Incidents with no usable Opened date are skipped rather than bucketed into a
 * phantom period.
 */
export function computePeriodTrends(
  incidents: AnnotatedIncident[],
  scores: IncidentScore[],
  period: Period,
): PeriodTrend[] {
  const scoreMap = new Map(scores.map(s => [s.number, s]));
  const buckets = new Map<string, { incidents: AnnotatedIncident[]; scores: IncidentScore[] }>();

  for (const inc of incidents) {
    const key = period === 'week' ? inc.week : parseMonthKey(inc.Opened);
    if (!key) continue;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { incidents: [], scores: [] };
      buckets.set(key, bucket);
    }
    bucket.incidents.push(inc);
    const score = scoreMap.get(inc.Number);
    if (score) bucket.scores.push(score);
  }

  const avg = (values: number[]) => round1(mean(values));

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { incidents: incs, scores: ms }]) => {
      const count = ms.length;
      const excellent = ms.filter(s => s.label === 'Excellent').length;
      const good = ms.filter(s => s.label === 'Good').length;
      const poor = ms.filter(s => s.label === 'Poor').length;
      const critical = ms.filter(s => s.label === 'Critical').length;

      const closed = incs.filter(i => i.isClosed);
      const slaTracked = closed.filter(i => i['Made SLA'] !== null);
      const durations = incs.filter(i => i.resolutionHours !== null).map(i => i.resolutionHours!);

      return {
        key,
        label: period === 'week' ? weekLabel(key) : monthLabel(key),
        count,
        avgScore: avg(ms.map(s => s.totalScore)),
        excellent,
        good,
        poor,
        critical,
        excellentPct: wholePct(excellent, count),
        poorOrCriticalPct: wholePct(poor + critical, count),
        avgDescQuality: avg(ms.map(s => s.dimScores.description_quality)),
        avgRootCause: avg(ms.map(s => s.dimScores.root_cause)),
        avgSteps: avg(ms.map(s => s.dimScores.steps_documented)),
        avgSpelling: avg(ms.map(s => s.dimScores.spelling_grammar)),
        avgProfessionalism: avg(ms.map(s => s.dimScores.professionalism)),
        noRootCausePct: wholePct(ms.filter(s => s.dimScores.root_cause === 0).length, count),
        highNoisePct: wholePct(ms.filter(s => s.noiseRatio > 0.5).length, count),
        medianResolutionHours: median(durations),
        slaBreachPct: slaTracked.length > 0 ? wholePct(slaTracked.filter(i => i['Made SLA'] === false).length, slaTracked.length) : null,
        rcaCoveragePct: wholePct(incs.filter(i => i.rootCauseText).length, incs.length),
        openCount: incs.length - closed.length,
      };
    });
}
