/**
 * Whether the SLA flag carries any signal, shared by Executive Summary and
 * Weekly Review.
 *
 * SLA-tracked incidents are the closed ones with a recorded Made SLA — the
 * population Overview's and Weekly Review's "SLA Breached" already use. When
 * every tracked value is the same, the flag tells nothing apart: a 0% breach
 * then means "no signal", not good SLA performance.
 */
import type { AnnotatedIncident } from './problems';

export type SlaSignal =
  /** The file has no SLA column, or no closed incident records it. */
  | { state: 'not-available' }
  /** Every SLA-tracked incident has the same value, so the flag tells nothing apart. */
  | { state: 'no-signal'; tracked: number }
  /** Breach share of SLA-tracked closed incidents, as Overview computes it. */
  | { state: 'available'; tracked: number; breachPct: number };

/** The SLA flag's signal over `incidents`; `slaColumnPresent` says whether the file has an SLA column. */
export function slaSignal(
  incidents: Pick<AnnotatedIncident, 'isClosed' | 'Made SLA'>[],
  slaColumnPresent: boolean,
): SlaSignal {
  if (!slaColumnPresent) return { state: 'not-available' };
  const tracked = incidents.filter(i => i.isClosed && i['Made SLA'] !== null);
  if (tracked.length === 0) return { state: 'not-available' };
  const breached = tracked.filter(i => i['Made SLA'] === false).length;
  if (breached === 0 || breached === tracked.length) return { state: 'no-signal', tracked: tracked.length };
  return { state: 'available', tracked: tracked.length, breachPct: Math.round((breached / tracked.length) * 100) };
}
