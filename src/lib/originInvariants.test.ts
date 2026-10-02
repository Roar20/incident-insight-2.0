/**
 * S1 invariants: Service / Service offering filters narrow the visible
 * population exactly like the month filter, and never change problem identity.
 *
 * Runs the same derivation AppContext does — filterIncidents, scores by
 * Number, computeProblemClusters — over the S0 synthetic fixtures.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXTURES, buildRows, toXlsxBuffer, type FixtureName } from '../test/fixtures/syntheticDatasets';
import { enrichRow, inferDateOrder, readIncidentTable } from './parser';
import { scoreIncident, type IncidentScore } from './scorer';
import { annotateIncidents, computeProblemClusters, type AnnotatedIncident } from './problems';
import { parseMonthKey } from './analytics';
import { ALL_VALUES, filterByMonths, filterIncidents, type DimensionSelection, type GlobalFilters } from './problemView';
import {
  candidateOrigenContext, clusterSizes, crossTab, dimensionOptions, dimensionTable, facetCounts, membersByCluster,
  monthlySeries, pairTable, topWithOthers,
} from './serviceDimension';
import { dimensionAvailability, getDimension } from './dimensions';
import { computeDatasetProfile } from './datasetProfile';
import { DISPLAY_CONFIG_VERSION, ORIGEN_DISPLAY } from '../config/display';

function load(name: FixtureName) {
  const { rows, columns } = readIncidentTable(toXlsxBuffer(buildRows(FIXTURES[name])));
  const dateOrder = inferDateOrder(rows);
  const enriched = rows.map(r => enrichRow(r, { dateOrder }));
  const scores = enriched.map(scoreIncident);
  return { incidents: annotateIncidents(enriched), scores, columns };
}

/** What AppContext derives for a filter state. */
function visible(incidents: AnnotatedIncident[], scores: IncidentScore[], filters: GlobalFilters) {
  const filtered = filterIncidents(incidents, filters);
  const numbers = new Set(filtered.map(i => i.Number));
  const filteredScores = filtered === incidents ? scores : scores.filter(s => numbers.has(s.number));
  return { filtered, problems: computeProblemClusters(filtered, filteredScores) };
}

const NONE: GlobalFilters = { months: [], services: ALL_VALUES, serviceOfferings: ALL_VALUES };

/** Deterministic filter combinations over the values actually in the data. */
function combinations(incidents: AnnotatedIncident[]): GlobalFilters[] {
  const distinct = (f: (i: AnnotatedIncident) => string | null) =>
    [...new Set(incidents.map(f).filter((v): v is string => v !== null))].sort();
  const months = distinct(i => parseMonthKey(i.Opened) || null);
  const services = distinct(i => getDimension(i, 'service'));
  const offerings = distinct(i => getDimension(i, 'serviceOffering'));
  const sel = (values: string[], includeMissing = false): DimensionSelection => ({ values, includeMissing });
  return [
    { ...NONE, months: months.slice(0, 1) },
    { ...NONE, services: sel(services.slice(0, 1)) },
    { ...NONE, services: sel(services.slice(1, 3), true) },
    { ...NONE, serviceOfferings: sel(offerings.slice(0, 2)) },
    { ...NONE, serviceOfferings: sel([], true) },
    { months: months.slice(-1), services: sel(services.slice(0, 2)), serviceOfferings: sel(offerings.slice(0, 3)) },
    { months: ['1999-01'], services: sel(services.slice(0, 1)), serviceOfferings: ALL_VALUES },
  ];
}

