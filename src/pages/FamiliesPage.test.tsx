/**
 * Experimental Repeating Incident Groups page (FAM-01 / FAM-01.1): flag gating,
 * compute guard, plain-language main view and wording. Synthetic data only.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

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

/** A week with groups in it, so the main view shows cards. */
const busyWeek = (() => {
  const weeks = availableWeeks(pbna);
  return weeks[weeks.length - 3];
})();

function contextFor(incidents: AnnotatedIncident[], selectedWeek?: string) {
  const weeks = availableWeeks(incidents);
  return {
    incidents, filteredIncidents: incidents, availableWeeks: weeks, selectedWeek: selectedWeek ?? weeks[weeks.length - 1], setSelectedWeek: vi.fn(),
    currentPage: 'overview', setCurrentPage: vi.fn(), filterLabel: 'all', setFilterLabel: vi.fn(), fileName: 'synthetic.csv',
  };
}

const FORBIDDEN = ['root cause', 'caused by', 'triggered by', 'owner', 'responsible', 'poor performing', 'correlation', 'noise', 'emerging', 'risk', 'anomaly'];
const JARGON = [/\bR[012]\b/, /\btau\b/i, /τ/, /cosine/i, /threshold/i, /singleton/i, /famil(y|ies)/i, /entropy/i, /breadth/i, /\bARI\b/, /hash/i];

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

  it('main view: week summary, cards, plain language only', async () => {
    ctx = contextFor(pbna, busyWeek);
    const { container } = render(<FamiliesPage />);
    await screen.findByTestId('week-summary');
    expect(workerConstructed).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('families-banner')).toHaveTextContent(FAMILIES_COPY.banner);
    expect(screen.getByTestId('week-label')).toHaveTextContent(/^Week of [A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}$/);
    expect(screen.getByTestId('data-through')).toBeInTheDocument();
    const cards = screen.getAllByTestId('group-card');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(FAMILIES_DISPLAY.topCards);
    for (const card of cards) {
      expect(within(card).getByTestId('group-name').textContent).toMatch(/^(Example: |Group without text)/);
      expect(within(card).getByTestId('fact-line').textContent).toMatch(/^\d+ this week · (typical [\d.]+ · [+−±]|New this period|no earlier weeks)/);
      expect(within(card).getByTestId('sparkline')).toBeInTheDocument();
      expect(card).toHaveTextContent(/Mostly handled by/);
      expect(card).toHaveTextContent(/Main service:/);
      expect(card).toHaveTextContent(/incidents · appeared in \d+ of \d+ weeks/);
    }
    // Settings stay collapsed on the main view.
    expect(screen.queryByTestId('settings-body')).toBeNull();
    const text = container.textContent!;
    for (const word of FORBIDDEN) expect(text.toLowerCase()).not.toContain(word);
    for (const re of JARGON) expect(text).not.toMatch(re);
    // Incident numbers are never shown.
    for (const inc of pbna) expect(text).not.toContain(inc.Number);
  });

  it('week KPIs reconcile: grouped + one-off = total', async () => {
    for (const week of [busyWeek, availableWeeks(pbna)[0], availableWeeks(pbna)[40]]) {
      ctx = contextFor(pbna, week);
      const { unmount } = render(<FamiliesPage />);
      const total = Number((await screen.findByTestId('kpi-total')).textContent!.replace(/,/g, ''));
      const grouped = Number(screen.getByTestId('kpi-grouped').textContent!.split(' ')[0].replace(/,/g, ''));
      const oneOff = Number(screen.getByTestId('kpi-one-off').textContent!.split(' ')[0].replace(/,/g, ''));
      expect(grouped + oneOff).toBe(total);
      expect(total).toBe(pbna.filter(i => i.week === week).length);
      unmount();
    }
  });

  it('group detail shows breakdowns, common words and incidents without numbers', async () => {
    ctx = contextFor(pbna, busyWeek);
    render(<FamiliesPage />);
    const card = (await screen.findAllByTestId('group-card'))[0];
    fireEvent.click(within(card).getByText(FAMILIES_COPY.seeIncidents));
    const detail = screen.getByTestId('group-detail');
    expect(detail).toHaveTextContent('Handled by');
    expect(detail).toHaveTextContent('Service');
    expect(detail).toHaveTextContent(/Incidents in view · newest first/);
    for (const inc of pbna) expect(detail.textContent).not.toContain(inc.Number);
  });

  it('settings: three strictness choices, text cleaning, advanced explorer', async () => {
    ctx = contextFor(pbna, busyWeek);
    render(<FamiliesPage />);
    await screen.findByTestId('week-summary');
    fireEvent.click(screen.getByText(FAMILIES_COPY.settingsTitle));
    const body = screen.getByTestId('settings-body');
    expect(within(body).getAllByRole('radio')).toHaveLength(3);
    expect(body).toHaveTextContent(FAMILIES_COPY.strictnessNote);
    const cleaning = within(body).getByLabelText(FAMILIES_COPY.textCleaning);
    expect(within(cleaning).getAllByRole('option').map(o => o.textContent)).toEqual(['Original text', 'Remove repeated templates', 'Remove templates and IDs']);
    fireEvent.click(within(body).getByText(FAMILIES_COPY.advanced));
    expect(within(screen.getByTestId('threshold-explorer')).getAllByRole('row')).toHaveLength(1 + 4);
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
