import { describe, it, expect } from 'vitest';
import {
  candidateOrigenContext, clusterSizes, crossTab, dimensionOptions, dimensionTable, facetCounts, fraction,
  membersByCluster, monthlySeries, pairTable, topWithOthers,
} from './serviceDimension';
import { ALL_VALUES } from './problemView';

interface Row { s?: string; o?: string; ag?: string; m?: string; c?: string }
/** Minimal incidents: only the fields Origen reads. Values are synthetic. */
const make = (rows: Row[]) => rows.map(({ s, o, ag = 'AG-1', m = '2026-01', c = 'p-0' }) => ({
  Opened: m ? `${m}-10 09:00:00` : '',
  'Assignment group': ag,
  clusterId: c,
  extraFields: { ...(s !== undefined ? { Service: s } : {}), ...(o !== undefined ? { 'Service offering': o } : {}) },
}));

const INCIDENTS = make([
  { s: 'Service-A', o: 'Offering-1', ag: 'AG-1', c: 'p-0' },
  { s: 'Service-A', o: 'Offering-1', ag: 'AG-2', c: 'p-0' },
  { s: 'Service-A', o: '', ag: 'AG-2', c: 'p-1', m: '2026-02' },
  { s: 'Service-B', o: 'Offering-1', ag: 'AG-1', c: 'p-1', m: '2026-02' },
  { s: '', o: 'Offering-2', ag: '', c: 'p-1' },
  { s: '  ', o: 'Offering-2', ag: 'AG-3', c: 'solo-9', m: '' },
]);

describe('dimensionTable', () => {
  const table = dimensionTable(INCIDENTS, 'service', new Set(['p-0', 'p-1']));

  it('ranks known Services and keeps the no-value row apart', () => {
    expect(table.rows.map(r => [r.value, r.incidents])).toEqual([['Service-A', 3], ['Service-B', 1]]);
    expect(table.missing).toMatchObject({ value: null, incidents: 2 });
    expect(table.visible).toBe(6);
    expect(table.withValue).toBe(4);
    expect(table.coverage).toBeCloseTo(4 / 6);
  });

  it('computes shares over every visible incident, so rows and the no-value row sum to 1', () => {
    const total = [...table.rows, table.missing!].reduce((a, r) => a + r.shareOfVisible!, 0);
    expect(total).toBeCloseTo(1);
    expect(table.rows[0].shareOfVisible).toBeCloseTo(3 / 6);
  });

  it('counts only known values as distinct, and candidates among the listed problems', () => {
    const a = table.rows[0];
    expect(a.distinctAssignmentGroups).toBe(2);
    expect(a.distinctServiceOfferings).toBe(1); // the blank offering does not count
    expect(a.candidates).toBe(2);
    expect(table.missing!.distinctAssignmentGroups).toBe(1); // blank AG does not count
    expect(table.missing!.candidates).toBe(1); // solo-9 is not a listed problem
  });

  it('works the same for Service offering, counting distinct Services', () => {
    const t = dimensionTable(INCIDENTS, 'serviceOffering', new Set());
    expect(t.rows.map(r => [r.value, r.incidents, r.distinctServices])).toEqual([['Offering-1', 3, 2], ['Offering-2', 2, 0]]);
    expect(t.missing?.incidents).toBe(1);
  });

  it('reports an empty population with null shares and coverage, not zeros', () => {
    const t = dimensionTable([], 'service', new Set());
    expect(t).toEqual({ rows: [], missing: null, visible: 0, withValue: 0, coverage: null });
  });
});

describe('crossTab and pairTable', () => {
  it('builds Service × Assignment group counts with no-value rows and columns last', () => {
    const t = crossTab(INCIDENTS, 'service', 'assignmentGroup');
    expect(t.rows.map(r => r.value)).toEqual(['Service-A', 'Service-B', null]);
    expect(t.columns.map(c => c.value)).toEqual(['AG-1', 'AG-2', 'AG-3', null]);
    expect(t.rows[0].cells.get('AG-2')).toBe(2);
    const sum = t.rows.reduce((a, r) => a + [...r.cells.values()].reduce((x, y) => x + y, 0), 0);
    expect(sum).toBe(t.total);
  });

  it('separates complete Service × Offering pairs from pairs missing a side', () => {
    const t = pairTable(INCIDENTS, 'service', 'serviceOffering', new Set(['p-0', 'p-1']));
    expect(t.pairs.map(p => [p.left, p.right, p.incidents])).toEqual([['Service-A', 'Offering-1', 2], ['Service-B', 'Offering-1', 1]]);
    expect(t.partial.map(p => [p.left, p.right, p.incidents])).toEqual([[null, 'Offering-2', 2], ['Service-A', null, 1]]);
    expect([...t.pairs, ...t.partial].reduce((a, p) => a + p.incidents, 0)).toBe(INCIDENTS.length);
  });
});