describe('S1 filter invariants', () => {
  const fixtures: FixtureName[] = ['A', 'C', 'D', 'E', 'I'];

  it.each(fixtures)('fixture %s: with every filter at All, the visible population is the dataset itself', name => {
    const { incidents, scores } = load(name);
    const v = visible(incidents, scores, NONE);
    expect(v.filtered).toBe(incidents);
    expect(v.problems).toEqual(computeProblemClusters(incidents, scores));
  });

  it.each(fixtures)('fixture %s: no filter combination changes clusterId, full membership or reclusters', name => {
    const { incidents, scores } = load(name);
    const idsBefore = incidents.map(i => i.clusterId);
    const totals = clusterSizes(incidents);
    for (const filters of combinations(incidents)) {
      const v = visible(incidents, scores, filters);
      expect(incidents.map(i => i.clusterId)).toEqual(idsBefore);
      expect(clusterSizes(incidents)).toEqual(totals);
      // Every listed problem is an existing cluster, with no more visible members than its full membership.
      for (const p of v.problems) {
        expect(totals.has(p.id), p.id).toBe(true);
        expect(p.count).toBeLessThanOrEqual(totals.get(p.id)!);
        expect(p.count).toBe(membersByCluster(v.filtered).get(p.id)!.length);
      }
    }
  });

  it.each(fixtures)('fixture %s: Month × Service × Offering is the intersection of the three', name => {
    const { incidents } = load(name);
    for (const filters of combinations(incidents)) {
      const expected = incidents.filter(i => {
        const month = filters.months.length === 0 || filters.months.includes(parseMonthKey(i.Opened));
        const check = (sel: DimensionSelection, v: string | null) =>
          (sel.values.length === 0 && !sel.includeMissing) || (v === null ? sel.includeMissing : sel.values.includes(v));
        return month && check(filters.services, getDimension(i, 'service')) && check(filters.serviceOfferings, getDimension(i, 'serviceOffering'));
      });
      expect(filterIncidents(incidents, filters)).toEqual(expected);
    }
  });

  it('a month-only filter is unchanged from filterByMonths', () => {
    const { incidents } = load('A');
    const months = [parseMonthKey(incidents[0].Opened)];
    expect(filterIncidents(incidents, { ...NONE, months })).toEqual(filterByMonths(incidents, months));
  });

  it('an empty result is an empty population, not an error', () => {
    const { incidents, scores } = load('A');
    const v = visible(incidents, scores, { ...NONE, months: ['1999-01'] });
    expect(v.filtered).toEqual([]);
    expect(v.problems).toEqual([]);
  });

  it('AppContext narrows the population and never reclusters', () => {
    const source = readFileSync(resolve(__dirname, '../context/AppContext.tsx'), 'utf8');
    expect(source).toContain('filterIncidents(state.incidents, globalFilters)');
    expect(source).toContain('computeProblemClusters(filteredIncidents, filteredScores)');
    expect(source).not.toContain('annotateIncidents');
  });
});

