/**
 * Registered C-REAL-04 parameters reproduced by the experimental Incident
 * Families view (FAM-01). These are research values, not product choices:
 * the view offers exactly these and nothing else. Kept free of build-time
 * imports so `src/lib` can read them on the server too.
 */

export const FAMILIES_RESEARCH = {
  /** R1/R2 template document-frequency levels τ. */
  taus: [0.02, 0.05, 0.10],
  /** M1 cosine thresholds; an edge exists when cosine ≥ threshold. */
  thresholds: [0.5, 0.6, 0.7, 0.8],
  /** Text variants: raw, template-neutralized, template + identifier neutralized. */
  variants: ['R0', 'R1', 'R2'],
  /** R1 template lines need at least this many word tokens. */
  lineMinTokens: 3,
  /** R1 template word n-gram length. */
  ngramN: 5,
} as const;
