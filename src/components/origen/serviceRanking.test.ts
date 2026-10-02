import { describe, it, expect } from 'vitest';
import { dimensionTable } from '@/lib/serviceDimension';
import { ALL_VALUES, filterIncidents, type GlobalFilters } from '@/lib/problemView';
import { ORIGEN_DISPLAY } from '@/config/display';
import { MISSING_KEY, OTHERS_KEY, selectionAfterBarClick, serviceRanking } from './serviceRanking';

/** Synthetic incidents: `counts[i]` incidents for "Service-i", plus `missing` with no Service. */
function make(counts: Record<string, number>, missing = 0, month = '2026-01') {
  const rows: { Opened: string; 'Assignment group': string; clusterId: string; extraFields: Record<string, string> }[] = [];
  for (const [service, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) rows.push({ Opened: `${month}-10 09:00:00`, 'Assignment group': 'AG-1', clusterId: 'p-0', extraFields: { Service: service } });
  }
  for (let i = 0; i < missing; i++) rows.push({ Opened: `${month}-10 09:00:00`, 'Assignment group': 'AG-1', clusterId: 'p-0', extraFields: { Service: '' } });
  return rows;
}
const table = (incidents: ReturnType<typeof make>) => dimensionTable(incidents, 'service', new Set());
const sum = (bars: { incidents: number }[]) => bars.reduce((a, b) => a + b.incidents, 0);

describe('serviceRanking', () => {
  const incidents = make({ 'Service-A': 7, 'Service-B': 3, 'Service-C': 5, 'Service-D': 1, 'Service-E': 2 }, 4);
  const t = table(incidents);

  it('closes: Top N + Others + No Service = visible incidents', () => {
    for (const limit of [1, 2, 3, 5, 10]) {
      const { bars, visible } = serviceRanking(t, limit);
      expect(sum(bars)).toBe(visible);
      expect(visible).toBe(incidents.length);
    }
  });

  it('draws exactly the By Service table counts and shares, in the table order', () => {
    const { bars } = serviceRanking(t, 10);
    const services = bars.filter(b => b.kind === 'service');
    expect(services.map(b => [b.service, b.incidents, b.shareOfVisible])).toEqual(t.rows.map(r => [r.value, r.incidents, r.shareOfVisible]));
    expect(services.map(b => b.incidents)).toEqual([7, 5, 3, 2, 1]);
    expect(services[0].shareOfVisible).toBeCloseTo(7 / 22);
  });

  it('keeps No Service separate: last, never ranked, never inside Others', () => {
    const { bars } = serviceRanking(t, 2);
    expect(bars.map(b => b.key)).toEqual(['Service-A', 'Service-C', OTHERS_KEY, MISSING_KEY]);
    const missing = bars.at(-1)!;
    expect(missing).toMatchObject({ kind: 'missing', service: null, incidents: 4 });
    expect(missing.shareOfVisible).toBeCloseTo(4 / 22);
    expect(bars.find(b => b.kind === 'others')!.incidents).toBe(3 + 2 + 1);
  });

  it('shows Others only when Services exceed the limit; its share uses the same denominator', () => {
    expect(serviceRanking(t, 5).bars.some(b => b.kind === 'others')).toBe(false);
    const others = serviceRanking(t, 3).bars.find(b => b.kind === 'others')!;
    expect(others).toMatchObject({ entries: 2, incidents: 3 });
    expect(others.shareOfVisible).toBeCloseTo(3 / 22);
  });

  it('has no No Service bar when every incident has a Service', () => {
    expect(serviceRanking(table(make({ 'Service-A': 2 })), 10).bars.map(b => b.kind)).toEqual(['service']);
  });

  it('is empty for an empty population', () => {
    expect(serviceRanking(table([]), 10)).toEqual({ bars: [], visible: 0 });
  });

  it('breaks exact-count ties the way the By Service table does (name order), whatever the input order', () => {
    const a = serviceRanking(table(make({ 'Service-Z': 2, 'Service-M': 2, 'Service-B': 2, 'Service-Q': 5 })), 10);
    const b = serviceRanking(table(make({ 'Service-B': 2, 'Service-Q': 5, 'Service-Z': 2, 'Service-M': 2 })), 10);
    expect(a.bars.map(x => x.key)).toEqual(['Service-Q', 'Service-B', 'Service-M', 'Service-Z']);
    expect(b.bars.map(x => x.key)).toEqual(a.bars.map(x => x.key));
  });

  it('follows the visible population under every filter combination', () => {
    const all = [...make({ 'Service-A': 3, 'Service-B': 2 }, 1, '2026-01'), ...make({ 'Service-A': 1, 'Service-C': 4 }, 2, '2026-02')];
    const combos: GlobalFilters[] = [
      { months: [], services: ALL_VALUES, serviceOfferings: ALL_VALUES },
      { months: ['2026-02'], services: ALL_VALUES, serviceOfferings: ALL_VALUES },
      { months: [], services: { values: ['Service-A'], includeMissing: true }, serviceOfferings: ALL_VALUES },
      { months: ['2026-01'], services: { values: ['Service-A', 'Service-C'], includeMissing: false }, serviceOfferings: ALL_VALUES },
    ];
    for (const f of combos) {
      const visible = filterIncidents(all, f);
      const { bars } = serviceRanking(table(visible), 1);
      expect(sum(bars)).toBe(visible.length);
    }
    const feb = serviceRanking(table(filterIncidents(all, combos[1])), 10);
    expect(feb.bars.map(b => [b.key, b.incidents])).toEqual([['Service-C', 4], ['Service-A', 1], [MISSING_KEY, 2]]);
  });

  it('uses the versioned display limit', () => {
    expect(ORIGEN_DISPLAY.rankingChartServices).toBe(10);
  });
});

describe('selectionAfterBarClick', () => {
  const { bars } = serviceRanking(table(make({ 'Service-A': 3, 'Service-B': 2, 'Service-C': 1 }, 1)), 2);
  const [a, b] = bars;
  const others = bars.find(x => x.kind === 'others')!;
  const missing = bars.find(x => x.kind === 'missing')!;

  it('selects an unselected Service, as the Service filter does', () => {
    expect(selectionAfterBarClick(a, ALL_VALUES)).toEqual({ values: ['Service-A'], includeMissing: false });
  });

  it('removes a selected Service, as the Service filter does', () => {
    expect(selectionAfterBarClick(a, { values: ['Service-A'], includeMissing: false })).toEqual(ALL_VALUES);
  });

  it('keeps multi-select: adds or removes one Service and leaves the rest of the selection alone', () => {
    const multi = { values: ['Service-A', 'Service-B'], includeMissing: true };
    expect(selectionAfterBarClick(a, multi)).toEqual({ values: ['Service-B'], includeMissing: true });
    expect(selectionAfterBarClick(b, { values: ['Service-A'], includeMissing: false })).toEqual({ values: ['Service-A', 'Service-B'], includeMissing: false });
  });

  it('toggles the existing No Service option and never selects Others', () => {
    expect(selectionAfterBarClick(missing, ALL_VALUES)).toEqual({ values: [], includeMissing: true });
    expect(selectionAfterBarClick(missing, { values: ['Service-A'], includeMissing: true })).toEqual({ values: ['Service-A'], includeMissing: false });
    expect(selectionAfterBarClick(others, { values: ['Service-A'], includeMissing: false })).toBeNull();
  });
});
