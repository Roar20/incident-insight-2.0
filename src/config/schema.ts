/**
 * Versioned schema configuration for source headers.
 *
 * Service, Service offering and Resolution code are not part of the canonical
 * incident model: when a file has them they are kept verbatim in
 * `extraFields`, and the export reproduces them as source columns. This config
 * only says which source headers carry each dimension, so code can read them
 * through `lib/dimensions.ts` without remapping or removing anything.
 *
 * Only headers observed in a real export are configured — this is a verified
 * contract, not a list of plausible names. Values (which Services exist, and so
 * on) are never configuration; they are discovered from each file.
 *
 * 1.1.0 — the ServiceNow field names `business_service` and `service_offering`,
 * as a CSV export writes them, carry the same Service and Service offering as
 * the display labels. Dedicated email columns are dropped at ingestion, and a
 * few person columns are kept but never exported.
 *
 * Future candidate aliases — NOT configured: `service`, `Service Offering`,
 * `close_code` and `u_close_code` (two candidates for Resolution code; which one
 * carries it is undecided). Add one only with an observed export that uses it,
 * and bump the version.
 */

export const SCHEMA_CONFIG_VERSION = '1.1.0';

export type DimensionField = 'service' | 'serviceOffering' | 'resolutionCode';

/** Source headers for each optional dimension, first match wins. */
export const OPTIONAL_DIMENSION_ALIASES: Readonly<Record<DimensionField, readonly string[]>> = {
  service: ['Service', 'business_service'],
  serviceOffering: ['Service offering', 'service_offering'],
  resolutionCode: ['Resolution code'],
};

export const DIMENSION_FIELDS: readonly DimensionField[] = ['service', 'serviceOffering', 'resolutionCode'];

/**
 * A column that holds only an email address, such as ServiceNow's dot-walked
 * `assigned_to.email` or `assignment_group.email`: a header that is `email`
 * (or `e-mail`) on its own or as the last dot-separated segment. Such columns are
 * dropped when the file is read, so they never reach an incident, the UI or an
 * export. Free text that happens to contain an address is not touched here.
 */
const DEDICATED_EMAIL_HEADER_RE = /^(?:[^.]+\.)*e-?mail$/i;

export function isDedicatedEmailHeader(header: string): boolean {
  return DEDICATED_EMAIL_HEADER_RE.test(header.trim());
}

/**
 * Unmapped person columns kept with each incident for future analysis but left
 * out of every export. Exact source headers only: mapped canonical fields such as
 * `Assigned to` / `assigned_to` keep their existing behaviour and are not listed.
 */
export const EXPORT_EXCLUDED_EXTRA_COLUMNS: readonly string[] = ['opened_by', 'closed_by', 'sys_updated_by'];

export function isExportExcludedExtraColumn(header: string): boolean {
  return EXPORT_EXCLUDED_EXTRA_COLUMNS.includes(header);
}
