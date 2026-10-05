/**
 * Display defaults and the compute guard of the experimental Incident Families
 * view (FAM-01). UI conveniences only: the defaults are not methodological
 * selections. Free of build-time imports so `src/lib` can read them.
 */
import { FAMILIES_RESEARCH } from './familiesResearch';

type TextVariant = (typeof FAMILIES_RESEARCH.variants)[number];

export const FAMILIES_DISPLAY = {
  defaultVariant: 'R0' as TextVariant,
  defaultTau: 0.05,
  defaultThreshold: 0.7,
  /**
   * Most incidents the browser computes families for. Above it the view shows
   * a message instead of computing. Set from the measured cost of a
   * 2,819-row file (see FAM-01 delivery notes).
   */
  maxRows: 6000,
  /** Families listed before "Show more". */
  pageSize: 50,
  /**
   * Distinct weeks (in view) for the descriptive "Recurring pattern" tag —
   * the same three weeks production uses to call a problem chronic.
   */
  recurringMinWeeks: 3,
} as const;
