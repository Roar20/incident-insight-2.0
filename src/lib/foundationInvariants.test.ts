/**
 * S0 foundation: generalization and invariants.
 *
 * Generalization — the same profile code, run over synthetic datasets that
 * differ in columns, values, cardinality and journal wording, reports exactly
 * what each dataset contains. Expected results are recomputed from the rows,
 * never fixed numbers.
 *
 * Invariants — the foundation reads data and changes nothing: dimension columns
 * do not affect scores, clustering, root causes, Pattern or temporal buckets,
 * and the profile classifies nothing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXTURES, buildRows, toXlsxBuffer, type FixtureName } from '../test/fixtures/syntheticDatasets';
import { computeDatasetProfile } from './datasetProfile';
import { getDimension } from './dimensions';
import { enrichRow, inferDateOrder, readIncidentTable, type IncidentRow } from './parser';
import { scoreIncident } from './scorer';
import { annotateIncidents, computeProblemClusters, recommendActions } from './problems';
import { parseMonthKey } from './analytics';

/** The worker's pipeline, end to end from an xlsx file. */
function pipeline(rows: IncidentRow[]) {
  const { rows: parsed, columns } = readIncidentTable(toXlsxBuffer(rows));
  const dateOrder = inferDateOrder(parsed);
  const enriched = parsed.map(r => enrichRow(r, { dateOrder }));
  const scores = enriched.map(scoreIncident);
  const incidents = annotateIncidents(enriched);
  return { incidents, scores, columns };
}

/** Distinct non-blank values of a column in the generated rows, with counts. */
function expectedValues(rows: IncidentRow[], column: string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const v = row[column];
    if (typeof v === 'string' && v.trim()) counts.set(v.trim(), (counts.get(v.trim()) ?? 0) + 1);
  }
  return counts;
}

