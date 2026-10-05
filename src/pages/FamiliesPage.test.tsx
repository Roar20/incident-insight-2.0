/**
 * Experimental Repeating Incident Groups page (FAM-01 / FAM-01.1): flag gating,
 * compute guard, plain-language main view and wording. Synthetic data only.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { enrichRow, inferDateOrder, readIncidentTable } from '@/lib/parser';
import { annotateIncidents, type AnnotatedIncident } from '@/lib/problems';
import { availableWeeks } from '@/lib/weekly';
import { ALL_VALUES, filterIncidents } from '@/lib/problemView';
import { dimensionValue } from '@/lib/serviceDimension';
import { computeFamilyPartitions } from '@/lib/families/families';
import { FAMILIES_COPY, FAMILIES_DISPLAY } from '@/config/families';
import { dataThrough, formatDataThrough } from '@/lib/weeklyComposition';
import { composition, settingSummary, shortDate, utcDateKey, weekRangeText } from '@/lib/families/presentation';
import { openTimeText } from '@/lib/families/variants';
import { scoreIncident } from '@/lib/scorer';
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
const sap = load('syn_sap.csv');
const scoresOf = new Map([pbna, sap].map(d => [d, d.map(scoreIncident)]));

let ctx: Record<string, unknown>;
vi.mock('@/context/AppContext', () => ({ useAppContext: () => ctx }));
// The global filter bar has its own tests; here it only needs to render nothing.
vi.mock('@/components/GlobalFilters', () => ({ default: () => null }));
// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

/** Stand-in for the module worker: runs the real computation and answers asynchronously. */
const workerConstructed = vi.fn();
const workerRequests: { variant: string; tau?: number }[] = [];
/** Answer delay per text cleaning (ms); terminate() is ignored, so superseded answers still arrive. */
const workerDelay: Record<string, number> = {};
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor() { workerConstructed(); }
  postMessage(request: { kind: string; texts: string[]; variant: 'R0' | 'R1' | 'R2'; tau?: number }) {
    expect(request.kind).toBe('families');
    workerRequests.push({ variant: request.variant, tau: request.tau });
    const result = computeFamilyPartitions(request);
    setTimeout(() => this.onmessage?.({ data: { type: 'families', payload: { ...result, elapsedMs: 1 } } } as MessageEvent), workerDelay[request.variant] ?? 0);
  }
  terminate() {}
}

/** A week with groups in it, so the main view shows cards. */
const busyWeek = (() => {
  const weeks = availableWeeks(pbna);
  return weeks[weeks.length - 3];
})();

type Selection = { values: string[]; includeMissing: boolean };
function contextFor(incidents: AnnotatedIncident[], selectedWeek?: string, filtered?: { view: AnnotatedIncident[]; months: string[]; services?: Selection; serviceOfferings?: Selection }, filterLabel = 'all') {
  const weeks = availableWeeks(incidents);
  const scores = scoresOf.get(incidents) ?? incidents.map(scoreIncident);
  return {
    incidents, scores, filteredIncidents: filtered?.view ?? incidents, availableWeeks: weeks, selectedWeek: selectedWeek ?? weeks[weeks.length - 1], setSelectedWeek: vi.fn(),
    globalFilters: { months: filtered?.months ?? [], services: filtered?.services ?? { values: [], includeMissing: false }, serviceOfferings: filtered?.serviceOfferings ?? { values: [], includeMissing: false } },
    currentPage: 'overview', setCurrentPage: vi.fn(), filterLabel, setFilterLabel: vi.fn(), fileName: 'synthetic.csv',
  };
}

/** Labels of one strictness for a text cleaning, computed independently of the page. */
function labelsOf(incidents: AnnotatedIncident[], strictness: keyof typeof FAMILIES_DISPLAY.strictness, variant: 'R0' | 'R1' | 'R2' = 'R1', tau: number | undefined = 0.05) {
  const parts = computeFamilyPartitions({ texts: incidents.map(i => openTimeText(i.shortDescClean, i.descClean)), variant, tau: variant === 'R0' ? undefined : tau });
  return parts.labels[parts.thresholds.indexOf(FAMILIES_DISPLAY.strictness[strictness])];
}
function resultLine(incidents: AnnotatedIncident[], view: AnnotatedIncident[], labels: Int32Array) {
  const s = settingSummary(incidents, view, labels);
  return { groups: s.groups, oneOff: composition(s).oneOffPct };
}
/** Opens "Grouping settings · For analysts" when it is closed. */
function openSettings() {
  if (!screen.queryByTestId('settings-body')) fireEvent.click(screen.getByText(FAMILIES_COPY.settingsTitle));
}
const pick = (name: string) => {
  openSettings();
  fireEvent.click(screen.getByRole('radio', { name }));
};

