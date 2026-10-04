import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { annotateIncidents } from '@/lib/problems';
import { availableWeeks } from '@/lib/weekly';
import { weekLabel } from '@/lib/periods';
import { many, syntheticIncident, syntheticScore, type SyntheticIncidentSpec } from '@/test/fixtures/weeklyFixtures';
import WeeklyComposition from './WeeklyComposition';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const ALL = { service: true, serviceOffering: true, assignmentGroup: true };

function renderFor(specs: SyntheticIncidentSpec[][]) {
  const incidents = annotateIncidents(specs.flat().map(syntheticIncident));
  const weeks = availableWeeks(incidents);
  render(
    <WeeklyComposition incidents={incidents} scores={incidents.map(i => syntheticScore(i.Number))}
      weeks={weeks.map(key => ({ key, label: weekLabel(key) }))} selectedWeek={weeks[weeks.length - 1]}
      baselineWeeks={weeks.slice(0, -1)} availability={ALL} />,
  );
}

describe('WeeklyComposition copy', () => {
  it('Case B, no missing Service: single-Service fact and the Offering drill-down line', () => {
    renderFor([many(3, { week: 0, service: 'Service-001', offering: 'Offering-001' }), many(3, { week: 1, service: 'Service-001', offering: 'Offering-002' })]);
    expect(screen.getByTestId('composition-single-service').textContent).toBe('All incidents in view are associated with Service-001.');
    expect(screen.getByTestId('composition-fallback').textContent).toBe('Service does not vary in this view — showing Service Offering.');
    expect(screen.getByText('Incidents per week by Service Offering')).toBeInTheDocument();
  });

  it('Case B with missing Service: counts the incidents without a Service', () => {
    renderFor([many(3, { week: 0, service: 'Service-001', offering: 'Offering-001' }), many(2, { week: 1, service: ' ', offering: 'Offering-002' })]);
    expect(screen.getByTestId('composition-single-service').textContent)
      .toBe('All incidents with a Service in view are associated with Service-001 (2 without Service).');
  });

  it('Case D: says Handling Group is shown', () => {
    renderFor([many(2, { week: 0, offering: 'Offering-001', group: 'AG-001' }), many(2, { week: 1, offering: 'Offering-001', group: 'AG-002' })]);
    expect(screen.getByTestId('composition-fallback').textContent).toContain('showing Handling Group');
    expect(screen.getByText('Incidents per week by Handling Group')).toBeInTheDocument();
  });

  it('Case E: a factual note instead of a chart', () => {
    renderFor([many(2, { week: 0, offering: 'Offering-001' }), many(2, { week: 1, offering: 'Offering-001' })]);
    expect(screen.getByTestId('composition-empty').textContent).toBe('No operational dimension varies enough in this view to show weekly composition.');
    expect(screen.queryByTestId('composition-legend')).toBeNull();
  });

  it('legend order: Top-N by window volume, then Others, then the missing bucket, with distinct reserved styles', () => {
    renderFor([
      [...many(5, { week: 0, service: 'Service-001' }), ...many(4, { week: 0, service: 'Service-002' }), ...many(1, { week: 0, service: 'Service-003' })],
      [...many(3, { week: 1, service: 'Service-004' }), ...many(2, { week: 1, service: 'Service-005' }), ...many(2, { week: 1, service: 'Service-006' }), ...many(2, { week: 1, service: 'Service-007' }), ...many(2, { week: 1, service: '' })],
    ]);
    const items = [...screen.getByTestId('composition-legend').querySelectorAll('li')];
    expect(items.map(li => li.getAttribute('data-kind'))).toEqual(['value', 'value', 'value', 'value', 'value', 'value', 'others', 'missing']);
    expect(items.slice(0, 6).map(li => li.textContent)).toEqual(['Service-001', 'Service-002', 'Service-004', 'Service-005', 'Service-006', 'Service-007']);
    expect(items[6].textContent).toBe('Others');
    expect(items[7].textContent).toBe('No Service');
    expect(items[6].innerHTML).not.toBe(items[7].innerHTML);
  });
});