const ALL: FixtureName[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

describe('generalization: same profile code, different data', () => {
  const cases = ALL.map(name => {
    const rows = buildRows(FIXTURES[name]);
    const { incidents, columns } = pipeline(rows);
    return { name, spec: FIXTURES[name], rows, incidents, profile: computeDatasetProfile(incidents, columns) };
  });

  it.each(cases.map(c => [c.name, c] as const))('fixture %s: discovered values are exactly the generated ones', (_, c) => {
    const columnOf = { assignmentGroup: 'Assignment group', channel: 'Channel', service: 'Service', serviceOffering: 'Service offering', resolutionCode: 'Resolution code' } as const;
    for (const [field, column] of Object.entries(columnOf) as [keyof typeof columnOf, string][]) {
      const present = c.rows.some(r => column in r);
      if (!present) {
        expect(c.profile.fields[field], `${c.name}.${field}`).toEqual({ status: 'ABSENT' });
        expect(c.profile.values[field], `${c.name}.${field}`).toEqual({ values: [], distinct: null });
        continue;
      }
      const expected = expectedValues(c.rows, column);
      const found = new Map(c.profile.values[field].values.map(v => [v.value, v.count]));
      expect(found, `${c.name}.${field}`).toEqual(expected);
      expect(c.profile.values[field].distinct).toBe(expected.size);
      const presence = c.profile.fields[field];
      expect(presence.status).toBe('PRESENT');
      if (presence.status === 'PRESENT') {
        const nonEmpty = [...expected.values()].reduce((a, b) => a + b, 0);
        expect(presence.nonEmpty).toBe(nonEmpty);
        expect(presence.nonEmpty + presence.empty).toBe(c.rows.length);
      }
    }
    expect(c.profile.rowCount).toBe(c.rows.length);
  });

  it.each(cases.filter(c => c.spec.services).map(c => [c.name, c] as const))('fixture %s: co-occurrence matches a brute-force count', (_, c) => {
    const pairsOf = (other: string) => {
      const byService = new Map<string, Set<string>>();
      const byOther = new Map<string, Set<string>>();
      let both = 0;
      for (const r of c.rows) {
        const s = String(r.Service ?? '').trim();
        const o = String(r[other] ?? '').trim();
        if (!s || !o) continue;
        both++;
        (byService.get(s) ?? byService.set(s, new Set()).get(s)!).add(o);
        (byOther.get(o) ?? byOther.set(o, new Set()).get(o)!).add(s);
      }
      const sizes = (m: Map<string, Set<string>>) => [...m.values()].map(x => x.size);
      return {
        incidents: both,
        pairs: sizes(byService).reduce((a, b) => a + b, 0),
        leftWithMultipleRight: sizes(byService).filter(n => n > 1).length,
        maxRightPerLeft: Math.max(0, ...sizes(byService)),
        rightWithMultipleLeft: sizes(byOther).filter(n => n > 1).length,
        maxLeftPerRight: Math.max(0, ...sizes(byOther)),
      };
    };
    expect(c.profile.coOccurrence.serviceAssignmentGroup).toEqual(pairsOf('Assignment group'));
    expect(c.profile.coOccurrence.serviceServiceOffering).toEqual(pairsOf('Service offering'));
  });

  it('fixtures A and B share code but no values', () => {
    const [a, b] = [cases[0], cases[1]];
    const valuesOf = (c: typeof a) => new Set(c.profile.values.service.values.map(v => v.value));
    const overlap = [...valuesOf(a)].filter(v => valuesOf(b).has(v));
    expect(overlap).toEqual([]);
    expect(a.profile.dates.opened?.first?.slice(0, 7)).not.toBe(b.profile.dates.opened?.first?.slice(0, 7));
  });

  it('fixture C (no Service/Offering) degrades to ABSENT, with no co-occurrence', () => {
    const c = cases.find(x => x.name === 'C')!;
    expect(c.profile.fields.service).toEqual({ status: 'ABSENT' });
    expect(c.profile.fields.serviceOffering).toEqual({ status: 'ABSENT' });
    expect(c.profile.coOccurrence).toEqual({ serviceAssignmentGroup: null, serviceServiceOffering: null });
    expect(c.incidents.every(i => getDimension(i, 'service') === null)).toBe(true);
  });

  it('fixture I (high cardinality) is profiled in one bounded pass', () => {
    const c = cases.find(x => x.name === 'I')!;
    const { columns } = readIncidentTable(toXlsxBuffer(c.rows));
    const start = performance.now();
    computeDatasetProfile(c.incidents, columns);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(c.profile.values.service.distinct).toBe(expectedValues(c.rows, 'Service').size);
    expect(c.profile.values.service.distinct!).toBeGreaterThan(300);
  });

  it('fixture J (other instance wording) keeps the current parser behaviour and adds no interpretation', () => {
    const c = cases.find(x => x.name === 'J')!;
    // No configured system author or phrase matches, so — exactly as today — every entry counts as human.
    expect(c.incidents.every(i => i.allNotes.every(n => !n.isSystem))).toBe(true);
    expect(c.incidents.every(i => i.humanNotes.length === i.allNotes.length)).toBe(true);
  });
});

describe('invariants: the foundation changes nothing it reads', () => {
  /** Strip the dimension columns, and blank Channel, from rows. */
  const withoutDimensions = (rows: IncidentRow[]) => rows.map(r => {
    const { Service: _s, 'Service offering': _o, 'Resolution code': _r, ...rest } = r;
    return { ...rest, Channel: '' };
  });

  const analytics = (rows: IncidentRow[]) => {
    const { incidents, scores } = pipeline(rows);
    const clusters = computeProblemClusters(incidents, scores);
    return {
      scores,
      perIncident: incidents.map(i => ({
        number: i.Number, clusterId: i.clusterId, category: i.category, rootCauseText: i.rootCauseText,
        resolutionHours: i.resolutionHours, week: i.week, month: parseMonthKey(i.Opened), isClosed: i.isClosed,
      })),
      clusters,
      actions: recommendActions(clusters, incidents.length).map(a => [a.kind, a.cluster.id]),
    };
  };

  it.each(['A', 'D', 'E', 'I'] as FixtureName[])('fixture %s: dimension and Channel columns do not change scores, clustering, root cause, Pattern or time buckets', name => {
    const rows = buildRows(FIXTURES[name]);
    const withDims = analytics(rows);
    const without = analytics(withoutDimensions(rows));
    expect(withDims.scores).toEqual(without.scores);
    expect(withDims.perIncident).toEqual(without.perIncident);
    // Cluster objects carry count, share, rcaCoverage, isChronic (Pattern), weeks, ranking order.
    expect(withDims.clusters).toEqual(without.clusters);
    expect(withDims.actions).toEqual(without.actions);
    expect(withDims.clusters.length).toBeGreaterThan(0);
  });

  it('profiling and dimension access do not mutate incidents', () => {
    const rows = buildRows(FIXTURES.A);
    const { incidents, columns } = pipeline(rows);
    const before = structuredClone(incidents);
    computeDatasetProfile(incidents, columns);
    for (const inc of incidents) {
      getDimension(inc, 'service');
      getDimension(inc, 'serviceOffering');
      getDimension(inc, 'resolutionCode');
    }
    expect(incidents).toEqual(before);
  });

  it('the profile describes data and classifies nothing', () => {
    const rows = buildRows(FIXTURES.F);
    const { incidents, columns } = pipeline(rows);
    const profile = computeDatasetProfile(incidents, columns);
    expect(Object.keys(profile).sort()).toEqual(
      ['coOccurrence', 'dates', 'fields', 'profileVersion', 'rowCount', 'schemaConfigVersion', 'values'],
    );
    const keys: string[] = [];
    const walk = (x: unknown) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { keys.push(k); walk(v); }
    };
    walk(profile);
    const interpretive = keys.filter(k => /automat|human|noise|noisy|dominan|unusual|owner|reassign|review|alert|repeat|problemType|classif/i.test(k));
    expect(interpretive).toEqual([]);
  });

  it('existing analytical thresholds are unchanged', () => {
    const source = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');
    const problems = source('problems.ts');
    for (const line of [
      'const SIMILARITY_THRESHOLD = 0.5;', 'const MAX_INDEX_DOC_FREQUENCY = 0.2;', 'const MIN_INDEXED_TOKENS = 2;',
      'const MAX_CANDIDATES = 40;', 'const CHRONIC_WEEKS = 3;', 'minCount = 2,',
      'const volumeFloor = Math.max(3, Math.round(totalIncidents * 0.01));',
    ]) expect(problems, line).toContain(line);
    const weekly = source('weekly.ts');
    for (const line of ['const BASELINE_WEEKS = 4;', 'const MOVEMENT_THRESHOLD_PCT = 25;', 'const MOVEMENT_MIN_COUNT = 3;']) {
      expect(weekly, line).toContain(line);
    }
  });
});
