import { describe, it, expect } from 'vitest';
import { computePeriodTrends } from './trends';
import { computeWeeklyDigest, availableWeeks } from './weekly';
import { annotateIncidents, type AnnotatedIncident } from './problems';
import type { EnrichedIncident, NoteEntry } from './parser';
import type { IncidentScore } from './scorer';

function note(text: string): NoteEntry {
  return { timestamp: '', author: 'A. Tech', text, isSystem: false };
}

let seq = 0;
function incident(overrides: Partial<EnrichedIncident> = {}): EnrichedIncident {
  const humanNotes = overrides.humanNotes ?? [];
  return {
    Number: `INC${String(++seq).padStart(5, '0')}`,
    'Task type': 'Incident',
    Priority: '3 - Moderate',
    State: 'Closed',
    'Short description': '',
    Description: '',
    'Work notes': '',
    'Assignment group': 'Service Desk',
    'Assigned to': 'A. Tech',
    Opened: '2025-03-04 09:00:00',
    Closed: '2025-03-04 11:00:00',
    Channel: 'Phone',
    'Made SLA': true,
    shortDescClean: '',
    descClean: '',
    allNotes: humanNotes,
    humanNotes,
    isAutoDesc: false,
    ...overrides,
  };
}

function score(number: string, totalScore = 60): IncidentScore {
  return {
    number,
    totalScore,
    label: totalScore >= 80 ? 'Excellent' : totalScore >= 55 ? 'Good' : totalScore >= 30 ? 'Poor' : 'Critical',
    color: '',
    dimScores: {
      description_quality: 60, root_cause: 100, steps_documented: 100,
      spelling_grammar: 95, professionalism: 80,
    },
    feedback: [], noiseRatio: 0, noteCount: 1, noteChars: 80,
  };
}

/** Monday of ISO weeks 10, 11, 12 and 13 of 2025. */
const MONDAYS = ['2025-03-03', '2025-03-10', '2025-03-17', '2025-03-24'];

function withScores(incidents: AnnotatedIncident[]) {
  return { incidents, scores: incidents.map(i => score(i.Number)) };
}

describe('computePeriodTrends', () => {
  it('buckets by ISO week in chronological order', () => {
    const { incidents, scores } = withScores(annotateIncidents([
      incident({ Opened: `${MONDAYS[0]} 09:00:00` }),
      incident({ Opened: `${MONDAYS[1]} 09:00:00` }),
      incident({ Opened: `${MONDAYS[1]} 14:00:00` }),
    ]));

    const trends = computePeriodTrends(incidents, scores, 'week');
    expect(trends.map(t => t.key)).toEqual(['2025-W10', '2025-W11']);
    expect(trends[1].count).toBe(2);
  });

  it('buckets by month when asked', () => {
    const { incidents, scores } = withScores(annotateIncidents([
      incident({ Opened: '2025-03-04 09:00:00' }),
      incident({ Opened: '2025-04-04 09:00:00' }),
    ]));

    expect(computePeriodTrends(incidents, scores, 'month').map(t => t.key))
      .toEqual(['2025-03', '2025-04']);
  });

  it('reports resolution time, SLA and open count per period', () => {
    const { incidents, scores } = withScores(annotateIncidents([
      incident({ Opened: `${MONDAYS[0]} 09:00:00`, Closed: `${MONDAYS[0]} 11:00:00` }),
      incident({ Opened: `${MONDAYS[0]} 09:00:00`, Closed: `${MONDAYS[0]} 13:00:00`, 'Made SLA': false }),
      incident({ Opened: `${MONDAYS[0]} 09:00:00`, Closed: '', State: 'In Progress' }),
    ]));

    const [week] = computePeriodTrends(incidents, scores, 'week');
    expect(week.medianResolutionHours).toBe(3);
    expect(week.slaBreachPct).toBe(50);
    expect(week.openCount).toBe(1);
  });

  it('reports SLA breach as unknown when the export has no Made SLA values', () => {
    const { incidents, scores } = withScores(annotateIncidents([
      incident({ Opened: `${MONDAYS[0]} 09:00:00`, 'Made SLA': null }),
      incident({ Opened: `${MONDAYS[0]} 09:00:00`, 'Made SLA': null }),
    ]));

    expect(computePeriodTrends(incidents, scores, 'week')[0].slaBreachPct).toBeNull();
  });

  it('reports root cause coverage per period', () => {
    const { incidents, scores } = withScores(annotateIncidents([
      incident({ Opened: `${MONDAYS[0]} 09:00:00`, humanNotes: [note('Root cause was a disk full condition.')] }),
      incident({ Opened: `${MONDAYS[0]} 09:00:00` }),
    ]));

    expect(computePeriodTrends(incidents, scores, 'week')[0].rcaCoveragePct).toBe(50);
  });

  it('skips incidents with no usable date', () => {
    const { incidents, scores } = withScores(annotateIncidents([incident({ Opened: '' })]));
    expect(computePeriodTrends(incidents, scores, 'week')).toEqual([]);
  });
});