describe('monthlySeries', () => {
  it('counts per month on the given axis, with real zeros and undated incidents apart', () => {
    const s = monthlySeries(INCIDENTS, 'service', ['2026-01', '2026-02', '2026-03']);
    expect(s.series.map(x => [x.value, x.counts])).toEqual([
      ['Service-A', [2, 1, 0]], ['Service-B', [0, 1, 0]], [null, [1, 0, 0]],
    ]);
    expect(s.monthTotals).toEqual([3, 2, 0]);
    expect(s.undated).toBe(1);
  });
});

describe('topWithOthers', () => {
  it('shows the first entries and summarises the rest without changing them', () => {
    const ranked = [{ incidents: 5 }, { incidents: 3 }, { incidents: 2 }, { incidents: 1 }];
    expect(topWithOthers(ranked, 2)).toEqual({ shown: ranked.slice(0, 2), others: { entries: 2, incidents: 3 } });
    expect(topWithOthers(ranked, 10)).toEqual({ shown: ranked, others: null });
  });
});

describe('candidateOrigenContext', () => {
  const all = { service: true, serviceOffering: true };

  it('reports the top Service with its share of incidents that have a Service', () => {
    const members = make([{ s: 'Service-A' }, { s: 'Service-A' }, { s: 'Service-B' }, { s: '' }]);
    const ctx = candidateOrigenContext(members, 10, all);
    expect(ctx.topService).toEqual({ state: 'SINGLE', service: 'Service-A', count: 2, share: 2 / 3 });
    expect(ctx.serviceCount).toBe(2);
    expect(ctx.knownServiceCount).toBe(3);
    expect(ctx.missingService).toBe(1);
    expect([ctx.visibleCount, ctx.totalCount]).toEqual([4, 10]);
  });

  it('reports a tie without picking a Service', () => {
    const members = make([{ s: 'Service-B' }, { s: 'Service-A' }, { s: 'Service-A' }, { s: 'Service-B' }, { s: 'Service-C' }]);
    expect(candidateOrigenContext(members, 5, all).topService).toEqual({ state: 'TIE', services: ['Service-A', 'Service-B'], count: 2, share: 2 / 5 });
  });

  it('never makes "no Service" the top Service or a counted Service', () => {
    const members = make([{ s: '' }, { s: '' }, { s: '' }, { s: 'Service-A' }]);
    const ctx = candidateOrigenContext(members, 4, all);
    expect(ctx.topService).toMatchObject({ state: 'SINGLE', service: 'Service-A', share: 1 });
    expect(ctx.serviceCount).toBe(1);
    expect(candidateOrigenContext(make([{ s: '' }]), 1, all).topService).toEqual({ state: 'NO_KNOWN_SERVICE' });
  });

  it('distinguishes a file without the Service column', () => {
    const ctx = candidateOrigenContext(make([{}]), 1, { service: false, serviceOffering: false });
    expect(ctx.topService).toEqual({ state: 'NOT_AVAILABLE' });
    expect(ctx.offerings).toBeNull();
  });

  it('does not let Offering or Assignment group change N Services', () => {
    const a = candidateOrigenContext(make([{ s: 'Service-A', o: 'Offering-1', ag: 'AG-1' }, { s: 'Service-A', o: 'Offering-2', ag: 'AG-2' }]), 2, all);
    expect(a.serviceCount).toBe(1);
    expect(a.distinctAssignmentGroups).toBe(2);
    expect(a.offerings).toEqual([{ value: 'Offering-1', count: 1 }, { value: 'Offering-2', count: 1 }]);
  });
});

describe('cluster membership helpers', () => {
  it('counts full membership and groups visible members by clusterId', () => {
    expect(clusterSizes(INCIDENTS)).toEqual(new Map([['p-0', 2], ['p-1', 3], ['solo-9', 1]]));
    expect([...membersByCluster(INCIDENTS.slice(0, 3)).entries()].map(([k, v]) => [k, v.length])).toEqual([['p-0', 2], ['p-1', 1]]);
  });
});

describe('filter options and facet counts', () => {
  it('lists every known value of the file and whether a no-value option exists', () => {
    expect(dimensionOptions(INCIDENTS, 'service')).toEqual({ values: ['Service-A', 'Service-B'], hasMissing: true });
    expect(dimensionOptions(INCIDENTS, 'serviceOffering')).toEqual({ values: ['Offering-1', 'Offering-2'], hasMissing: true });
  });

  it('counts options under the other filters but never under their own selection', () => {
    const filters = { months: ['2026-01'], services: { values: ['Service-B'], includeMissing: false }, serviceOfferings: ALL_VALUES };
    // Service counts ignore the Service selection itself: January only.
    const svc = facetCounts(INCIDENTS, filters, 'service');
    expect(svc.values).toEqual(new Map([['Service-A', 2]]));
    expect(svc.missing).toBe(1);
    // Offering counts apply the Service selection and the month.
    const off = facetCounts(INCIDENTS, filters, 'serviceOffering');
    expect(off.values).toEqual(new Map());
    expect(off.missing).toBe(0);
  });
});

describe('fraction', () => {
  it('is null for an empty whole', () => {
    expect(fraction(0, 0)).toBeNull();
    expect(fraction(1, 4)).toBe(0.25);
  });
});
