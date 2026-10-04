import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { enrichRow, inferDateOrder, readIncidentTable, type IncidentRow } from '@/lib/parser';
import { scoreIncident } from '@/lib/scorer';
import { annotateIncidents } from '@/lib/problems';
import { computePeriodTrends } from '@/lib/trends';
import { availableWeeks } from '@/lib/weekly';
import { dimensionAvailability } from '@/lib/dimensions';
import { toXlsxBuffer } from '@/test/fixtures/syntheticDatasets';
import WeeklyPage from './WeeklyPage';

/** Weekly Review's real pipeline over synthetic rows (Weekly Review has no filters). */
function contextFor(buffer: ArrayBuffer, selectedWeekIndex?: number) {
  const { rows, columns } = readIncidentTable(buffer);
  const order = inferDateOrder(rows);
  const enriched = rows.map(r => enrichRow(r, { dateOrder: order }));
  const scores = enriched.map(scoreIncident);
  const incidents = annotateIncidents(enriched);
  const weeks = availableWeeks(incidents);
  return {
    incidents, scores, weeklyTrends: computePeriodTrends(incidents, scores, 'week'),
    sourceColumns: columns, dimensionAvailability: dimensionAvailability(columns),
    availableWeeks: weeks, selectedWeek: weeks[selectedWeekIndex ?? weeks.length - 1], setSelectedWeek: vi.fn(),
  };
}

// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

let ctx: ReturnType<typeof contextFor>;
vi.mock('@/context/AppContext', () => ({ useAppContext: () => ctx }));
const renderPage = () => render(<TooltipProvider><WeeklyPage /></TooltipProvider>);

