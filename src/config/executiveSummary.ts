/**
 * Versioned configuration for the Executive Summary view.
 *
 * The numbers here only decide how much is drawn at once (top-k bars, the rest
 * rolled into a labelled "Others" row). They are not analytical thresholds and
 * never change a metric. The headline uses neutral factual templates, so it
 * needs no qualitative threshold ("concentrated", "small number"…).
 */

export const EXECUTIVE_SUMMARY_CONFIG_VERSION = '1.0.0';

export const EXECUTIVE_SUMMARY_DISPLAY = {
  /** Handling Groups (or Services, on fallback) named in "Where should we look?". */
  concentrationTop: 3,
  /** Values per dimension named in "Where is demand coming from?". */
  originTop: 5,
  /** Repeat patterns named in "What keeps coming back?". */
  patternsTop: 5,
} as const;

/**
 * "Questions to unlock" and the sponsor prompts are discovery material, not
 * product functionality. They show unless the build sets
 * VITE_EXEC_DISCOVERY_PROMPTS=off.
 */
export const DISCOVERY_PROMPTS_ENABLED = import.meta.env.VITE_EXEC_DISCOVERY_PROMPTS !== 'off';