describe('S1 metric invariants and closures', () => {
  const fixtures: FixtureName[] = ['A', 'B', 'C', 'D', 'E', 'I'];

  it.each(fixtures)('fixture %s: tables, cross-tabs and monthly series close on the visible population', name => {
    const { incidents, scores } = load(name);
    for (const filters of [NONE, ...combinations(incidents)]) {
      const v = visible(incidents, scores, filters);
      const ids = new Set(v.problems.map(p => p.id));
      for (const dim of ['service', 'serviceOffering'] as const) {
        const t = dimensionTable(v.filtered, dim, ids);
        const sum = t.rows.reduce((a, r) => a + r.incidents, 0) + (t.missing?.incidents ?? 0);
        expect(sum).toBe(v.filtered.length);
        // The no-value row is never ranked or counted as a value.
        expect(t.rows.every(r => r.value !== null)).toBe(true);
        expect(t.withValue).toBe(v.filtered.length - (t.missing?.incidents ?? 0));
      }
      const tab = crossTab(v.filtered, 'service', 'assignmentGroup');
      expect(tab.rows.reduce((a, r) => a + [...r.cells.values()].reduce((x, y) => x + y, 0), 0)).toBe(v.filtered.length);
      const months = [...new Set(incidents.map(i => parseMonthKey(i.Opened)).filter(Boolean))].sort();
      const monthly = monthlySeries(v.filtered, 'service', months);
      expect(monthly.monthTotals.reduce((a, b) => a + b, 0) + monthly.undated).toBe(v.filtered.length);
      const pairs = pairTable(v.filtered, 'service', 'serviceOffering', ids);
      expect([...pairs.pairs, ...pairs.partial].reduce((a, p) => a + p.incidents, 0)).toBe(v.filtered.length);
      // Facet counts for a dimension cover the population under every other filter.
      for (const dim of ['service', 'serviceOffering'] as const) {
        const f = facetCounts(incidents, filters, dim);
        const population = filterIncidents(incidents, { ...filters, ...(dim === 'service' ? { services: ALL_VALUES } : { serviceOfferings: ALL_VALUES }) });
        expect([...f.values.values()].reduce((a, b) => a + b, 0) + f.missing).toBe(population.length);
      }
    }
  });

  it.each(['D', 'E'] as FixtureName[])('fixture %s: many-to-many relationships agree with the S0 dataset profile', name => {
    const { incidents, columns } = load(name);
    const profile = computeDatasetProfile(incidents, columns);
    const pairs = pairTable(incidents, 'service', 'serviceOffering', new Set());
    expect(pairs.pairs.length).toBe(profile.coOccurrence.serviceServiceOffering!.pairs);
    const tab = crossTab(incidents, 'service', 'assignmentGroup');
    const knownPairs = tab.rows.filter(r => r.value !== null).reduce((a, r) => a + [...r.cells.keys()].filter(k => k !== null).length, 0);
    expect(knownPairs).toBe(profile.coOccurrence.serviceAssignmentGroup!.pairs);
    const services = dimensionTable(incidents, 'service', new Set());
    expect(services.rows.filter(r => r.distinctAssignmentGroups > 1).length).toBe(profile.coOccurrence.serviceAssignmentGroup!.leftWithMultipleRight);
    const offerings = dimensionTable(incidents, 'serviceOffering', new Set());
    expect(offerings.rows.filter(r => r.distinctServices > 1).length).toBe(profile.coOccurrence.serviceServiceOffering!.rightWithMultipleLeft);
  });

  it('candidate context: N Services counts known values only, the top Service is never missing, M is the full membership', () => {
    const { incidents, scores } = load('A');
    const totals = clusterSizes(incidents);
    for (const filters of [NONE, ...combinations(incidents)]) {
      const v = visible(incidents, scores, filters);
      const members = membersByCluster(v.filtered);
      for (const p of v.problems) {
        const ctx = candidateOrigenContext(members.get(p.id)!, totals.get(p.id)!, { service: true, serviceOffering: true });
        const known = members.get(p.id)!.map(i => getDimension(i, 'service')).filter((s): s is string => s !== null);
        expect(ctx.serviceCount).toBe(new Set(known).size);
        expect(ctx.visibleCount).toBe(p.count);
        expect(ctx.totalCount).toBe(totals.get(p.id));
        if (ctx.topService.state === 'SINGLE') expect(ctx.topService.service).not.toBeNull();
        if (ctx.topService.state === 'SINGLE' || ctx.topService.state === 'TIE') {
          expect(ctx.topService.share).toBeCloseTo(ctx.topService.count / known.length);
        }
      }
    }
  });

  it('a file without Service / Offering columns is NOT_AVAILABLE, not zero', () => {
    const { incidents, columns } = load('C');
    expect(dimensionAvailability(columns)).toMatchObject({ service: false, serviceOffering: false });
    const ctx = candidateOrigenContext(incidents.slice(0, 3), 3, dimensionAvailability(columns));
    expect(ctx.topService).toEqual({ state: 'NOT_AVAILABLE' });
    expect(ctx.offerings).toBeNull();
    expect(dimensionOptions(incidents, 'service')).toEqual({ values: [], hasMissing: true });
  });

  it('a known Service with a missing Offering is reported as a partial pair, never an artificial Offering', () => {
    const { incidents } = load('A');
    const pairs = pairTable(incidents, 'service', 'serviceOffering', new Set());
    const partialWithService = pairs.partial.filter(p => p.left !== null && p.right === null);
    const expected = incidents.filter(i => getDimension(i, 'service') !== null && getDimension(i, 'serviceOffering') === null).length;
    expect(partialWithService.reduce((a, p) => a + p.incidents, 0)).toBe(expected);
    expect(pairs.pairs.every(p => p.left !== null && p.right !== null)).toBe(true);
  });

  it('Top N + Others is display only: metrics are identical for any display limit', () => {
    const { incidents } = load('I');
    const table = dimensionTable(incidents, 'service', new Set());
    for (const limit of [1, 15, 10_000]) {
      const view = topWithOthers(table.rows, limit);
      expect(view.shown.reduce((a, r) => a + r.incidents, 0) + (view.others?.incidents ?? 0)).toBe(table.withValue);
      expect(dimensionTable(incidents, 'service', new Set())).toEqual(table);
    }
  });

  it('display configuration is named, versioned and as approved', () => {
    expect(DISPLAY_CONFIG_VERSION).toBe('1.1.0');
    expect(ORIGEN_DISPLAY).toEqual({ matrixServices: 15, matrixAssignmentGroups: 8, monthlySeries: 10, rankingChartServices: 10, tablePageSize: 25 });
  });
});
