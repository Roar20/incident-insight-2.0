import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { enrichRow, inferDateOrder, readIncidentTable, type IncidentRow } from '@/lib/parser';
import { scoreIncident } from '@/lib/scorer';
import { annotateIncidents, computeProblemClusters } from '@/lib/problems';
import { computeOverview } from '@/lib/analytics';
import { dimensionAvailability } from '@/lib/dimensions';
import { dimensionTable } from '@/lib/serviceDimension';
import { ALL_VALUES, filterIncidents, type GlobalFilters } from '@/lib/problemView';
import { patternBreadth, topShare } from '@/lib/executiveSummary';
import { EXECUTIVE_CAVEATS } from '@/config/executiveSummary';
import { toXlsxBuffer } from '@/test/fixtures/syntheticDatasets';
import { alertLikeRows, ticketLikeRows } from '@/test/fixtures/executiveFixtures';
import ExecutiveSummaryPage from './ExecutiveSummaryPage';

const NO_FILTERS: GlobalFilters = { months: [], services: ALL_VALUES, serviceOfferings: ALL_VALUES };

/**
 * The real ingestion → scoring → clustering path, as the worker runs it, over
 * synthetic rows; filters narrow the population and problems regroup by the
 * existing clusterId, exactly as AppContext does.
 */
function contextFor(rows: IncidentRow[], filters: GlobalFilters = NO_FILTERS) {
  const { rows: parsed, columns } = readIncidentTable(toXlsxBuffer(rows));
  const order = inferDateOrder(parsed);
  const enriched = parsed.map(r => enrichRow(r, { dateOrder: order }));
  const allScores = enriched.map(scoreIncident);
  const all = annotateIncidents(enriched);
  const incidents = filterIncidents(all, filters);
  const numbers = new Set(incidents.map(i => i.Number));
  const scores = allScores.filter(s => numbers.has(s.number));
  return {
    filteredIncidents: incidents,
    filteredScores: scores,
    filteredOverview: computeOverview(incidents, scores),
    filteredProblems: computeProblemClusters(incidents, scores),
    dimensionAvailability: dimensionAvailability(columns),
    sourceColumns: columns,
    setCurrentPage: vi.fn(),
    // GlobalFilters reads these; no month options keeps the month filter hidden.
    incidents: all, availableMonths: [], selectedMonths: filters.months, setSelectedMonths: vi.fn(),
    globalFilters: filters, serviceSelection: filters.services, offeringSelection: filters.serviceOfferings,
    setServiceSelection: vi.fn(), setOfferingSelection: vi.fn(), isDimensionFilterActive: false, clearDimensionFilters: vi.fn(),
  };
}

let ctx: ReturnType<typeof contextFor>;
vi.mock('@/context/AppContext', () => ({ useAppContext: () => ctx }));

const renderPage = () => render(<TooltipProvider><ExecutiveSummaryPage /></TooltipProvider>);
// "ownership" appears only in the approved negation "not team performance or ownership".
const FORBIDDEN = /caused by|triggered by|confirmed problem|\bowner\b|responsible|poor performing|upstream failure/i;
const ids = () => new Set(ctx.filteredProblems.map(p => p.id));
const text = (testId: string) => screen.getByTestId(testId).textContent ?? '';

