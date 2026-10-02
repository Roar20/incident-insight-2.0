import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { dimensionTable } from '@/lib/serviceDimension';
import { ALL_VALUES } from '@/lib/problemView';
import ServiceRankingChart from './ServiceRankingChart';

const noop = () => {};

describe('ServiceRankingChart', () => {
  it('shows NOT_AVAILABLE, not an empty chart, when the file has no Service column', () => {
    const table = dimensionTable([{ Opened: '2026-01-10 09:00:00', 'Assignment group': 'AG-1', clusterId: 'p-0', extraFields: {} }], 'service', new Set());
    render(<ServiceRankingChart table={table} available={false} selection={ALL_VALUES} onSelectionChange={noop} />);
    expect(screen.getByText(/no Service column, so the Service ranking is not available/)).toBeInTheDocument();
    expect(screen.queryByTestId('service-ranking-chart')).toBeNull();
  });

  it('shows the empty state, not an empty chart, when no incident is visible', () => {
    render(<ServiceRankingChart table={dimensionTable([], 'service', new Set())} available selection={ALL_VALUES} onSelectionChange={noop} />);
    expect(screen.getByText('No results for the current filters.')).toBeInTheDocument();
    expect(screen.queryByTestId('service-ranking-chart')).toBeNull();
  });
});
