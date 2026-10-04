/**
 * Versioned display configuration and copy for Weekly Review.
 *
 * TOP_N only decides how many named values the weekly composition draws; the
 * rest are rolled into a labelled "Others" segment. It is not an analytical
 * threshold and never changes a count.
 */

export const WEEKLY_CONFIG_VERSION = '1.0.0';

export const WEEKLY_DISPLAY = {
  /** Named values drawn in "Where did this week's demand come from?". */
  compositionTopN: 6,
} as const;

/** The one wording of each Weekly Review caveat and fallback line. */
export const WEEKLY_COPY = {
  dataThroughCaveat: 'Comparisons assume the export covers the full week.',
  compositionTitle: "Where did this week's demand come from?",
  compositionSubtitle: (dimensionLabel: string) => `Incidents per week by ${dimensionLabel}`,
  singleService: (service: string) => `All incidents in view are associated with ${service}.`,
  singleServiceWithMissing: (service: string, missing: number) =>
    `All incidents with a Service in view are associated with ${service} (${missing} without Service).`,
  serviceDoesNotVary: 'Service does not vary in this view — showing Service Offering.',
  serviceUnavailable: 'Service is not available in this view — showing Service Offering.',
  showingHandlingGroup: 'Service and Service Offering do not vary in this view — showing Handling Group.',
  noInformativeDimension: 'No operational dimension varies enough in this view to show weekly composition.',
  newThisPeriod: 'New this period',
  slaNotAvailable: 'Not available',
  slaNoSignal: 'Needs data (no signal)',
} as const;