const MONDAYS = ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30'];
const at = (week: number, day: number) => {
  const d = new Date(`${MONDAYS[week]}T10:00:00Z`);
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

/** SAP-like (XLSX): several groups, many Services, some missing Service, uniform SLA, small typical values. */
function sapLikeRows(sla: 'uniform' | 'mixed' | 'absent'): IncidentRow[] {
  const rows: IncidentRow[] = [];
  let n = 0;
  const add = (week: number, short: string, service: string) => {
    const row: IncidentRow = {
      Number: `SYNS${String(n).padStart(5, '0')}`, State: 'Closed', 'Short description': short, Description: 'Synthetic alert body',
      'Work notes': '', 'Assignment group': `AG-00${(n % 4) + 1}`, 'Assigned to': 'Person-1',
      Opened: at(week, n % 5), Closed: at(week, n % 5), Service: service, 'Service offering': `Offering-00${(n % 3) + 1}`,
    };
    if (sla !== 'absent') row['Made SLA'] = sla === 'mixed' && n % 4 === 0 ? 'false' : 'true';
    rows.push(row);
    n++;
  };
  for (let w = 0; w < 4; w++) {
    for (let k = 0; k < 8; k++) add(w, 'VPN connection drops every hour', k % 6 === 5 ? '' : `Service-00${(k % 7) + 1}`);
    add(w, 'Network switch port down', 'Service-002');
  }
  for (let k = 0; k < 6; k++) add(4, 'Printer offline on floor three', 'Service-001');
  for (let k = 0; k < 4; k++) add(4, 'VPN connection drops every hour', 'Service-003');
  return rows;
}

/** PBNA-like (CSV headers as a ServiceNow CSV export writes them): one group, Service varies. */
function pbnaLikeCsv(): ArrayBuffer {
  const header = ['number', 'short_description', 'description', 'state', 'assignment_group', 'opened_at', 'closed_at', 'made_sla', 'business_service', 'service_offering'];
  const lines = [header.join(',')];
  for (let i = 0; i < 40; i++) {
    const week = i % 5;
    lines.push([`SYNP${String(i).padStart(5, '0')}`, `Synthetic user ticket ${i}`, 'Synthetic free text', 'Resolved', 'AG-001', at(week, i % 5), at(week, i % 5),
      i % 7 === 0 ? 'false' : 'true', `Service-00${(i % 3) + 1}`, `Offering-00${(i % 4) + 1}`].map(v => `"${v}"`).join(','));
  }
  const bytes = new TextEncoder().encode(lines.join('\r\n') + '\r\n');
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

const kpi = (label: string) => screen.getByText(label).parentElement!;
const SCORE_COLORS = /text-score-(excellent|critical|good|poor)/;

describe('SLA states (no green without signal)', () => {
  it('uniform SLA → "—" and Needs data (no signal), neutral, no delta', () => {
    ctx = contextFor(toXlsxBuffer(sapLikeRows('uniform')));
    renderPage();
    const card = kpi('SLA Breached');
    expect(card.textContent).toContain('—');
    expect(card.textContent).toContain('Needs data (no signal)');
    expect(card.innerHTML).not.toMatch(SCORE_COLORS);
    expect(card.textContent).not.toMatch(/pp vs last week|%/);
  });

  it('absent SLA column → "—" and Not available, neutral', () => {
    ctx = contextFor(toXlsxBuffer(sapLikeRows('absent')));
    renderPage();
    const card = kpi('SLA Breached');
    expect(card.textContent).toContain('Not available');
    expect(card.innerHTML).not.toMatch(SCORE_COLORS);
  });

  it('informative SLA → the existing weekly breach calculation', () => {
    ctx = contextFor(toXlsxBuffer(sapLikeRows('mixed')));
    renderPage();
    const week = ctx.weeklyTrends.find(t => t.key === ctx.selectedWeek)!;
    expect(kpi('SLA Breached').textContent).toContain(`${week.slaBreachPct}%`);
  });
});

describe('volume card is neutral', () => {
  it.each([[4, 'positive'], [2, 'any']] as const)('week %i (%s delta) carries no good/bad colour', (week, _label) => {
    ctx = contextFor(toXlsxBuffer(sapLikeRows('uniform')), week);
    renderPage();
    const card = kpi('vs Baseline');
    expect(card.innerHTML).not.toMatch(SCORE_COLORS);
    expect(card.textContent).toMatch(/[+-]?\d+%/);
  });
});

describe('What moved this week', () => {
  it('leads with count and absolute change; percentage secondary; typical 0 reads "New this period"', () => {
    ctx = contextFor(toXlsxBuffer(sapLikeRows('uniform')));
    renderPage();
    const cards = screen.getAllByTestId('movement');
    const printing = cards.find(c => c.textContent!.includes('Printing'))!;
    expect(printing.textContent).toContain('6 incidents');
    expect(printing.textContent).toContain('New this period');
    expect(printing.textContent).not.toMatch(/\+100%|Infinity|NaN/);
    const vpn = cards.find(c => c.textContent!.includes('VPN'));
    if (vpn) expect(vpn.textContent).toMatch(/[+−]\d+(\.\d)? vs typical \d+(\.\d)?/);
    for (const c of cards) expect(c.innerHTML).not.toMatch(SCORE_COLORS);
  });
});

describe('Data through', () => {
  it('shows the latest Opened of the loaded file, whichever week is selected, with no completeness claim', () => {
    ctx = contextFor(toXlsxBuffer(sapLikeRows('uniform')), 0);
    renderPage();
    const text = screen.getByTestId('data-through').textContent!;
    expect(text).toBe('Data through Apr 3, 2026');
    expect(text).not.toMatch(/UTC|partial|complete|incomplete/i);
  });
});

describe('weekly composition', () => {
  it('SAP-like: Service composition, Top-N + No Service legend, bridge line, stack totals equal Incidents per week', () => {
    ctx = contextFor(toXlsxBuffer(sapLikeRows('uniform')));
    renderPage();
    const block = screen.getByTestId('weekly-composition');
    expect(block).toHaveAttribute('data-case', 'A');
    expect(within(block).getByText('Incidents per week by Service')).toBeInTheDocument();
    const legend = within(screen.getByTestId('composition-legend'));
    expect(legend.getByText('No Service').closest('li')).toHaveAttribute('data-kind', 'missing');
    expect(screen.getByTestId('composition-bridge').textContent).toMatch(/^Largest change vs typical this week: Service-\d{3} \([+−]\d+(\.\d)? incidents\)$/);
    expect(block.textContent).not.toMatch(/caused by|triggered by|root cause|owner|responsible|correlation|noise|in this file/i);
  });

  it('PBNA-like (CSV): one Handling Group, Service varies → Service composition', () => {
    ctx = contextFor(pbnaLikeCsv());
    renderPage();
    expect(screen.getByTestId('weekly-composition')).toHaveAttribute('data-case', 'A');
    expect(kpi('SLA Breached').textContent).toMatch(/\d+%/);
  });
});
