/**
 * Display defaults and the compute guard of the experimental Incident Families
 * view (FAM-01). UI conveniences only: the defaults are not methodological
 * selections. Free of build-time imports so `src/lib` can read them.
 */
import { FAMILIES_RESEARCH } from './familiesResearch';

type TextVariant = (typeof FAMILIES_RESEARCH.variants)[number];

export const FAMILIES_DISPLAY = {
  /**
   * Exploratory UI default (FAM-01.2): R1 at τ 0.05, an already-registered
   * configuration. Changes only what the page opens with — not R1, M1, the
   * grids or parity. Not a selected or recommended configuration.
   */
  defaultVariant: 'R1' as TextVariant,
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
  /**
   * "How strict is the grouping?" → registered M1 thresholds. Balanced is the
   * exploratory default; Broader and Stricter are the adjacent registered
   * values. A starting point, not a recommended setting.
   */
  strictness: { broader: 0.6, balanced: 0.7, stricter: 0.8 },
  /** Group cards shown first, and added by each "Show 6 more groups" (never all at once). */
  topCards: 6,
  /** One-off incidents (and a group's incidents) listed per "Show 20 more". */
  incidentPage: 20,
  /** Characters of the example incident shown as the group name. */
  nameMaxChars: 60,
  /** Common words shown in a group's detail. */
  commonWords: 5,
  /** Common words shown on a card (the first of the detail's words). */
  cardWords: 3,
  /** Groups counted in the concentration line. */
  concentrationTop: 5,
  /** Distribution bar: the largest groups, then the next ones; the rest are "remaining". */
  distributionTop: 5,
  distributionNext: 20,
  /** Sparkline height and the minimum drawn height of a non-zero week (pixels, drawing only). */
  sparklineHeight: 28,
  sparklineMinBar: 3,
} as const;