describe('computeWeeklyDigest', () => {
  /** Three quiet weeks of VPN tickets, then a spike week with a new problem. */
  function dataset() {
    const rows: EnrichedIncident[] = [];
    for (const monday of MONDAYS.slice(0, 3)) {
      for (let i = 0; i < 4; i++) {
        rows.push(incident({
          shortDescClean: 'VPN connection keeps dropping for remote staff',
          Opened: `${monday} 09:00:00`,
          Closed: `${monday} 11:00:00`,
          humanNotes: [note('Root cause was an expired gateway certificate.')],
        }));
      }
    }
    // Spike week: the usual VPN load plus a burst of printer failures.
    for (let i = 0; i < 4; i++) {
      rows.push(incident({
        shortDescClean: 'VPN connection keeps dropping for remote staff',
        Opened: `${MONDAYS[3]} 09:00:00`,
        Closed: `${MONDAYS[3]} 11:00:00`,
      }));
    }
    for (let i = 0; i < 6; i++) {
      rows.push(incident({
        shortDescClean: 'Printer on floor 3 is offline and will not print',
        Opened: `${MONDAYS[3]} 10:00:00`,
        Closed: `${MONDAYS[3]} 12:00:00`,
      }));
    }
    return withScores(annotateIncidents(rows));
  }

  it('lists every week present in the data', () => {
    const { incidents } = dataset();
    expect(availableWeeks(incidents)).toEqual(['2025-W10', '2025-W11', '2025-W12', '2025-W13']);
  });

  it('compares the week against the preceding baseline', () => {
    const { incidents, scores } = dataset();
    const digest = computeWeeklyDigest(incidents, scores, '2025-W13')!;

    expect(digest.incidentCount).toBe(10);
    expect(digest.baselineCount).toBe(4);
    expect(digest.volumeDeltaPct).toBe(150);
    expect(digest.previous?.key).toBe('2025-W12');
  });

  it('surfaces the category that spiked', () => {
    const { incidents, scores } = dataset();
    const digest = computeWeeklyDigest(incidents, scores, '2025-W13')!;

    const printing = digest.categoryMovements.find(m => m.name === 'Printing');
    expect(printing).toBeDefined();
    expect(printing!.direction).toBe('up');
    expect(printing!.count).toBe(6);
  });

  it('separates newly appearing problems from ones already recurring', () => {
    const { incidents, scores } = dataset();
    const digest = computeWeeklyDigest(incidents, scores, '2025-W13')!;

    expect(digest.newProblems.map(p => p.category)).toContain('Printing');
    expect(digest.recurringProblems.map(p => p.category)).toContain('VPN & Remote Access');
    // The VPN problem's week span reflects the whole dataset, not just this week.
    expect(digest.recurringProblems[0].weeksActive).toBe(4);
  });

  it('recommends acting on the undocumented spike', () => {
    const { incidents, scores } = dataset();
    const digest = computeWeeklyDigest(incidents, scores, '2025-W13')!;

    expect(digest.actions.some(a => a.kind === 'problem-management')).toBe(true);
  });

  it('treats the first week as having no baseline', () => {
    const { incidents, scores } = dataset();
    const digest = computeWeeklyDigest(incidents, scores, '2025-W10')!;

    expect(digest.previous).toBeNull();
    expect(digest.baselineCount).toBe(0);
    expect(digest.volumeDeltaPct).toBe(0);
    expect(digest.newProblems.length + digest.recurringProblems.length).toBeGreaterThan(0);
  });

  it('returns null for a week with no incidents', () => {
    const { incidents, scores } = dataset();
    expect(computeWeeklyDigest(incidents, scores, '2025-W40')).toBeNull();
    expect(computeWeeklyDigest([], [], '2025-W10')).toBeNull();
  });
});
