import { describe, it, expect } from 'vitest';
import { annotateIncidents } from './problems';
import { availableWeeks, baselineWeeksFor } from './weekly';
import { computePeriodTrends } from './trends';
import { weekLabel } from './periods';
import {
  bridgeInsight, CATEGORICAL_PALETTE, chooseCompositionDimension, colorsForValues, dataThrough, formatChange,
  formatDataThrough, MISSING_KEY, OTHERS_KEY, weeklyComposition,
} from './weeklyComposition';
import { many, syntheticIncident, syntheticScore, type SyntheticIncidentSpec } from '../test/fixtures/weeklyFixtures';

const ALL = { service: true, serviceOffering: true, assignmentGroup: true };
const everyone = () => true;
const build = (specs: SyntheticIncidentSpec[][]) => annotateIncidents(specs.flat().map(syntheticIncident));
const windowOf = (incidents: ReturnType<typeof build>) => availableWeeks(incidents).map(key => ({ key, label: weekLabel(key) }));

/** SAP-like: several groups, many Services, some missing Service / Offering, uniform SLA. */
function sapLike() {
  const rows: SyntheticIncidentSpec[] = [];
  const services = ['Service-001', 'Service-002', 'Service-003', 'Service-004', 'Service-005', 'Service-006', 'Service-007', 'Service-008', 'Service-009'];
  for (let w = 0; w < 6; w++) {
    for (let k = 0; k < 14 + w; k++) {
      rows.push({
        week: w, day: k % 7,
        service: k % 11 === 10 ? '' : services[(k * (w + 1)) % services.length],
        offering: k % 9 === 8 ? ' ' : `Offering-00${(k % 5) + 1}`,
        group: `AG-00${(k % 4) + 1}`, madeSla: true,
      });
    }
  }
  return annotateIncidents(rows.map(syntheticIncident));
}

describe('dataThrough', () => {
  it('is the latest valid Opened in the given incidents, formatted without a zone label', () => {
    const incidents = build([[{ week: 0, day: 2 }, { week: 3, day: 4 }, { week: 1 }]]);
    incidents.push({ ...incidents[0], Opened: 'not a date' });
    const through = dataThrough(incidents)!;
    expect(through.toISOString()).toBe('2026-03-27T09:00:00.000Z');
    expect(formatDataThrough(through)).toBe('Mar 27, 2026');
    expect(formatDataThrough(through)).not.toMatch(/UTC|partial|complete/i);
    expect(dataThrough([])).toBeNull();
  });
});

describe('chooseCompositionDimension — Cases A–E over the population given', () => {
  it('A: Service with two or more known values', () => {
    expect(chooseCompositionDimension(sapLike(), ALL)).toMatchObject({ case: 'A', dimension: 'service' });
  });

  it('B: one known Service → the single-Service fact, Offering when it varies, counting incidents without a Service', () => {
    const one = build([[{ week: 0, service: 'Service-001', offering: 'Offering-001' }, { week: 1, service: 'Service-001', offering: 'Offering-002' }, { week: 1, service: '', offering: 'Offering-002' }]]);
    expect(chooseCompositionDimension(one, ALL)).toEqual({ case: 'B', dimension: 'serviceOffering', singleService: { value: 'Service-001', missing: 1 } });
  });

  it('B uses the filtered population, not the whole file', () => {
    const file = sapLike();
    const filtered = file.filter(i => i.extraFields?.Service === 'Service-001');
    expect(chooseCompositionDimension(file, ALL).case).toBe('A');
    expect(chooseCompositionDimension(filtered, ALL)).toMatchObject({ case: 'B', singleService: { value: 'Service-001', missing: 0 } });
  });

  it('C: no Service values (or no Service column) → Offering', () => {
    const noService = build([[{ week: 0, offering: 'Offering-001' }, { week: 1, offering: 'Offering-002' }]]);
    expect(chooseCompositionDimension(noService, ALL)).toMatchObject({ case: 'C', dimension: 'serviceOffering', singleService: null });
    expect(chooseCompositionDimension(sapLike(), { ...ALL, service: false })).toMatchObject({ case: 'C', dimension: 'serviceOffering' });
  });

  it('D: Offering does not vary either → Handling Group', () => {
    const d = build([[{ week: 0, offering: 'Offering-001', group: 'AG-001' }, { week: 1, offering: 'Offering-001', group: 'AG-002' }]]);
    expect(chooseCompositionDimension(d, ALL)).toMatchObject({ case: 'D', dimension: 'assignmentGroup' });
  });

  it('E: nothing varies → no dimension', () => {
    const e = build([[{ week: 0, offering: 'Offering-001' }, { week: 1, offering: 'Offering-001' }]]);
    expect(chooseCompositionDimension(e, ALL)).toEqual({ case: 'E', dimension: null, singleService: null });
  });
});