describe('alert-like population (several Handling Groups)', () => {
  beforeEach(() => { ctx = contextFor(alertLikeRows()); });

  it('ranks Handling Groups with the same numbers as Origen’s dimension table', () => {
    renderPage();
    const table = dimensionTable(ctx.filteredIncidents, 'assignmentGroup', ids());
    const bars = within(screen.getByTestId('look-bars'));
    for (const row of table.rows.slice(0, 3)) {
      expect(bars.getByText(row.value as string).closest('[data-kind]')).toHaveAttribute('title', expect.stringContaining(`: ${row.incidents} incidents`));
    }
    expect(bars.getByText(`Others (${table.rows.length - 3})`)).toBeInTheDocument();
    expect(text('executive-headline')).toMatch(new RegExp(`handled by 3 of ${table.rows.length} Handling Groups`));
  });

  it('Evidence: concentration reconciles with the main section and Origen', () => {
    renderPage();
    const table = dimensionTable(ctx.filteredIncidents, 'assignmentGroup', ids());
    const top = topShare(table, 3);
    expect(text('evidence-concentration-value')).toBe(`3 of ${table.rows.length} Handling Groups`);
    expect(text('evidence-operational-concentration')).toContain(`${top.incidents} of ${ctx.filteredIncidents.length} incidents`);
    expect(text('executive-snapshot')).toContain(`handled by 3 of ${table.rows.length} Handling Groups`);
  });

  it('Evidence: recurring patterns use the existing largest clusterId and blank-free breadth', () => {
    renderPage();
    const largest = ctx.filteredProblems[0];
    const breadth = patternBreadth(ctx.filteredIncidents, largest.id);
    expect(text('evidence-recurring-value')).toBe(`Largest pattern: ${largest.count} incidents`);
    expect(text('evidence-recurring-patterns')).toContain(`spans ${breadth.services} Services / ${breadth.serviceOfferings} Offerings / ${breadth.assignmentGroups} Handling Groups`);
    expect(text('pattern-breadth')).toContain(`It spans ${breadth.services} Services`);
    expect(within(screen.getByTestId('evidence-recurring-patterns')).getByText('Directional')).toBeInTheDocument();
  });

  it('Evidence: origin counts equal Origen, with "without Service" kept apart from Others', () => {
    renderPage();
    const service = dimensionTable(ctx.filteredIncidents, 'service', ids());
    const offering = dimensionTable(ctx.filteredIncidents, 'serviceOffering', ids());
    expect(text('evidence-origin-value')).toBe(`${service.rows.length} Services · ${offering.rows.length} Offerings`);
    expect(service.missing?.incidents).toBeGreaterThan(0);
    expect(text('evidence-operational-origin')).toContain(`${service.missing!.incidents} without Service`);
    expect(text('evidence-operational-origin')).not.toContain('without Offering');
    expect(within(screen.getByTestId('origin-bars')).getByText('No Service').closest('[data-kind]')).toHaveAttribute('data-kind', 'missing');
  });

  it('Evidence: documentation counts are the filtered Overview counts, Directional, with the approved caveat', () => {
    renderPage();
    const o = ctx.filteredOverview;
    expect(text('evidence-documentation-value')).toContain(`${o.excellent + o.good} Good or Excellent`);
    expect(text('evidence-documentation-readiness')).toContain(`${o.noRootCause} without documented diagnosis`);
    expect(text('evidence-documentation-readiness')).toContain(EXECUTIVE_CAVEATS.documentation);
  });

  it('Service performance: a mixed SLA flag shows the factual breach share; the median stays in Evidence', () => {
    renderPage();
    expect(text('evidence-sla-value')).toMatch(/^SLA breached: \d+% of \d+ tracked closed incidents$/);
    expect(text('evidence-median-value')).toMatch(/^Median open → close: /);
    expect(text('executive-snapshot')).not.toMatch(/median/i);
    expect(text('evidence-service-performance')).toContain(EXECUTIVE_CAVEATS.servicePerformance);
  });

  it('a month filter narrows the main insights and Evidence together', () => {
    ctx = contextFor(alertLikeRows(), { ...NO_FILTERS, months: ['2026-01'] });
    renderPage();
    const visible = ctx.filteredIncidents.length;
    expect(visible).toBeGreaterThan(0);
    expect(visible).toBeLessThan(120);
    const top = topShare(dimensionTable(ctx.filteredIncidents, 'assignmentGroup', ids()), 3);
    expect(text('evidence-operational-concentration')).toContain(`${top.incidents} of ${visible} incidents`);
    expect(screen.getByTestId('executive-snapshot').querySelector('.font-mono')!.textContent).toBe(String(visible));
  });

  it('methodology is collapsed by default and holds metrics, lineage and notes', () => {
    renderPage();
    expect(screen.queryByTestId('operational-metrics')).toBeNull();
    fireEvent.click(screen.getByText(/View methodology & limitations/));
    expect(screen.getByTestId('operational-metrics')).toBeInTheDocument();
    expect(screen.getByTestId('interpretation-notes').textContent).toContain(EXECUTIVE_CAVEATS.servicePerformance);
    const origin = screen.getByTestId('insight-lineage').querySelector('[data-statement="Operational origin"]')!;
    expect(within(origin as HTMLElement).getByText('Validated')).toBeInTheDocument();
  });

  it('the default surface has no discovery or capability content', () => {
    renderPage();
    fireEvent.click(screen.getByText(/View methodology & limitations/));
    const page = text('executive-summary');
    expect(screen.queryByTestId('discovery-questions')).toBeNull();
    expect(page).not.toMatch(/Needs definition|nothing is computed yet|by sponsor question|What appears connected|Questions to unlock/);
    expect(page).not.toMatch(FORBIDDEN);
  });

  it('keeps application context unavailable', () => {
    renderPage();
    expect(screen.getByText('Not available — no approved extractor.')).toBeInTheDocument();
  });
});

describe('ticket-like population (one Handling Group)', () => {
  beforeEach(() => { ctx = contextFor(ticketLikeRows()); });

  it('falls back to Service, and the Evidence follows the same fallback', () => {
    renderPage();
    const service = dimensionTable(ctx.filteredIncidents, 'service', ids());
    expect(screen.getByText('One Handling Group handles every incident in view, so this view uses Service instead.')).toBeInTheDocument();
    expect(text('evidence-concentration-value')).toBe(`3 of ${service.rows.length} Services`);
    expect(within(screen.getByTestId('origin-bars')).queryByText('Handling Group')).toBeNull();
  });

  it('an identical SLA flag stays "—" / Needs data in the snapshot and reads as one distinct value in Evidence', () => {
    renderPage();
    expect(text('executive-snapshot')).toMatch(/SLA flag carries no signal/);
    expect(text('evidence-sla-value')).toContain('SLA: 1 distinct value · no signal');
  });

  it('lists "without Offering" only because some incidents have none', () => {
    renderPage();
    const offering = dimensionTable(ctx.filteredIncidents, 'serviceOffering', ids());
    expect(text('evidence-operational-origin')).toContain(`${offering.missing!.incidents} without Offering`);
    expect(text('evidence-operational-origin')).not.toContain('without Service');
  });

  it('marks Origin Directional in the lineage', () => {
    renderPage();
    fireEvent.click(screen.getByText(/View methodology & limitations/));
    const origin = screen.getByTestId('insight-lineage').querySelector('[data-statement="Operational origin"]')!;
    expect(within(origin as HTMLElement).getByText('Directional')).toBeInTheDocument();
  });
});

describe('discovery flag', () => {
  beforeEach(() => { ctx = contextFor(alertLikeRows()); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('is off by default', () => {
    renderPage();
    expect(screen.queryByTestId('discovery-questions')).toBeNull();
  });

  it('shows Questions to unlock when VITE_EXEC_DISCOVERY_PROMPTS=on', () => {
    vi.stubEnv('VITE_EXEC_DISCOVERY_PROMPTS', 'on');
    renderPage();
    expect(screen.getByTestId('discovery-questions')).toBeInTheDocument();
    expect(screen.getByText('What the product can answer today — by sponsor question')).toBeInTheDocument();
  });
});
