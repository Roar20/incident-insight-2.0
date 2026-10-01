import { describe, it, expect } from 'vitest';
import { filterByMonths, filterVisibleProblems } from './problemView';
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