describe('weeklyComposition', () => {
  it('ranks named values once over the window: Top-N, then Others, then No …', () => {
    const incidents = sapLike();
    const c = weeklyComposition(incidents, everyone, windowOf(incidents), 'service', 6);
    const values = c.series.filter(s => s.kind === 'value');
    expect(values).toHaveLength(6);
    expect(c.series.map(s => s.kind)).toEqual(['value', 'value', 'value', 'value', 'value', 'value', 'others', 'missing']);
    expect(c.series.at(-1)!.label).toBe('No Service');
    expect(values.map(s => s.value)).not.toContain('');
    // Window totals are non-increasing along the legend.
    const totals = values.map(s => c.weeks.reduce((a, w) => a + (w[s.key] as number), 0));
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
  });

  it('keeps missing values out of Others and out of the Top-N', () => {
    const incidents = build([[...many(5, { week: 0, service: '' }), ...many(2, { week: 0, service: 'Service-001' }), ...many(1, { week: 0, service: 'Service-002' }), ...many(1, { week: 0, service: 'Service-003' })]]);
    const c = weeklyComposition(incidents, everyone, windowOf(incidents), 'service', 2);
    const w = c.weeks[0];
    expect(w[MISSING_KEY]).toBe(5);
    expect(w[OTHERS_KEY]).toBe(1);
    expect(c.series.filter(s => s.kind === 'value').map(s => s.value)).toEqual(['Service-001', 'Service-002']);
  });

  it.each([
    ['Service', 'service'],
    ['Service Offering', 'serviceOffering'],
    ['Handling Group', 'assignmentGroup'],
  ] as const)('stack total equals Incidents per week in %s mode, unfiltered and filtered', (_, dimension) => {
    const file = sapLike();
    for (const population of [file, file.filter(i => i.extraFields?.Service !== 'Service-002'), file.filter(i => i['Assignment group'] === 'AG-001')]) {
      const scores = population.map(i => syntheticScore(i.Number));
      const scored = new Set(scores.map(s => s.number));
      const trends = computePeriodTrends(population, scores, 'week');
      const c = weeklyComposition(population, i => scored.has(i.Number), trends.map(t => ({ key: t.key, label: t.label })), dimension, 6);
      for (const week of c.weeks) {
        const stacked = c.series.reduce((a, s) => a + (week[s.key] as number), 0);
        expect(stacked).toBe(week.total);
        expect(stacked).toBe(trends.find(t => t.key === week.key)!.count);
      }
    }
  });
});

describe('colorsForValues', () => {
  it('gives each value a stable colour that does not depend on rank or order, with no repeats', () => {
    const a = colorsForValues(['Service-003', 'Service-001', 'Service-002']);
    const b = colorsForValues(['Service-001', 'Service-002', 'Service-003']);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
    expect(new Set(a.values()).size).toBe(3);
    for (const c of a.values()) expect(CATEGORICAL_PALETTE).toContain(c);
  });

  it('uses no green or red', () => {
    const forbidden = ['#0ca30c', '#e34948', '#e66767', '#008300'];
    for (const c of CATEGORICAL_PALETTE) expect(forbidden).not.toContain(c);
  });
});

describe('bridgeInsight', () => {
  /** Baseline weeks 0–3, current week 4. */
  const weeksOf = (incidents: ReturnType<typeof build>) => {
    const weeks = availableWeeks(incidents);
    return { current: weeks[4], baseline: baselineWeeksFor(weeks, weeks[4]) };
  };

  it('uses the Weekly Review baseline weeks, with weeks without the value counting as 0', () => {
    // Service-001: 4, 0, 0, 2 in the baseline → typical 1.5 (not 3.0); 6 this week.
    const incidents = build([
      many(4, { week: 0, service: 'Service-001' }), many(2, { week: 1, service: 'Service-009' }), many(2, { week: 2, service: 'Service-009' }),
      many(2, { week: 3, service: 'Service-001' }), many(6, { week: 4, service: 'Service-001' }), many(2, { week: 4, service: 'Service-009' }),
    ]);
    const { current, baseline } = weeksOf(incidents);
    expect(baseline).toHaveLength(4);
    const b = bridgeInsight(incidents, everyone, 'service', current, baseline)!;
    expect(b).toEqual({ value: 'Service-001', count: 6, typical: 1.5, change: 4.5 });
    expect(formatChange(b.change)).toBe('+4.5');
  });

  it('ranks by unrounded absolute change; ties by count, then label', () => {
    const incidents = build([
      many(1, { week: 0, service: 'Service-A' }), many(1, { week: 1, service: 'Service-B' }), many(1, { week: 2, service: 'Service-C' }), many(1, { week: 3, service: 'Service-D' }),
      many(3, { week: 4, service: 'Service-C' }), many(3, { week: 4, service: 'Service-B' }),
    ]);
    const { current, baseline } = weeksOf(incidents);
    // B and C: 3 vs 0.25 → +2.75 each, same count → label order picks B.
    expect(bridgeInsight(incidents, everyone, 'service', current, baseline)!.value).toBe('Service-B');
  });

  it('never picks Others, missing or blank values, and is omitted when nothing changed or there is no baseline', () => {
    const blankOnly = build([many(2, { week: 0, service: '' }), many(2, { week: 1, service: ' ' }), many(2, { week: 2, service: '' }), many(2, { week: 3, service: '' }), many(9, { week: 4, service: '' })]);
    const w = weeksOf(blankOnly);
    expect(bridgeInsight(blankOnly, everyone, 'service', w.current, w.baseline)).toBeNull();
    const steady = build([0, 1, 2, 3, 4].map(week => many(2, { week, service: 'Service-001' })));
    const s = weeksOf(steady);
    expect(bridgeInsight(steady, everyone, 'service', s.current, s.baseline)).toBeNull();
    expect(bridgeInsight(steady, everyone, 'service', s.current, [])).toBeNull();
  });

  it('can name a value outside the drawn Top-N but never an aggregate bucket', () => {
    const incidents = build([
      [0, 1, 2, 3].flatMap(week => [...many(5, { week, service: 'Service-001' }), ...many(5, { week, service: 'Service-002' })]),
      [...many(5, { week: 4, service: 'Service-001' }), ...many(5, { week: 4, service: 'Service-002' }), ...many(4, { week: 4, service: 'Service-003' })],
    ]);
    const { current, baseline } = weeksOf(incidents);
    expect(bridgeInsight(incidents, everyone, 'service', current, baseline)!.value).toBe('Service-003');
  });
});
