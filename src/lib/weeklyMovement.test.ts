import { describe, it, expect } from 'vitest';
import { annotateIncidents } from './problems';
import { availableWeeks, baselineWeeksFor, computeWeeklyDigest } from './weekly';
import { slaSignal } from './slaSignal';
import { many, syntheticIncident, syntheticScore, type SyntheticIncidentSpec } from '../test/fixtures/weeklyFixtures';

const PRINT = 'Printer offline on floor three';
const VPN = 'VPN connection drops every hour';
const MAIL = 'Email mailbox is full';
const NET = 'Network switch port down';
const DB = 'Database deadlock on reporting schema';

function digestFor(specs: SyntheticIncidentSpec[][], weekIndex = 4) {
  const incidents = annotateIncidents(specs.flat().map(syntheticIncident));
  const scores = incidents.map(i => syntheticScore(i.Number));
  const weeks = availableWeeks(incidents);
  return computeWeeklyDigest(incidents, scores, weeks[weekIndex])!;
}

describe('What moved this week — ordering and display values', () => {
  // Baseline weeks 0–3, current week 4.
  const specs = [
    ...[0, 1, 2, 3].map(week => [...many(10, { week, short: VPN }), ...many(4, { week, short: NET }), ...many(2, { week, short: MAIL })]),
    many(1, { week: 0, short: PRINT }),
    [...many(3, { week: 4, short: PRINT }), ...many(20, { week: 4, short: VPN }), ...many(8, { week: 4, short: NET }), ...many(6, { week: 4, short: MAIL }), ...many(3, { week: 4, short: DB })],
  ];

  it('orders by absolute change vs typical, not by percentage', () => {
    const d = digestFor(specs);
    const names = d.categoryMovements.map(m => m.name);
    // Printing: 3 vs 0.25 → +2.75 (+1100%); VPN: 20 vs 10 → +10 (+100%).
    const print = d.categoryMovements.find(m => m.name === 'Printing')!;
    const vpn = d.categoryMovements.find(m => m.name === 'VPN & Remote Access')!;
    expect(print.deltaPct).toBeGreaterThan(vpn.deltaPct);
    expect(names.indexOf('VPN & Remote Access')).toBeLessThan(names.indexOf('Printing'));
    expect(vpn).toMatchObject({ count: 20, typical: 10, change: 10, baseline: 10 });
    expect(print).toMatchObject({ count: 3, typical: 0.25, change: 2.75, baseline: 0.3 });
  });

  it('breaks equal absolute changes by this week’s count, then by name', () => {
    const d = digestFor(specs);
    const names = d.categoryMovements.map(m => m.name);
    // Network 8 vs 4 and Email 6 vs 2: both +4 → the larger count (Network) first.
    expect(names.indexOf('Network & Connectivity')).toBeLessThan(names.indexOf('Email & Collaboration'));
  });

  it('a category with no baseline has typical 0 (shown as "New this period")', () => {
    const db = digestFor(specs).categoryMovements.find(m => m.name === 'Database')!;
    expect(db).toMatchObject({ count: 3, typical: 0, change: 3 });
  });

  it('keeps the existing baseline window and volume baseline unchanged', () => {
    const d = digestFor(specs);
    const incidents = annotateIncidents(specs.flat().map(syntheticIncident));
    const weeks = availableWeeks(incidents);
    expect(baselineWeeksFor(weeks, weeks[4])).toEqual(weeks.slice(0, 4));
    expect(baselineWeeksFor(weeks, weeks[1])).toEqual(weeks.slice(0, 1));
    expect(baselineWeeksFor(weeks, 'missing-week')).toEqual([]);
    // (10+4+2)×4 + 1 = 65 over 4 weeks.
    expect(d.baselineCount).toBe(16.3);
    expect(d.current.count).toBe(40);
  });
});

describe('SLA signal on the Weekly population', () => {
  it('stays informative when the population varies even if the selected week has a single value', () => {
    const incidents = annotateIncidents([
      ...many(3, { week: 0, madeSla: true }), ...many(1, { week: 0, madeSla: false }),
      ...many(4, { week: 1, madeSla: true }),
    ].map(syntheticIncident));
    const selectedWeek = incidents.filter(i => i.week === availableWeeks(incidents)[1]);
    expect(slaSignal(selectedWeek, true).state).toBe('no-signal');
    expect(slaSignal(incidents, true)).toEqual({ state: 'available', tracked: 8, breachPct: 13 });
  });
});
