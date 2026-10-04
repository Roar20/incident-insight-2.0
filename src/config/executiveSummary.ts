/**
 * Versioned configuration for the Executive Summary view.
 *
 * The numbers here only decide how much is drawn at once (top-k bars, the rest
 * rolled into a labelled "Others" row). They are not analytical thresholds and
 * never change a metric. The headline uses neutral factual templates, so it
 * needs no qualitative threshold ("concentrated", "small number"…).
 *
 * 1.1.0 — single source for caveat wording; "Evidence behind this summary" and
 * the methodology tables; discovery prompts off by default.
 */

export const EXECUTIVE_SUMMARY_CONFIG_VERSION = '1.1.0';

export const EXECUTIVE_SUMMARY_DISPLAY = {
  /** Handling Groups (or Services, on fallback) named in "Where should we look?". */
  concentrationTop: 3,
  /** Values per dimension named in "Where is demand coming from?". */
  originTop: 5,
  /** Repeat patterns named in "What keeps coming back?". */
  patternsTop: 5,
} as const;

/**
 * "Questions to unlock" and the other discovery prompts are discovery-session
 * material, not product functionality: off unless the build sets
 * VITE_EXEC_DISCOVERY_PROMPTS=on. Read at render time so tests can switch it.
 */
export function discoveryPromptsEnabled(): boolean {
  return import.meta.env.VITE_EXEC_DISCOVERY_PROMPTS === 'on';
}

/**
 * The one wording of each caveat. Section Evidence, "Evidence behind this
 * summary" and the methodology all read these, so the explanations cannot drift.
 */
export const EXECUTIVE_CAVEATS = {
  concentration: 'Measures where incident demand is concentrated, not team performance or ownership.',
  recurrence: 'Candidate grouping is order-dependent and should be interpreted directionally.',
  candidates: 'Patterns are candidates for review, not validated problems.',
  origin: 'Shows where incidents are associated, not why they occurred.',
  documentation: "Root cause detection is keyword-based; empty 'Root cause:' templates count as documented, so 'without diagnosis' is likely understated.",
  servicePerformance: 'Open-to-close time may reflect closure policy and is not necessarily restoration time.',
  sla: 'SLA reads the Made SLA flag of closed incidents; when every tracked value is the same, the flag carries no signal.',
  breadth: 'Describes how broadly a recurring pattern appears; each Service, Offering or Handling Group is context, not a separate problem.',
  applicationContext: 'Application context: not available — no approved extractor.',
  ciFields: 'CI and additional resolution fields are not currently used by Executive Summary.',
  fallback: 'When one Handling Group handles every incident in view, Service is the next informative dimension.',
} as const;

/** Methodology — Operational Metrics: what each metric measures today and how to read it. */
export const OPERATIONAL_METRICS: readonly { metric: string; measurement: string; interpretation: string }[] = [
  { metric: 'Service performance', measurement: 'Median open → close · SLA', interpretation: 'SLA may show little variation; close time may reflect a closure policy' },
  { metric: 'Operational concentration', measurement: 'Top-3 Handling Groups / Services', interpretation: 'Shows where incident demand is concentrated' },
  { metric: 'Recurring patterns', measurement: 'Candidate volume · largest pattern', interpretation: 'Directional; pattern grouping can vary with processing order' },
  { metric: 'Operational origin', measurement: 'Handling Group · Service · Offering', interpretation: 'Shows where demand is associated, not why it occurs' },
  { metric: 'Documentation readiness', measurement: 'Quality tiers · documented diagnosis', interpretation: `Directional; ${EXECUTIVE_CAVEATS.documentation}` },
  { metric: 'Pattern breadth', measurement: 'Services · Offerings · Handling Groups', interpretation: 'Describes how broadly a recurring pattern appears' },
];

/** Methodology — Interpretation Notes, in plain language. */
export const INTERPRETATION_NOTES: readonly { topic: string; note: string }[] = [
  { topic: 'Operational concentration', note: EXECUTIVE_CAVEATS.concentration },
  { topic: 'Recurring patterns', note: EXECUTIVE_CAVEATS.recurrence },
  { topic: 'Operational origin', note: EXECUTIVE_CAVEATS.origin },
  { topic: 'Documentation readiness', note: EXECUTIVE_CAVEATS.documentation },
  { topic: 'Service performance', note: EXECUTIVE_CAVEATS.servicePerformance },
];
