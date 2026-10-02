/**
 * Versioned display configuration.
 *
 * These numbers only decide how much is drawn at once. They never change a
 * metric, a ranking, a filter or the data: anything beyond a limit is rolled
 * into a labelled "Others" row or column, or reached through the full table.
 * They are not analytical thresholds.
 */

export const DISPLAY_CONFIG_VERSION = '1.1.0';

export const ORIGEN_DISPLAY = {
  /** Services drawn as rows of the Service × Assignment group matrix. */
  matrixServices: 15,
  /** Assignment groups drawn as columns of the same matrix. */
  matrixAssignmentGroups: 8,
  /** Series drawn in the monthly view. */
  monthlySeries: 10,
  /** Services drawn as bars in "Where is the noise?"; the rest form one "Others" bar. */
  rankingChartServices: 10,
  /** Rows per page in full tables. */
  tablePageSize: 25,
} as const;
