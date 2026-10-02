/**
 * Versioned schema configuration for optional dimension fields.
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
 * Future candidate aliases — NOT configured, no evidence yet in the repo or a
 * real export: `service`, `business_service`, `Service Offering`,
 * `service_offering`, `close_code`. Add one only with an observed export that
 * uses it, and bump the version.
 */

export const SCHEMA_CONFIG_VERSION = '1.0.0';

export type DimensionField = 'service' | 'serviceOffering' | 'resolutionCode';

/** Source headers for each optional dimension, first match wins. */
export const OPTIONAL_DIMENSION_ALIASES: Readonly<Record<DimensionField, readonly string[]>> = {
  service: ['Service'],
  serviceOffering: ['Service offering'],
  resolutionCode: ['Resolution code'],
};

export const DIMENSION_FIELDS: readonly DimensionField[] = ['service', 'serviceOffering', 'resolutionCode'];
