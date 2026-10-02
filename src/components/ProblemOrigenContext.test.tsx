import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProblemOrigenDetail, ProblemOrigenLine } from './ProblemOrigenContext';
import { candidateOrigenContext } from '@/lib/serviceDimension';

const members = (rows: { s?: string; o?: string; ag?: string }[]) => rows.map(({ s, o, ag = 'AG-1' }) => ({
  Opened: '2026-01-10 09:00:00',
  'Assignment group': ag,
  clusterId: 'p-0',
  extraFields: { ...(s !== undefined ? { Service: s } : {}), ...(o !== undefined ? { 'Service offering': o } : {}) },
}));
const both = { service: true, serviceOffering: true };

describe('ProblemOrigenLine', () => {
  it('shows the top Service, its share of incidents with a Service, N Services and groups', () => {
    const ctx = candidateOrigenContext(members([{ s: 'Service-A' }, { s: 'Service-A' }, { s: 'Service-B', ag: 'AG-2' }]), 3, both);
    render(<ProblemOrigenLine context={ctx} />);
    expect(screen.getByText('Top Service: Service-A · 67% of 3 with a Service · 2 Services · 2 groups')).toBeInTheDocument();
    expect(screen.queryByText(/visible with the current filters/)).toBeNull();
  });

  it('reports a tie instead of picking one Service', () => {
    const ctx = candidateOrigenContext(members([{ s: 'Service-B' }, { s: 'Service-A' }]), 2, both);
    render(<ProblemOrigenLine context={ctx} />);
    expect(screen.getByText(/^Tied top Services: Service-A, Service-B · 50% each of 2 with a Service · 2 Services/)).toBeInTheDocument();
  });

  it('says when no incident has a Service, and never shows "No Service" as a top Service', () => {
    const ctx = candidateOrigenContext(members([{ s: '' }, { s: '' }]), 2, both);
    render(<ProblemOrigenLine context={ctx} />);
    expect(screen.getByText('No Service recorded · 1 group')).toBeInTheDocument();
  });

  it('shows "N of M" only when filters hide part of the problem', () => {
    const ctx = candidateOrigenContext(members([{ s: 'Service-A' }, { s: 'Service-A' }]), 40, both);
    render(<ProblemOrigenLine context={ctx} />);
    expect(screen.getByText('2 of 40 incidents of this problem visible with the current filters')).toBeInTheDocument();
  });

  it('omits Service wording when the file has no Service column', () => {
    const ctx = candidateOrigenContext(members([{}]), 1, { service: false, serviceOffering: false });
    render(<ProblemOrigenLine context={ctx} />);
    expect(screen.getByText('1 group')).toBeInTheDocument();
  });
});

describe('ProblemOrigenDetail', () => {
  it('lists Services and Offerings with their missing rows, and the groups handling each Service', () => {
    const ctx = candidateOrigenContext(members([
      { s: 'Service-A', o: 'Offering-1', ag: 'AG-1' }, { s: 'Service-A', o: '', ag: 'AG-2' }, { s: '', o: 'Offering-1', ag: '' },
    ]), 3, both);
    render(<ProblemOrigenDetail context={ctx} />);
    expect(screen.getByText('Services (1)')).toBeInTheDocument();
    expect(screen.getByText('Offerings (1)')).toBeInTheDocument();
    expect(screen.getByText('No Service')).toBeInTheDocument();
    expect(screen.getByText('No Offering')).toBeInTheDocument();
    expect(screen.getByText(/appear in 2 Assignment Groups/)).toBeInTheDocument();
    expect(screen.getByText('No assignment group · 1')).toBeInTheDocument();
  });
});
