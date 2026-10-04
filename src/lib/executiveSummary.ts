/**
 * Executive Summary metrics.
 *
 * Pure, descriptive aggregations over the incidents visible under the global
 * filters. Everything reuses existing fields and calculations: Origen's
 * dimension tables for Handling Group / Service / Offering, the problems list
 * (regrouped by the clusterId each incident already carries — never
 * reclustered) and the incident fields Overview reads for service performance.
 * Blank values are never values.
 */
import { parseMonthKey } from './analytics';
import type { AnnotatedIncident } from './problems';
import { dimensionValue, fraction, type DimensionTable, type OrigenDimension } from './serviceDimension';

type Incident = Pick<AnnotatedIncident, 'Opened' | 'extraFields' | 'Assignment group' | 'clusterId'>;

// ---------------------------------------------------------------------------
// Period
// ---------------------------------------------------------------------------

export interface PeriodSpan {
  /** Distinct months (YYYY-MM) incidents were opened in. */
  months: number;
  first: string | null;
  last: string | null;
}

/** The months covered by the incidents' Opened dates. */
export function periodSpan(incidents: Pick<AnnotatedIncident, 'Opened'>[]): PeriodSpan {
  const keys = [...new Set(incidents.map(i => parseMonthKey(i.Opened)).filter(Boolean))].sort();
  return { months: keys.length, first: keys[0] ?? null, last: keys[keys.length - 1] ?? null };
}

// ---------------------------------------------------------------------------
// Concentration
// ---------------------------------------------------------------------------

export interface TopShare {
  /** Values named (at most the requested k). */
  named: number;
  /** Distinct known values. */
  distinct: number;
  incidents: number;
  /** Named values' incidents / all visible incidents, or null when nothing is visible. */
  share: number | null;
}

/** Share of the visible incidents held by the top `k` known values of a dimension table. */
export function topShare(table: DimensionTable, k: number): TopShare {
  const top = table.rows.slice(0, k);
  const incidents = top.reduce((sum, row) => sum + row.incidents, 0);
  return { named: top.length, distinct: table.rows.length, incidents, share: fraction(incidents, table.visible) };
}

/**
 * The dimension "Where should we look?" ranks: Handling Group when it tells
 * incidents apart (two or more known values), otherwise Service, otherwise
 * Service offering. null when none of them has a known value.
 */
export function lookDimension(tables: Partial<Record<OrigenDimension, DimensionTable | null>>): OrigenDimension | null {
  const ag = tables.assignmentGroup;
  if (ag && ag.rows.length >= 2) return 'assignmentGroup';
  if (tables.service && tables.service.rows.length > 0) return 'service';
  if (tables.serviceOffering && tables.serviceOffering.rows.length > 0) return 'serviceOffering';
  return null;
}

// ---------------------------------------------------------------------------
// Largest pattern breadth
// ---------------------------------------------------------------------------

export interface PatternBreadth {
  incidents: number;
  services: number;
  serviceOfferings: number;
  assignmentGroups: number;
}

/** Distinct known Services, Offerings and Handling Groups among one pattern's visible incidents. */
export function patternBreadth(incidents: Incident[], clusterId: string): PatternBreadth {
  const members = incidents.filter(i => i.clusterId === clusterId);
  const distinct = (dimension: OrigenDimension) =>
    new Set(members.map(i => dimensionValue(i, dimension)).filter((v): v is string => v !== null)).size;
  return {
    incidents: members.length,
    services: distinct('service'),
    serviceOfferings: distinct('serviceOffering'),
    assignmentGroups: distinct('assignmentGroup'),
  };
}

// ---------------------------------------------------------------------------
// Service performance
// ---------------------------------------------------------------------------

/** Median open → close hours over incidents with both dates, as Overview computes it; null when none. */
export function medianResolutionHours(incidents: Pick<AnnotatedIncident, 'resolutionHours'>[]): number | null {
  const sorted = incidents.filter(i => i.resolutionHours !== null).map(i => i.resolutionHours!).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Headline (neutral factual templates — no qualitative thresholds)
// ---------------------------------------------------------------------------

export const pctText = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

const DIMENSION_PLURAL: Record<OrigenDimension, string> = {
  assignmentGroup: 'Handling Groups',
  service: 'Services',
  serviceOffering: 'Service Offerings',
};

export function dimensionPlural(dimension: OrigenDimension): string {
  return DIMENSION_PLURAL[dimension];
}

const DIMENSION_SINGULAR: Record<OrigenDimension, string> = {
  assignmentGroup: 'Handling Group',
  service: 'Service',
  serviceOffering: 'Service Offering',
};

export function dimensionSingular(dimension: OrigenDimension): string {
  return DIMENSION_SINGULAR[dimension];
}

/** "83% of incidents in view are handled by 3 of 10 Handling Groups" (or "associated with … Services"). */
export function concentrationSentence(dimension: OrigenDimension, top: TopShare): string {
  const verb = dimension === 'assignmentGroup' ? 'handled by' : 'associated with';
  return `${pctText(top.share)} of incidents in view are ${verb} ${top.named} of ${top.distinct} ${DIMENSION_PLURAL[dimension]}`;
}

export function headline(input: {
  look: { dimension: OrigenDimension; top: TopShare } | null;
  goodOrExcellent: number | null;
  withoutDiagnosis: number | null;
}): string {
  const documentation = `${pctText(input.goodOrExcellent)} of incidents are rated Good or Excellent for documentation and ${pctText(input.withoutDiagnosis)} have no documented diagnosis.`;
  if (!input.look || input.look.top.share === null) return documentation;
  return `${concentrationSentence(input.look.dimension, input.look.top)}; ${documentation.charAt(0).toLowerCase()}${documentation.slice(1)}`;
}