const FORBIDDEN = ['root cause', 'caused by', 'triggered by', 'owner', 'responsible', 'poor performing', 'correlation', 'noise', 'emerging', 'risk', 'anomaly'];
const JARGON = [/\bR[012]\b/, /\btau\b/i, /τ/, /cosine/i, /threshold/i, /singleton/i, /famil(y|ies)/i, /entropy/i, /breadth/i, /\bARI\b/, /hash/i,
  /TF-?IDF/i, /partial/i, /incomplete/i, /complete week/i];
const lastWeek = availableWeeks(pbna)[availableWeeks(pbna).length - 1];

beforeEach(() => {
  workerConstructed.mockClear();
  workerRequests.length = 0;
  for (const k of Object.keys(workerDelay)) delete workerDelay[k];
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
    // The week appears once: in the selector, never repeated as a "Week of" line.
    expect(screen.queryByTestId('week-label')).toBeNull();
    expect(container.textContent).not.toMatch(/Week of/);
    expect(screen.getByTestId('data-through')).toBeInTheDocument();
    const cards = screen.getAllByTestId('group-card');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards).toHaveLength(FAMILIES_DISPLAY.topCards);
    for (const card of cards) {
      expect(within(card).getByTestId('group-name').textContent).toMatch(/^(Example: |Group without text)/);
      // "Largest overall": the selected week is secondary, after the historical facts.
      expect(within(card).getByTestId('fact-line').textContent).toMatch(/^Selected week: (\d+ this week · (previous (\d-week average|week) [\d.]+ · [+−±]|New this period|no earlier weeks)|\d+ incidents? through )/);
      expect(within(card).getByTestId('sparkline')).toBeInTheDocument();
      expect(within(card).getByTestId('card-handled')).toHaveTextContent(/^Mostly handled by /);
      expect(within(card).getByTestId('card-service')).toHaveTextContent(/^Main service: /);
      expect(within(card).getByTestId('card-totals').textContent).toMatch(/^\d+ incidents? · seen in \d+ of \d+ weeks · Last seen [A-Z][a-z]{2} \d{1,2}$/);
      // No group numbers, no common words on the card.
      expect(within(card).queryByTestId('group-id')).toBeNull();
      expect(card.textContent).not.toMatch(/\bG\d{2}\b|Common words/);
      // Card order: name → totals → service → handled by → sparkline → selected week.
      const order = ['group-name', 'card-totals', 'card-service', 'card-handled', 'sparkline', 'fact-line'].map(id => within(card).getByTestId(id));
      for (let i = 1; i < order.length; i++) {
        expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    }
    // Order: selected week → selected period → groups → grouping settings (collapsed, for analysts).
    const sections = ['week-summary', 'period-summary', 'group-cards', 'settings-panel'].map(id => screen.getByTestId(id));
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i - 1].compareDocumentPosition(sections[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getByTestId('week-summary')).toHaveTextContent(/^Selected week/);
    expect(screen.getByTestId('period-summary')).toHaveTextContent(/^Selected period/);
    expect(screen.getByTestId('grouping-status')).toHaveTextContent('Grouping: Balanced · Remove repeated templates');
    expect(screen.queryByTestId('settings-body')).toBeNull();
    expect(container.textContent).not.toMatch(/\bG\d{2}\b|Common words/);
    // No letter-spaced uppercase section titles, no monospace text.
    expect(container.querySelector('.uppercase, .font-mono')).toBeNull();
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
      const pct = (id: string) => Number(screen.getByTestId(id).textContent!.replace('%', ''));
      if (total > 0) expect(pct('kpi-grouped-pct') + pct('kpi-one-off-pct')).toBe(100);
      unmount();
    }
  });

  it('group detail: business first; Gxx and common words only under "For analysts"; raw text collapsed', async () => {
    ctx = contextFor(pbna, busyWeek);
    render(<FamiliesPage />);
    const card = (await screen.findAllByTestId('group-card'))[0];
    fireEvent.click(within(card).getByText(FAMILIES_COPY.seeIncidents));
    const detail = screen.getByTestId('group-detail');
    for (const title of ['Recent activity', 'Activity over time', 'Service', 'Handled by']) expect(within(detail).getByText(title)).toBeInTheDocument();
    expect(within(detail).getByTestId('detail-count').textContent).toMatch(/^\d+ incidents? · seen in \d+ of \d+ weeks$/);
    expect(within(detail).getByTestId('detail-context').textContent).toMatch(/^\d+ incidents? since [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    expect(detail.textContent).not.toMatch(/\bG\d{2}\b|Common words|W\d{2}\b/);
    // Month labels on the activity axis, not ISO week codes.
    expect(within(detail).getByTestId('activity-axis').textContent).toMatch(/^[A-Z][a-z]{2} \d{4}/);
    // Raw incident text is not mounted until asked for, one incident at a time.
    expect(within(detail).queryAllByTestId('incident-details')).toHaveLength(0);
    const lines = within(detail).getAllByTestId('incident-line');
    expect(lines.length).toBeLessThanOrEqual(5);
    const withDetails = lines.find(l => within(l).queryByText(FAMILIES_COPY.viewIncidentDetails))!;
    fireEvent.click(within(withDetails).getByText(FAMILIES_COPY.viewIncidentDetails));
    expect(within(detail).getAllByTestId('incident-details')).toHaveLength(1);
    fireEvent.click(within(detail).getByText(FAMILIES_COPY.analystDetails));
    expect(within(detail).getByTestId('group-id').textContent).toMatch(/G\d{2}$/);
    for (const inc of pbna) expect(detail.textContent).not.toContain(inc.Number);
  });

  describe('group detail reconciles to one population', () => {
    const scores = scoresOf.get(sap)!;
    // Filter values that hold repeating incidents: the most frequent among grouped incidents.
    const balanced = labelsOf(sap, 'balanced');
    const mostFrequent = (dim: 'service' | 'serviceOffering') => {
      const counts = new Map<string, number>();
      sap.forEach((inc, i) => {
        const v = dimensionValue(inc, dim);
        if (balanced[i] >= 0 && v) counts.set(v, (counts.get(v) ?? 0) + 1);
      });
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    };
    const service = mostFrequent('service');
    const off = mostFrequent('serviceOffering');
    const months = ['2026-03', '2026-04'];
    const cases: [string, () => ReturnType<typeof contextFor>][] = [
      ['no filters', () => contextFor(sap)],
      ['Month', () => contextFor(sap, undefined, { view: filterIncidents(sap, { months, services: ALL_VALUES, serviceOfferings: ALL_VALUES }), months })],
      ['Service', () => {
        const services = { values: [service], includeMissing: false };
        return contextFor(sap, undefined, { view: filterIncidents(sap, { months: [], services, serviceOfferings: ALL_VALUES }), months: [], services });
      }],
      ['Offering', () => {
        const serviceOfferings = { values: [off], includeMissing: false };
        return contextFor(sap, undefined, { view: filterIncidents(sap, { months: [], services: ALL_VALUES, serviceOfferings }), months: [], serviceOfferings });
      }],
      ['Quality', () => contextFor(sap, undefined, undefined, 'Poor')],
    ];
    for (const [name, make] of cases) {
      it(`${name}: header = Service = Handled by = weekly activity = incident list; no regrouping`, async () => {
        ctx = make();
        render(<FamiliesPage />);
        await screen.findByTestId('week-summary', {}, { timeout: 10000 });
        const requests = workerRequests.length;
        const cards = screen.getAllByTestId('group-card').slice(0, 2);
        expect(cards.length).toBeGreaterThan(0);
        for (const card of cards) {
          const cardTotal = Number(within(card).getByTestId('card-totals').textContent!.split(' ')[0].replace(/,/g, ''));
          fireEvent.click(within(card).getByText(FAMILIES_COPY.seeIncidents));
          const detail = screen.getByTestId('group-detail');
          const n = Number(within(detail).getByTestId('detail-count').dataset.count);
          const sum = (els: HTMLElement[]) => els.reduce((a, e) => a + Number(e.dataset.count), 0);
          expect(n).toBe(cardTotal);
          expect(sum(within(within(detail).getByTestId('detail-service')).getAllByTestId('breakdown-row'))).toBe(n);
          expect(sum(within(within(detail).getByTestId('detail-handled')).getAllByTestId('breakdown-row'))).toBe(n);
          const weeksIn = within(detail).getAllByTestId('activity-week').filter(w => w.dataset.inPeriod === 'true');
          expect(sum(weeksIn)).toBe(n);
          expect(within(detail).getAllByTestId('activity-week').filter(w => w.dataset.inPeriod !== 'true').every(w => w.dataset.count === '0')).toBe(true);
          expect(Number(within(detail).getByTestId('incident-list').dataset.count)).toBe(n);
          expect(within(detail).getAllByTestId('incident-line')).toHaveLength(Math.min(5, n));
          if (name !== 'no filters') expect(within(detail).getByTestId('detail-context').textContent).toMatch(/ in the whole file since /);
          if (name === 'Quality') {
            const poor = new Set(sap.filter((_, i) => scores[i].label === 'Poor'));
            expect(n).toBeLessThanOrEqual(poor.size);
          }
          fireEvent.click(within(detail).getByLabelText('Close'));
        }
        expect(workerRequests.length).toBe(requests);
      }, 30000);
    }
  });

  it('grouping settings: collapsed for analysts; strictness, text cleaning, notes and explorer inside', async () => {
    ctx = contextFor(pbna, busyWeek);
    render(<FamiliesPage />);
    await screen.findByTestId('week-summary');
    const panel = screen.getByTestId('settings-panel');
    expect(within(panel).queryAllByRole('radio')).toHaveLength(0);
    expect(panel).toHaveTextContent('Grouping settings· For analysts');
    // "Change" next to the read-only status opens the settings.
    fireEvent.click(within(screen.getByTestId('grouping-status')).getByText('Change'));
    const body = screen.getByTestId('settings-body');
    expect(within(body).getAllByRole('radio')).toHaveLength(3);
    const cleaning = within(body).getByLabelText(FAMILIES_COPY.textCleaning);
    expect(within(cleaning).getAllByRole('option').map(o => o.textContent)).toEqual(['Original text', 'Remove repeated templates', 'Additional text normalization (experimental)']);
    expect(body).toHaveTextContent(FAMILIES_COPY.strictnessNote);
    expect(screen.getByTestId('exploratory-default')).toHaveTextContent('Exploratory default — not a selected configuration.');
    expect(within(screen.getByTestId('threshold-explorer')).getAllByRole('row')).toHaveLength(1 + 4);
  });

  it('opens with Remove repeated templates (R1, τ 0.05) and Largest repeating groups', async () => {
    // A fresh array: results are cached per loaded file, and this test needs the worker request.
    ctx = contextFor([...pbna]);
    render(<FamiliesPage />);
    await screen.findByTestId('week-summary');
    expect(workerRequests[0]).toEqual({ variant: 'R1', tau: 0.05 });
    expect(screen.getByText(FAMILIES_COPY.cardsTitle)).toBeInTheDocument();
    expect((screen.getByLabelText('Sort by') as HTMLSelectElement).value).toBe('largest');
    expect(screen.queryByText('Remove templates and IDs')).toBeNull();
  });

  it('defaults to the Data-through week and never compares it with typical when the data ends inside it', async () => {
    ctx = contextFor(pbna);
    const { container } = render(<FamiliesPage />);
    await screen.findByTestId('week-summary');
    const throughDate = utcDateKey(dataThrough(pbna)!);
    const select = screen.getByLabelText('Week') as HTMLSelectElement;
    expect(select.value).toBe(lastWeek);
    expect(select.selectedOptions[0].textContent).toBe(`${weekRangeText(lastWeek)} · data through ${shortDate(throughDate)}`);
    expect(screen.getByTestId('kpi-total-label')).toHaveTextContent(`incidents through ${shortDate(throughDate)}`);
    expect(screen.getByTestId('coverage-message')).toHaveTextContent(
      `This file has data through ${shortDate(throughDate)}. Comparison with the previous weeks' average is shown only for weeks fully covered by the data.`);
    // The coverage message itself names the average; everything else in the block must not compare.
    const summary = screen.getByTestId('week-summary').textContent!.replace(screen.getByTestId('coverage-message').textContent!, '');
    const factLines = screen.getAllByTestId('fact-line').map(f => f.textContent!);
    for (const line of factLines) expect(line).toMatch(new RegExp(`^Selected week: \\d+ incidents? through ${shortDate(throughDate)}$`));
    for (const t of [summary, ...factLines]) {
      expect(t).not.toMatch(/New this period|typical|average|[+−±]\d|\d+%\)|above|below|normal/i);
    }
    expect(container.textContent).not.toMatch(/partial|incomplete/i);
  });

  it('a non-time filter whose incidents end earlier does not change the Data-through label or eligibility', async () => {
    const throughDate = utcDateKey(dataThrough(pbna)!);
    // Keep only incidents opened at least two weeks before Data through.
    const cutoff = new Date(Date.parse(`${throughDate}T00:00:00Z`) - 14 * 86400000).toISOString().slice(0, 10);
    const view = pbna.filter(i => i.Opened.slice(0, 10) < cutoff);
    ctx = contextFor(pbna, undefined, { view, months: [] });
    render(<FamiliesPage />);
    await screen.findByTestId('week-summary');
    expect(screen.getByTestId('data-through')).toHaveTextContent(`Data through ${formatDataThrough(dataThrough(pbna)!)}`);
    expect(screen.getByTestId('kpi-total')).toHaveTextContent('0');
    expect(screen.getByTestId('kpi-total-label')).toHaveTextContent(`incidents through ${shortDate(throughDate)}`);
    expect(screen.getByTestId('coverage-message')).toBeInTheDocument();
  });

  it('a fully covered week keeps the comparison with typical', async () => {
    ctx = contextFor(pbna, busyWeek);
    render(<FamiliesPage />);
    await screen.findByTestId('week-summary');
    expect(screen.queryByTestId('coverage-message')).toBeNull();
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'selectedWeek' } });
    const first = screen.getAllByTestId('fact-line')[0].textContent!;
    expect(first).toMatch(/this week · (typical [\d.]+ · [+−±]|New this period)/);
  });

  it('sort control: Most incidents in selected week puts the busiest group first', async () => {
    ctx = contextFor(pbna, busyWeek);
    render(<FamiliesPage />);
    await screen.findByTestId('week-summary');
    const totals = () => screen.getAllByTestId('card-totals').map(t => Number(t.textContent!.split(' ')[0].replace(/,/g, '')));
    const largest = totals();
    for (let i = 1; i < largest.length; i++) expect(largest[i - 1]).toBeGreaterThanOrEqual(largest[i]);
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'selectedWeek' } });
    const counts = screen.getAllByTestId('fact-line').map(f => Number(f.textContent!.split(' ')[0]));
    for (let i = 1; i < counts.length; i++) expect(counts[i - 1]).toBeGreaterThanOrEqual(counts[i]);
  });

  it('selected period and incident pattern distribution: repeating vs one-off, reconciled, period and denominator shown', async () => {
    ctx = contextFor(pbna);
    const { unmount } = render(<FamiliesPage />);
    await screen.findByTestId('distribution');
    const segs = screen.getAllByTestId('distribution-segment');
    expect(segs.map(s => s.dataset.key)).toEqual(['repeating', 'oneOff']);
    expect(segs.reduce((a, s) => a + Number(s.dataset.count), 0)).toBe(pbna.length);
    expect(segs.reduce((a, s) => a + Number(s.dataset.pct), 0)).toBe(100);
    const balanced = labelsOf(pbna, 'balanced');
    const oneOff = settingSummary(pbna, pbna, balanced).oneOff;
    expect(Number(segs[1].dataset.count)).toBe(oneOff);
    const pct = (id: string) => Number(screen.getByTestId(id).textContent!.replace('%', ''));
    expect(pct('composition-repeating') + pct('composition-one-off')).toBe(100);
    const first = pbna.map(i => i.Opened).sort()[0];
    const last = utcDateKey(dataThrough(pbna)!);
    expect(screen.getByTestId('period-label')).toHaveTextContent(
      `${shortDate(first.slice(0, 10))}, ${first.slice(0, 4)} – ${shortDate(last)}, ${last.slice(0, 4)} · ${pbna.length} incidents`);
    // Concentration: the top 5 share and the spread of the rest, as facts.
    const groups = settingSummary(pbna, pbna, balanced).groups;
    expect(screen.getByTestId('concentration').textContent).toMatch(new RegExp(`^Top 5 repeating groups account for (<1|\\d+)% of all incidents\\.The remaining repeating incidents are spread across ${groups - 5} other groups\\.$`));
    // Top 5 / next 20 / remaining stay secondary, and split the repeating share exactly.
    expect(screen.queryByTestId('repeating-breakdown')).toBeNull();
    fireEvent.click(screen.getByText('Breakdown of repeating groups'));
    const parts = within(screen.getByTestId('repeating-breakdown')).getAllByRole('listitem');
    expect(parts.reduce((a, p) => a + Number(p.dataset.count), 0)).toBe(pbna.length - oneOff);
    expect(parts.reduce((a, p) => a + Number(p.dataset.pct), 0)).toBe(pct('composition-repeating'));
    unmount();
    const months = [...new Set(pbna.map(i => i.Opened.slice(0, 7)))].sort().slice(1, 3);
    const view = pbna.filter(i => months.includes(i.Opened.slice(0, 7)));
    ctx = contextFor(pbna, undefined, { view, months });
    render(<FamiliesPage />);
    await screen.findByTestId('distribution');
    expect(screen.getByTestId('period-label').textContent).toMatch(new RegExp(`^[A-Z][a-z]{2}( \\d{4})? – [A-Z][a-z]{2} \\d{4} · ${view.length} incidents$`));
    const filtered = screen.getAllByTestId('distribution-segment');
    expect(filtered.reduce((a, s) => a + Number(s.dataset.count), 0)).toBe(view.length);
    expect(filtered.reduce((a, s) => a + Number(s.dataset.pct), 0)).toBe(100);
  });

  it('live result line reflects the current result and the previous setting', async () => {
    ctx = contextFor(pbna);
    render(<FamiliesPage />);
    await screen.findByTestId('week-summary');
    openSettings();
    const line = () => screen.getByTestId('result-line').textContent;
    const bal = resultLine(pbna, pbna, labelsOf(pbna, 'balanced'));
    const bro = resultLine(pbna, pbna, labelsOf(pbna, 'broader'));
    const str = resultLine(pbna, pbna, labelsOf(pbna, 'stricter'));
    expect(line()).toBe(`Balanced: ${bal.groups} groups · ${bal.oneOff}% one-off`);
    pick('Broader');
    await waitFor(() => expect(line()).toBe(`Broader: ${bro.groups} groups · ${bro.oneOff}% one-off (Balanced: ${bal.groups} · ${bal.oneOff}%)`));
    pick('Stricter');
    await waitFor(() => expect(line()).toBe(`Stricter: ${str.groups} groups · ${str.oneOff}% one-off (Broader: ${bro.groups} · ${bro.oneOff}%)`));
    // The cards follow the setting: as many groups as the line says.
    expect(screen.getByTestId('cards-showing')).toHaveTextContent(`of ${str.groups}`);
  });

  it('rapid Broader → Stricter → Broader ends on Broader with no extra computation', async () => {
    ctx = contextFor(pbna);
    render(<FamiliesPage />);
    await screen.findByTestId('week-summary');
    const requests = workerRequests.length;
    pick('Broader');
    pick('Stricter');
    pick('Broader');
    const bro = resultLine(pbna, pbna, labelsOf(pbna, 'broader'));
    await waitFor(() => expect(screen.getByTestId('result-line').textContent).toMatch(new RegExp(`^Broader: ${bro.groups} groups · ${bro.oneOff}% one-off`)));
    expect(screen.getByTestId('cards-showing')).toHaveTextContent(`of ${bro.groups}`);
    expect(workerRequests.length).toBe(requests);
  });

  it('"Updating groups…" while a new text cleaning is built; superseded answers are ignored', async () => {
    ctx = contextFor([...pbna]);
    render(<FamiliesPage />);
    await screen.findByTestId('week-summary');
    // R2 answers late, after R0 — the R2 answer belongs to a superseded request.
    workerDelay.R2 = 60;
    openSettings();
    fireEvent.change(screen.getByLabelText(FAMILIES_COPY.textCleaning), { target: { value: 'R2' } });
    expect(screen.getByTestId('updating')).toHaveTextContent('Updating groups…');
    // The last result stays on screen while updating.
    expect(screen.getAllByTestId('group-card').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText(FAMILIES_COPY.textCleaning), { target: { value: 'R0' } });
    const r0 = resultLine((ctx.incidents as AnnotatedIncident[]), pbna, labelsOf(pbna, 'balanced', 'R0'));
    const expected = new RegExp(`^Balanced: ${r0.groups} groups · ${r0.oneOff}% one-off`);
    await waitFor(() => expect(screen.getByTestId('result-line').textContent).toMatch(expected));
    await new Promise(r => setTimeout(r, 100));
    expect(workerRequests.map(r => r.variant)).toEqual(['R1', 'R2', 'R0']);
    expect(screen.getByTestId('result-line').textContent).toMatch(expected);
    expect((screen.getByLabelText(FAMILIES_COPY.textCleaning) as HTMLSelectElement).value).toBe('R0');
    expect(screen.queryByTestId('updating')).toBeNull();
  });

  it('cards: 6 mounted at first, "Show 6 more groups" adds exactly 6', async () => {
    ctx = contextFor(pbna);
    render(<FamiliesPage />);
    await screen.findByTestId('week-summary');
    const total = resultLine(pbna, pbna, labelsOf(pbna, 'balanced')).groups;
    expect(total).toBeGreaterThan(18);
    expect(screen.getAllByTestId('group-card')).toHaveLength(6);
    expect(screen.getByTestId('cards-showing')).toHaveTextContent(`showing 6 of ${total}`);
    fireEvent.click(screen.getByText('Show 6 more groups'));
    expect(screen.getAllByTestId('group-card')).toHaveLength(12);
    fireEvent.click(screen.getByText('Show 6 more groups'));
    expect(screen.getAllByTestId('group-card')).toHaveLength(18);
    expect(screen.queryByText(/^Show all/)).toBeNull();
    // A new grouping setting starts again from 6.
    pick('Broader');
    await waitFor(() => expect(screen.getAllByTestId('group-card')).toHaveLength(6));
  });

  it('one-off incidents of the selected week: collapsed by default, then 5 at a time with more and fewer', async () => {
    const week = availableWeeks(sap)[availableWeeks(sap).length - 1];
    ctx = contextFor(sap, week);
    render(<FamiliesPage />);
    await screen.findByTestId('week-summary', {}, { timeout: 10000 });
    const row = screen.getByTestId('one-off-row');
    const n = Number(screen.getByTestId('kpi-one-off').textContent!.split(' ')[0]);
    expect(n).toBeGreaterThan(15);
    expect(row.textContent).toBe(`${n} one-off incidents in the selected week · View incidents`);
    expect(screen.queryByTestId('one-off-list')).toBeNull();
    fireEvent.click(within(row).getByText('View incidents'));
    expect(within(row).getAllByTestId('incident-line')).toHaveLength(5);
    expect(within(row).queryAllByTestId('incident-details')).toHaveLength(0);
    fireEvent.click(within(row).getByText('Show more incidents'));
    expect(within(row).getAllByTestId('incident-line')).toHaveLength(15);
    fireEvent.click(within(row).getByText('Show fewer'));
    expect(within(row).getAllByTestId('incident-line')).toHaveLength(5);
    fireEvent.click(within(row).getByText('Hide incidents'));
    expect(screen.queryByTestId('one-off-list')).toBeNull();
    for (const inc of sap) expect(row.textContent).not.toContain(inc.Number);
  }, 20000);

  it('card week lines: last fully covered week when the data ends inside the selected week', async () => {
    ctx = contextFor(pbna);
    render(<FamiliesPage />);
    await screen.findByTestId('week-summary');
    const prev = availableWeeks(pbna)[availableWeeks(pbna).length - 2];
    for (const card of screen.getAllByTestId('group-card')) {
      expect(within(card).getByTestId('last-covered-line').textContent).toMatch(
        new RegExp(`^Last fully covered week \\(${weekRangeText(prev)}\\): \\d+ · (previous (\\d-week average|week) [\\d.]+ · [+−±]|New this period|no earlier weeks to compare)`));
    }
  });

  it('Quality filter changes only the visible population: no new computation, same groups', async () => {
    // syn_sap: the fictional file whose incidents carry more than one quality label.
    const week = availableWeeks(sap)[availableWeeks(sap).length - 3];
    ctx = contextFor(sap, week);
    const { unmount } = render(<FamiliesPage />);
    await screen.findByTestId('week-summary', {}, { timeout: 10000 });
    for (let k = 0; k < 10 && screen.queryByText(/^Show \d+ more group/); k++) fireEvent.click(screen.getByText(/^Show \d+ more group/));
    // Group names unfiltered: the filtered page shows a subset of the same groups (membership never changes).
    const before = new Set(screen.getAllByTestId('group-card').map(c => within(c).getByTestId('group-name').textContent));
    const requests = workerRequests.length;
    unmount();
    const scores = scoresOf.get(sap)!;
    // The most frequent quality label in the fictional file (it has more than one).
    const counts = new Map<string, number>();
    for (const s of scores) counts.set(s.label, (counts.get(s.label) ?? 0) + 1);
    const quality = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const good = new Set(sap.filter((_, i) => scores[i].label === quality));
    expect(good.size).toBeGreaterThan(0);
    expect(good.size).toBeLessThan(sap.length);
    ctx = contextFor(sap, week, undefined, quality);
    render(<FamiliesPage />);
    await screen.findByTestId('week-summary', {}, { timeout: 10000 });
    expect(workerRequests.length).toBe(requests);
    expect(Number(screen.getByTestId('kpi-total').textContent)).toBe([...good].filter(i => i.week === week).length);
    const segs = screen.getAllByTestId('distribution-segment');
    expect(segs.reduce((a, s) => a + Number(s.dataset.count), 0)).toBe(good.size);
    for (let k = 0; k < 10 && screen.queryByText(/^Show \d+ more group/); k++) fireEvent.click(screen.getByText(/^Show \d+ more group/));
    const after = screen.getAllByTestId('group-card').map(c => within(c).getByTestId('group-name').textContent);
    expect(after.length).toBeGreaterThan(0);
    for (const name of after) expect(before.has(name)).toBe(true);
  }, 30000);

  it('sort by selected week makes the selected week a primary card fact', async () => {
    ctx = contextFor(pbna, busyWeek);
    render(<FamiliesPage />);
    await screen.findByTestId('week-summary');
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'selectedWeek' } });
    for (const card of screen.getAllByTestId('group-card')) {
      const fact = within(card).getByTestId('fact-line');
      expect(fact.textContent).toMatch(/^\d+ this week/);
      expect(fact.compareDocumentPosition(within(card).getByTestId('card-service')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('"Show fewer" returns to 6 cards; hidden cards are never mounted', async () => {
    ctx = contextFor(pbna);
    render(<FamiliesPage />);
    await screen.findByTestId('week-summary');
    expect(screen.queryByText('Show fewer')).toBeNull();
    fireEvent.click(screen.getByText('Show 6 more groups'));
    expect(screen.getAllByTestId('group-card')).toHaveLength(12);
    fireEvent.click(screen.getByText('Show fewer'));
    expect(screen.getAllByTestId('group-card')).toHaveLength(6);
    expect(screen.queryByText(/^Show all/)).toBeNull();
  });

  it('names: "Remove repeated templates" uses the cleaned text of the same representative; "Original text" keeps today\'s names', async () => {
    ctx = contextFor(sap);
    render(<FamiliesPage />);
    await screen.findByTestId('week-summary', {}, { timeout: 10000 });
    const names = () => screen.getAllByTestId('group-name').map(n => [n.textContent!, n.getAttribute('title')!]);
    const r1 = names();
    for (const [shown, full] of r1) {
      expect(shown).toMatch(/^(Example: |Group without text)/);
      expect(full).toMatch(/^(Example: |Group without text)/);
      expect(shown.replace(/^Example: /, '').length).toBeLessThanOrEqual(FAMILIES_DISPLAY.cleanedNameMaxChars + 1);
      expect(shown).not.toMatch(/_|\.{2,}/);
    }
    openSettings();
    fireEvent.change(screen.getByLabelText(FAMILIES_COPY.textCleaning), { target: { value: 'R0' } });
    await waitFor(() => expect(screen.queryByTestId('updating')).toBeNull(), { timeout: 10000 });
    for (const [shown] of names()) expect(shown.replace(/^Example: /, '').length).toBeLessThanOrEqual(FAMILIES_DISPLAY.nameMaxChars + 1);
  }, 30000);

  it('above the compute guard shows the message and computes nothing', () => {
    const many: AnnotatedIncident[] = [];
    while (many.length <= FAMILIES_DISPLAY.maxRows) many.push(...pbna);
    ctx = contextFor(many);
    render(<FamiliesPage />);
    expect(screen.getByText(FAMILIES_COPY.tooLarge)).toBeInTheDocument();
    expect(workerConstructed).not.toHaveBeenCalled();
  });
});
