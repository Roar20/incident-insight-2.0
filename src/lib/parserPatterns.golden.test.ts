/**
 * Golden behaviour of the parser's instance/tool text patterns.
 *
 * Written against the parser before its patterns moved to `src/config/patterns.ts`,
 * and must keep passing unedited afterwards: the move is a relocation, not a
 * change. The phrases are spelled out here on purpose rather than imported, so
 * the test cannot follow an accidental edit to the registry.
 */
import { describe, it, expect } from 'vitest';
import { enrichRow } from './parser';
import { scoreIncident } from './scorer';

const header = (author: string, label = 'Work notes') => `2025-03-04 09:00:00 - ${author} (${label})`;
const journal = (...entries: [author: string, text: string][]) =>
  entries.map(([author, text]) => `${header(author)}\n${text}`).join('\n');

const SYSTEM_PHRASES = [
  'sent communication to', 'could not contact', 'task is created by system',
  'escalation is in progress', 'escalate in', 'faq on alerts',
  'predicted ag:', 'attachment added', 'why was this incident created',
  'how is the priority', 'confidence:',
];

const AUTO_DESC_KEYWORDS = [
  'we have identified unusually', 'alert triggered at', 'usage overview',
  'cluster name', 'namespace :', 'container name:', 'pod name:',
  'document count:', 'conditions met:', 'links for investigation',
];

describe('parser instance/tool patterns (golden)', () => {
  it('marks a note as system when it contains any system phrase, in any case', () => {
    for (const phrase of SYSTEM_PHRASES) {
      for (const text of [`Note: ${phrase} the caller`, `NOTE: ${phrase.toUpperCase()} THE CALLER`]) {
        const [note] = enrichRow({ 'Work notes': journal(['A. Tech', text]) }).allNotes;
        expect(note.isSystem, `${phrase} / ${text}`).toBe(true);
      }
    }
  });

  it('marks a note as system only when its author is exactly "system", in any case', () => {
    const authors: [string, boolean][] = [
      ['System', true], ['SYSTEM', true], ['system', true],
      ['Systems Admin', false], ['System Integration', false], ['A. Tech', false],
    ];
    for (const [author, isSystem] of authors) {
      const [note] = enrichRow({ 'Work notes': journal([author, 'Checked the queue and cleared it.']) }).allNotes;
      expect(note.isSystem, author).toBe(isSystem);
    }
  });

  it('treats a note matching no pattern, and headerless text, as human (current behaviour)', () => {
    const plain = enrichRow({ 'Work notes': journal(['A. Tech', 'Restarted the adapter.']) });
    expect(plain.humanNotes).toHaveLength(1);
    const headerless = enrichRow({ 'Work notes': 'Rebooted the server, all good now.' });
    expect(headerless.allNotes.map(n => [n.author, n.isSystem])).toEqual([['Unknown', false]]);
    expect(headerless.humanNotes).toHaveLength(1);
  });

  it('flags a monitoring-generated description for every keyword, in any case', () => {
    for (const keyword of AUTO_DESC_KEYWORDS) {
      expect(enrichRow({ Description: `Header. ${keyword} 42` }).isAutoDesc, keyword).toBe(true);
      expect(enrichRow({ Description: `HEADER. ${keyword.toUpperCase()} 42` }).isAutoDesc, keyword).toBe(true);
    }
    // Exact spelling matters: these near-misses are not keywords today.
    for (const text of ['namespace: prod', 'alert triggered', 'cluster-name x', 'User reports the VPN drops hourly.']) {
      expect(enrichRow({ Description: text }).isAutoDesc, text).toBe(false);
    }
  });

  it('produces the same notes and scores for representative incidents', () => {
    const cases: [Record<string, unknown>, unknown][] = [
      [{
        Number: 'INC1', State: 'Closed', 'Short description': 'Disk full on reporting server',
        Description: 'Users cannot save reports. Root cause: log rotation disabled.',
        'Work notes': [
          header('A. Tech'), 'Cleared old logs and restarted the service.',
          header('System'), 'Task is created by system',
          header('B. Tech', 'Additional comments'), 'FAQ on alerts: see wiki',
          header('C. Tech'), 'Predicted AG: Storage team',
        ].join('\n'),
      }, {
        notes: [['A. Tech', false], ['System', true], ['B. Tech', true], ['C. Tech', true]], human: 1, isAutoDesc: false, total: 92,
        dims: { description_quality: 70, root_cause: 100, steps_documented: 100, spelling_grammar: 95, professionalism: 100 }, noiseRatio: 0,
      }],
      [{ Number: 'INC2', State: 'Closed', 'Work notes': 'Rebooted the server, all good now.' }, {
        notes: [['Unknown', false]], human: 1, isAutoDesc: false, total: 29,
        dims: { description_quality: 0, root_cause: 0, steps_documented: 0, spelling_grammar: 95, professionalism: 100 }, noiseRatio: 0,
      }],
      [{ Number: 'INC3', State: 'New', 'Short description': 'CPU alert', Description: 'ALERT TRIGGERED AT 03:15 UTC. Cluster Name: x' }, {
        notes: [], human: 0, isAutoDesc: true, total: 46,
        dims: { description_quality: 42, root_cause: 0, steps_documented: 30, spelling_grammar: 95, professionalism: 100 }, noiseRatio: 0,
      }],
      [{
        Number: 'INC4', State: 'Closed', 'Short description': 'Printer offline in office',
        'Work notes': [header('system'), 'Sent communication to caller', header('SYSTEM'), 'Could not contact the user'].join('\n'),
      }, {
        notes: [['system', true], ['SYSTEM', true]], human: 0, isAutoDesc: false, total: 39,
        dims: { description_quality: 40, root_cause: 0, steps_documented: 0, spelling_grammar: 95, professionalism: 100 }, noiseRatio: 0,
      }],
    ];

    for (const [row, expected] of cases) {
      const inc = enrichRow(row);
      const score = scoreIncident(inc);
      expect({
        notes: inc.allNotes.map(n => [n.author, n.isSystem]),
        human: inc.humanNotes.length,
        isAutoDesc: inc.isAutoDesc,
        total: score.totalScore,
        dims: score.dimScores,
        noiseRatio: score.noiseRatio,
      }, String(row.Number)).toEqual(expected);
    }
  });
});
