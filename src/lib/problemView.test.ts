import { describe, it, expect } from 'vitest';
import { ALL_VALUES, filterByMonths, filterIncidents, filterVisibleProblems, toggleSelectionMissing, toggleSelectionValue } from './problemView';
import type { ProblemCluster } from './problems';

const problem = (id: string, title: string, category: string, rcaCoverage: number) =>
  ({ id, title, category, rcaCoverage }) as ProblemCluster;

describe('filterByMonths', () => {
  it('keeps incidents opened in a selected month', () => {
    const incidents = [
      { Opened: '2026-01-31 23:59:59' }, { Opened: '2026-02-01 00:00:00' }, { Opened: '' },
    ];
    expect(filterByMonths(incidents, ['2026-02'])).toEqual([{ Opened: '2026-02-01 00:00:00' }]);
    expect(filterByMonths(incidents, ['2026-01', '2026-02'])).toHaveLength(2);
    expect(filterByMonths(incidents, [])).toEqual([]);
  });
});

describe('filterVisibleProblems', () => {
  const problems = [
    problem('p-0', 'VPN drops', 'Network', 20),
    problem('p-1', 'Printer offline', 'Hardware', 80),
    problem('p-2', 'Mailbox full', 'Email', 50),
  ];

  it('returns every problem with no filters', () => {
    expect(filterVisibleProblems(problems, { search: '', category: 'all', onlyUndocumented: false })).toEqual(problems);
  });

  it('filters by category, undocumented coverage and search over title or category', () => {
    const ids = (f: Parameters<typeof filterVisibleProblems>[1]) => filterVisibleProblems(problems, f).map(p => p.id);
    expect(ids({ search: '', category: 'Hardware', onlyUndocumented: false })).toEqual(['p-1']);
    expect(ids({ search: '', category: 'all', onlyUndocumented: true })).toEqual(['p-0']);
    expect(ids({ search: '  PRINTER ', category: 'all', onlyUndocumented: false })).toEqual(['p-1']);
    expect(ids({ search: 'email', category: 'all', onlyUndocumented: false })).toEqual(['p-2']);
  });
});

describe('filterIncidents', () => {
  const inc = (Opened: string, Service?: string, offering?: string) => ({
    Opened,
    extraFields: {
      ...(Service !== undefined ? { Service } : {}),
      ...(offering !== undefined ? { 'Service offering': offering } : {}),
    },
  });
  const incidents = [
    inc('2026-01-05 09:00:00', 'Service-A', 'Offering-1'),
    inc('2026-01-06 09:00:00', 'Service-B', 'Offering-1'),
    inc('2026-02-01 09:00:00', 'Service-A', ''),
    inc('2026-02-02 09:00:00', '', 'Offering-2'),
    inc('', 'Service-A', 'Offering-2'),
  ];
  const none = { values: [], includeMissing: false };

  it('returns the very same array when no filter is active', () => {
    expect(filterIncidents(incidents, { months: [], services: none, serviceOfferings: none })).toBe(incidents);
  });

  it('applies months exactly like filterByMonths', () => {
    const months = ['2026-02'];
    expect(filterIncidents(incidents, { months, services: none, serviceOfferings: none })).toEqual(filterByMonths(incidents, months));
  });

  it('keeps selected values, and no-value incidents only when asked', () => {
    const f = (services: typeof none, serviceOfferings = none, months: string[] = []) =>
      filterIncidents(incidents, { months, services, serviceOfferings }).map(i => incidents.indexOf(i));
    expect(f({ values: ['Service-A'], includeMissing: false })).toEqual([0, 2, 4]);
    expect(f({ values: [], includeMissing: true })).toEqual([3]);
    expect(f({ values: ['Service-B'], includeMissing: true })).toEqual([1, 3]);
    expect(f(none, { values: [], includeMissing: true })).toEqual([2]);
  });

  it('intersects month, Service and Service offering', () => {
    const result = filterIncidents(incidents, {
      months: ['2026-01', '2026-02'],
      services: { values: ['Service-A'], includeMissing: false },
      serviceOfferings: { values: ['Offering-1', 'Offering-2'], includeMissing: false },
    });
    expect(result.map(i => incidents.indexOf(i))).toEqual([0]);
  });

  it('returns an empty population, not an error, when nothing matches', () => {
    expect(filterIncidents(incidents, { months: ['2025-12'], services: { values: ['Service-A'], includeMissing: false }, serviceOfferings: none })).toEqual([]);
  });

  it('never mutates incidents', () => {
    const before = structuredClone(incidents);
    filterIncidents(incidents, { months: ['2026-01'], services: { values: ['Service-A'], includeMissing: true }, serviceOfferings: none });
    expect(incidents).toEqual(before);
  });
});

describe('toggleSelectionValue / toggleSelectionMissing', () => {
  it('adds an absent value and removes a present one, keeping the rest of the selection', () => {
    expect(toggleSelectionValue(ALL_VALUES, 'Service-A')).toEqual({ values: ['Service-A'], includeMissing: false });
    expect(toggleSelectionValue({ values: ['Service-A', 'Service-B'], includeMissing: true }, 'Service-A')).toEqual({ values: ['Service-B'], includeMissing: true });
    expect(toggleSelectionValue({ values: ['Service-A'], includeMissing: false }, 'Service-B')).toEqual({ values: ['Service-A', 'Service-B'], includeMissing: false });
  });

  it('toggles the missing-value option without touching the values', () => {
    expect(toggleSelectionMissing({ values: ['Service-A'], includeMissing: false })).toEqual({ values: ['Service-A'], includeMissing: true });
    expect(toggleSelectionMissing({ values: [], includeMissing: true })).toEqual(ALL_VALUES);
  });

  it('never mutates the input selection', () => {
    const selection = { values: ['Service-A'], includeMissing: false };
    toggleSelectionValue(selection, 'Service-B');
    toggleSelectionMissing(selection);
    expect(selection).toEqual({ values: ['Service-A'], includeMissing: false });
  });
});
