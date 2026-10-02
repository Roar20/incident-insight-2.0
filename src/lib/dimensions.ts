/**
 * Read-only access to optional dimension fields (Service, Service offering,
 * Resolution code).
 *
 * The values stay where ingestion put them — verbatim in `extraFields` — and
 * this module only reads them through the aliases in `config/schema.ts`. It
 * never mutates an incident, never maps one value onto another and never
 * invents a bucket for a missing value: absent or blank reads as null.
 */
import { OPTIONAL_DIMENSION_ALIASES, type DimensionField } from '../config/schema';
import type { EnrichedIncident, SourceColumn } from './parser';

/** A dimension value as written, trimmed; null when the cell is blank or missing. */
function normalize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * The source header that carries `field` in this file, or null when the file
 * has none of its aliases — i.e. the dimension is not available.
 */
export function dimensionSourceHeader(field: DimensionField, columns: readonly Pick<SourceColumn, 'name'>[]): string | null {
  const names = new Set(columns.map(c => c.name));
  return OPTIONAL_DIMENSION_ALIASES[field].find(alias => names.has(alias)) ?? null;
}

/**
 * The incident's value for `field`, or null.
 *
 * The first alias present in the row wins, as for canonical fields, even when
 * its cell is blank.
 */
export function getDimension(incident: Pick<EnrichedIncident, 'extraFields'>, field: DimensionField): string | null {
  const extras = incident.extraFields;
  if (!extras) return null;
  for (const alias of OPTIONAL_DIMENSION_ALIASES[field]) {
    if (alias in extras) return normalize(extras[alias]);
  }
  return null;
}
