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
import { getDimension } from './dimensions';
import { ALL_VALUES, filterByMonths, filterIncidents, type DimensionSelection, type GlobalFilters } from './problemView';
import { clusterSizes, membersByCluster } from './serviceDimension';

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
