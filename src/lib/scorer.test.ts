import { describe, it, expect } from 'vitest';
import { scoreIncident, scoreAll } from './scorer';
import type { EnrichedIncident } from './parser';
import type { NoteEntry } from './parser';

function note(text: string, author = 'A. Tech'): NoteEntry {
  return { timestamp: '2025-03-04 10:00:00', author, text, isSystem: false };
}

/** A minimal incident; override only the fields a test cares about. */
function incident(overrides: Partial<EnrichedIncident> = {}): EnrichedIncident {
  const humanNotes = overrides.humanNotes ?? [];
  return {
    Number: 'INC0001',
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

describe('scoreIncident', () => {
  it('scores a well-documented incident as Excellent', () => {
    const result = scoreIncident(incident({
      shortDescClean: 'Outlook fails to sync mailbox for finance users',
      descClean: 'Multiple finance users report that Outlook stops syncing after the morning maintenance window. '
        + 'Affected users cannot send or receive mail and the send/receive pane reports a credential prompt loop.',
      humanNotes: [
        note('Investigation showed the root cause was an expired service principal certificate on the sync connector.'),
        note('Applied the renewed certificate and restarted the sync service. Verified mail flow for three affected users.'),
      ],
    }));

    expect(result.label).toBe('Excellent');
    expect(result.totalScore).toBeGreaterThanOrEqual(80);
    expect(result.dimScores.root_cause).toBe(100);
    expect(result.dimScores.steps_documented).toBe(100);
  });

  it('scores an empty incident as Critical with actionable feedback', () => {
    const result = scoreIncident(incident());

    expect(result.label).toBe('Critical');
    expect(result.dimScores.root_cause).toBe(0);
    expect(result.feedback).toContain('Short description is missing or too short.');
    expect(result.feedback).toContain('Description is empty or too short.');
    expect(result.feedback).toContain('No root cause documented.');
    expect(result.feedback).toContain('No human work notes found.');
  });

  it('penalises a closed incident harder than an open one for missing steps', () => {
    const fields = { shortDescClean: 'Printer on floor 3 is offline again' };
    const closed = scoreIncident(incident({ ...fields, State: 'Closed' }));
    const open = scoreIncident(incident({ ...fields, State: 'In Progress' }));

    expect(closed.dimScores.steps_documented).toBe(0);
    expect(open.dimScores.steps_documented).toBe(30);
    expect(closed.feedback).toContain('Closed without documenting resolution steps.');
  });

  it('recognises Spanish root cause and resolution wording', () => {
    const result = scoreIncident(incident({
      humanNotes: [note('Se identificó que la causa raíz era un disco lleno en el servidor de archivos.')],
    }));

    expect(result.dimScores.root_cause).toBe(100);
  });

  it('treats boilerplate work notes as noise', () => {
    const result = scoreIncident(incident({
      humanNotes: [
        note('Hi team, please assist the user'),
        note('N/A'),
        note('Attachment added'),
      ],
    }));

    expect(result.noiseRatio).toBe(1);
    expect(result.dimScores.professionalism).toBeLessThan(50);
  });

  it('reports a zero noise ratio when there are no human notes', () => {
    const result = scoreIncident(incident());

    expect(result.noiseRatio).toBe(0);
    expect(result.noteCount).toBe(0);
    expect(result.noteChars).toBe(0);
  });

  it('flags informal language in the professionalism score', () => {
    const clean = scoreIncident(incident({
      humanNotes: [note('Restarted the print spooler service and confirmed the queue drained.')],
    }));
    const slangy = scoreIncident(incident({
      humanNotes: [note('Restarted the print spooler, gonna check the queue later, status TBD.')],
    }));

    expect(slangy.dimScores.professionalism).toBeLessThan(clean.dimScores.professionalism);
    expect(slangy.feedback).toContain('Informal: gonna');
    expect(slangy.feedback).toContain('Vague: TBD');
  });

  it('gives auto-generated descriptions partial credit rather than zero', () => {
    const auto = scoreIncident(incident({
      shortDescClean: 'Elasticsearch document count anomaly detected in prod cluster',
      descClean: 'We have identified unusually high document count. Cluster name: prod-eu-1',
      isAutoDesc: true,
    }));
    const empty = scoreIncident(incident({
      shortDescClean: 'Elasticsearch document count anomaly detected in prod cluster',
    }));

    expect(auto.dimScores.description_quality).toBeGreaterThan(empty.dimScores.description_quality);
    expect(auto.feedback).toContain('Description is auto-generated from monitoring alert.');
  });

  it('keeps the total score within 0-100 and consistent with its label', () => {
    const results = [
      scoreIncident(incident()),
      scoreIncident(incident({ shortDescClean: 'A moderately descriptive short description here' })),
      scoreIncident(incident({
        shortDescClean: 'Outlook fails to sync mailbox for finance users',
        descClean: 'x'.repeat(200),
        humanNotes: [note('Root cause was a stale DNS entry. Applied the corrected record and verified resolution.')],
      })),
    ];

    for (const r of results) {
      expect(r.totalScore).toBeGreaterThanOrEqual(0);
      expect(r.totalScore).toBeLessThanOrEqual(100);
      const expected = r.totalScore >= 80 ? 'Excellent'
        : r.totalScore >= 55 ? 'Good'
        : r.totalScore >= 30 ? 'Poor'
        : 'Critical';
      expect(r.label).toBe(expected);
    }
  });
});

describe('scoreAll', () => {
  it('returns one score per incident, keyed by incident number', () => {
    const scores = scoreAll([
      incident({ Number: 'INC0001' }),
      incident({ Number: 'INC0002' }),
    ]);

    expect(scores.map(s => s.number)).toEqual(['INC0001', 'INC0002']);
  });

  it('returns an empty array for no incidents', () => {
    expect(scoreAll([])).toEqual([]);
  });
});
