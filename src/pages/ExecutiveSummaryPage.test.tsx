import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { enrichRow, inferDateOrder, readIncidentTable, type IncidentRow } from '@/lib/parser';
import { scoreIncident } from '@/lib/scorer';
import { annotateIncidents, computeProblemClusters } from '@/lib/problems';
import { computeOverview } from '@/lib/analytics';
import { dimensionAvailability } from '@/lib/dimensions';
import { dimensionTable } from '@/lib/serviceDimension';
import { ALL_VALUES } from '@/lib/problemView';
import { toXlsxBuffer } from '@/test/fixtures/syntheticDatasets';
import { alertLikeRows, ticketLikeRows } from '@/test/fixtures/executiveFixtures';
import ExecutiveSummaryPage from './ExecutiveSummaryPage';

/** The real ingestion → scoring → clustering path, as the worker runs it, over synthetic rows. */
function contextFor(rows: IncidentRow[]) {
  const { rows: parsed, columns } = readIncidentTable(toXlsxBuffer(rows));
  const order = inferDateOrder(parsed);
  const enriched = parsed.map(r => enrichRow(r, { dateOrder: order }));
  const scores = enriched.map(scoreIncident);
  const incidents = annotateIncidents(enriched);
  return {
    filteredIncidents: incidents,
    filteredScores: scores,
    filteredOverview: computeOverview(incidents, scores),
    filteredProblems: computeProblemClusters(incidents, scores),
    dimensionAvailability: dimensionAvailability(columns),
    sourceColumns: columns,
    setCurrentPage: vi.fn(),
    // GlobalFilters reads these; one month keeps the month filter hidden.
    incidents, availableMonths: [], selectedMonths: [], setSelectedMonths: vi.fn(),
    globalFilters: { months: [], services: ALL_VALUES, serviceOfferings: ALL_VALUES },
    serviceSelection: ALL_VALUES, offeringSelection: ALL_VALUES,
    setServiceSelection: vi.fn(), setOfferingSelection: vi.fn(), isDimensionFilterActive: false, clearDimensionFilters: vi.fn(),
  };
}

let ctx: ReturnType<typeof contextFor>;
vi.mock('@/context/AppContext', () => ({ useAppContext: () => ctx }));

const renderPage = () => render(<TooltipProvider><ExecutiveSummaryPage /></TooltipProvider>);
const FORBIDDEN = /caused by|triggered by|confirmed problem|owner|responsible|poor performing|upstream failure/i;

describe('ExecutiveSummaryPage — alert-like population (several Handling Groups)', () => {
  beforeEach(() => { ctx = contextFor(alertLikeRows()); });

  it('ranks Handling Groups with the same numbers as Origen’s dimension table', () => {
    renderPage();
    const table = dimensionTable(ctx.filteredIncidents, 'assignmentGroup', new Set(ctx.filteredProblems.map(p => p.id)));
    const bars = within(screen.getByTestId('look-bars'));
    for (const row of table.rows.slice(0, 3)) {
      expect(bars.getByText(row.value as string)).toBeInTheDocument();
      expect(bars.getByText(row.value as string).closest('[data-kind]')).toHaveAttribute('title', expect.stringContaining(`: ${row.incidents} incidents`));
    }
    expect(bars.getByText(`Others (${table.rows.length - 3})`)).toBeInTheDocument();
    expect(screen.getByTestId('executive-headline').textContent).toMatch(new RegExp(`handled by 3 of ${table.rows.length} Handling Groups`));
  });

  it('shows the largest pattern’s breadth and keeps application context unavailable', () => {
    renderPage();
    expect(screen.getByTestId('pattern-breadth').textContent).toMatch(/^It spans \d+ Services?, \d+ Offerings? and \d+ Handling Groups?\.$/);
    expect(screen.getByText('Not available — no approved extractor.')).toBeInTheDocument();
  });

  it('reports a mixed SLA flag as a breach share, and Origin as Validated', () => {
    renderPage();
    expect(screen.getByText(/SLA breached of closed incidents/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Evidence & open questions/));
    const row = screen.getByText('6 · Origin (Group / Service / Offering)').closest('tr')!;
    expect(within(row).getByText('Validated')).toBeInTheDocument();
  });

  it('lists "No Service" separately, never inside Others', () => {
    renderPage();
    const origin = within(screen.getByTestId('origin-bars'));
    expect(origin.getByText('No Service').closest('[data-kind]')).toHaveAttribute('data-kind', 'missing');
  });

  it('uses no forbidden wording', () => {
    renderPage();
    expect(screen.getByTestId('executive-summary').textContent).not.toMatch(FORBIDDEN);
  });
});

describe('ExecutiveSummaryPage — ticket-like population (one Handling Group)', () => {
  beforeEach(() => { ctx = contextFor(ticketLikeRows()); });

  it('falls back to Service and says so', () => {
    renderPage();
    expect(screen.getByText('One Handling Group handles every incident in view, so this view uses Service instead.')).toBeInTheDocument();
    expect(screen.getByTestId('executive-headline').textContent).toMatch(/associated with \d+ of \d+ Services/);
    expect(within(screen.getByTestId('origin-bars')).queryByText('Handling Group')).toBeNull();
  });

  it('marks an identical SLA flag as Needs data (no signal), and Origin as Directional', () => {
    renderPage();
    expect(screen.getByText(/SLA flag carries no signal/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Evidence & open questions/));
    const row = screen.getByText('6 · Origin (Group / Service / Offering)').closest('tr')!;
    expect(within(row).getByText('Directional')).toBeInTheDocument();
  });

  it('shows the discovery prompts by default (flag on)', () => {
    renderPage();
    expect(screen.getByTestId('discovery-questions')).toBeInTheDocument();
  });
});
