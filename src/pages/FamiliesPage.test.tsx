/** FAM-01 experimental Incident Families page: flag gating, compute guard, wording. Synthetic data only. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { enrichRow, inferDateOrder, readIncidentTable } from '@/lib/parser';
import { annotateIncidents, type AnnotatedIncident } from '@/lib/problems';
import { availableWeeks } from '@/lib/weekly';
import { computeFamilyPartitions } from '@/lib/families/families';
import { FAMILIES_COPY, FAMILIES_DISPLAY } from '@/config/families';
import FamiliesPage from './FamiliesPage';
import AppSidebar from '@/components/AppSidebar';

function load(file: string): AnnotatedIncident[] {
  const bytes = readFileSync(path.resolve(__dirname, '../test/fixtures/families', file));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { rows } = readIncidentTable(buffer);
  const order = inferDateOrder(rows);
  return annotateIncidents(rows.map(r => enrichRow(r, { dateOrder: order })));
}

const pbna = load('syn_pbna.csv');

let ctx: Record<string, unknown>;
vi.mock('@/context/AppContext', () => ({ useAppContext: () => ctx }));
// The global filter bar has its own tests; here it only needs to render nothing.
vi.mock('@/components/GlobalFilters', () => ({ default: () => null }));

/** Stand-in for the module worker: runs the real computation and answers asynchronously. */
const workerConstructed = vi.fn();
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor() { workerConstructed(); }
  postMessage(request: { kind: string; texts: string[]; variant: 'R0' | 'R1' | 'R2'; tau?: number }) {
    expect(request.kind).toBe('families');
    const result = computeFamilyPartitions(request);
    setTimeout(() => this.onmessage?.({ data: { type: 'families', payload: { ...result, elapsedMs: 1 } } } as MessageEvent), 0);
  }
  terminate() {}
}

function contextFor(incidents: AnnotatedIncident[]) {
  const weeks = availableWeeks(incidents);
  return {
    incidents, filteredIncidents: incidents, availableWeeks: weeks, selectedWeek: weeks[weeks.length - 1], setSelectedWeek: vi.fn(),
    currentPage: 'overview', setCurrentPage: vi.fn(), filterLabel: 'all', setFilterLabel: vi.fn(), fileName: 'synthetic.csv',
  };
}

const FORBIDDEN = ['root cause', 'caused by', 'triggered by', 'owner', 'responsible', 'poor performing', 'correlation', 'noise', 'emerging', 'risk', 'anomaly'];

beforeEach(() => {
  workerConstructed.mockClear();
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('flag OFF (default)', () => {
  it('has no sidebar entry', () => {
    vi.stubEnv('VITE_EXPERIMENTAL_FAMILIES', '');
    ctx = contextFor(pbna);
    render(<AppSidebar />);
    expect(screen.queryByText(FAMILIES_COPY.title)).toBeNull();
  });

  it('computes nothing and starts no worker request', () => {
    vi.stubEnv('VITE_EXPERIMENTAL_FAMILIES', '');
    ctx = contextFor(pbna);
    render(<FamiliesPage />);
    expect(screen.getByText('This view is not available.')).toBeInTheDocument();
    expect(workerConstructed).not.toHaveBeenCalled();
  });
});

describe('flag ON', () => {
  beforeEach(() => vi.stubEnv('VITE_EXPERIMENTAL_FAMILIES', 'on'));

  it('adds the sidebar entry', () => {
    ctx = contextFor(pbna);
    render(<AppSidebar />);
    expect(screen.getByText(FAMILIES_COPY.title)).toBeInTheDocument();
  });

  it('shows banner, registered controls, explorer and families, with allowed wording only', async () => {
    ctx = contextFor(pbna);
    const { container } = render(<FamiliesPage />);
    const explorer = await screen.findByTestId('threshold-explorer');
    expect(workerConstructed).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('families-banner')).toHaveTextContent(FAMILIES_COPY.banner);
    expect(screen.getByTestId('default-label')).toHaveTextContent(FAMILIES_COPY.defaultLabel);
    expect(within(explorer).getAllByRole('row')).toHaveLength(1 + 4);
    const thresholdOptions = within(screen.getByLabelText('Similarity threshold')).getAllByRole('option').map(o => o.textContent);
    expect(thresholdOptions).toEqual(['0.5', '0.6', '0.7', '0.8']);
    expect(screen.getAllByTestId('family-row').length).toBeGreaterThan(0);
    expect(screen.getByTestId('data-through')).toBeInTheDocument();
    const text = container.textContent!.toLowerCase();
    for (const word of FORBIDDEN) expect(text).not.toContain(word);
    // No incident number is ever shown on the families page.
    for (const inc of pbna) expect(container.textContent).not.toContain(inc.Number);
    // Family IDs are F001… and never cluster ids.
    expect(screen.getAllByTestId('family-row')[0]).toHaveTextContent(/^F001/);
  });

  it('reconciles each displayed week: in families + singletons = incidents', async () => {
    ctx = contextFor(pbna);
    render(<FamiliesPage />);
    const table = await screen.findByTestId('weekly-reconciliation');
    for (const row of within(table).getAllByRole('row').slice(1)) {
      const [, fam, single, total] = within(row).getAllByRole('cell').map(c => Number(c.textContent));
      expect(fam + single).toBe(total);
    }
  });

  it('above the compute guard shows the message and computes nothing', () => {
    const many: AnnotatedIncident[] = [];
    while (many.length <= FAMILIES_DISPLAY.maxRows) many.push(...pbna);
    ctx = contextFor(many);
    render(<FamiliesPage />);
    expect(screen.getByText(FAMILIES_COPY.tooLarge)).toBeInTheDocument();
    expect(workerConstructed).not.toHaveBeenCalled();
  });
});
