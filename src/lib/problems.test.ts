import { describe, it, expect } from 'vitest';
import {
  annotateIncidents, computeProblemClusters, computeCategoryStats, recommendActions,
  type AnnotatedIncident,
} from './problems';
import { extractRootCause } from './rootCause';
import { categorize } from './taxonomy';
import { isoWeek, weekKey, weekLabel, resolutionHours, formatDuration } from './periods';
import { jaccard, tokenize, normalizedKey } from './text';
import type { EnrichedIncident, NoteEntry } from './parser';
import type { IncidentScore } from './scorer';

function note(text: string): NoteEntry {
  return { timestamp: '2025-03-04 10:00:00', author: 'A. Tech', text, isSystem: false };
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

describe('text helpers', () => {
  it('drops stopwords, punctuation and per-instance identifiers', () => {
    const tokens = tokenize('INC0012345 - The user cannot connect to the VPN from host ws-4471a');

    expect(tokens).toContain('connect');
    expect(tokens).toContain('vpn');
    expect(tokens).not.toContain('user');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('inc0012345');
    expect(tokens).not.toContain('ws');
  });

  it('measures overlap between token sets', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(['a', 'b']), new Set(['c', 'd']))).toBe(0);
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
  });

  it('gives reordered wording the same normalized key', () => {
    expect(normalizedKey('expired certificate on the sync connector'))
      .toBe(normalizedKey('the sync connector certificate expired'));
  });
});

describe('extractRootCause', () => {
  it('keeps the whole sentence so the cause stands on its own', () => {
    expect(extractRootCause('Mail stopped flowing because the service certificate had expired.'))
      .toBe('Mail stopped flowing because the service certificate had expired.');
  });

  it('picks the sentence containing the marker out of a longer note', () => {
    const note = 'Spoke to the user. The print spooler crashed because of a corrupt driver. Reinstalled it.';
    expect(extractRootCause(note)).toBe('The print spooler crashed because of a corrupt driver.');
  });

  it('returns the whole sentence for an explicit root-cause statement', () => {
    const text = 'Checked the logs. Root cause was a full disk on the file server. Cleared old backups.';
    expect(extractRootCause(text)).toBe('Root cause was a full disk on the file server.');
  });

  it('finds Spanish root cause wording', () => {
    expect(extractRootCause('Se identificó que el disco estaba lleno.'))
      .toContain('disco');
  });

  it('returns an empty string when no cause is documented', () => {
    expect(extractRootCause('Restarted the service. Confirmed with the user.')).toBe('');
    expect(extractRootCause('')).toBe('');
  });
});

describe('categorize', () => {
  it('sorts incidents into service categories', () => {
    expect(categorize('Cannot connect to VPN from home')).toBe('VPN & Remote Access');
    expect(categorize('Password reset required for account')).toBe('Account & Access');
    expect(categorize('Printer on floor 3 is offline')).toBe('Printing');
    expect(categorize('Outlook mailbox not syncing')).toBe('Email & Collaboration');
    expect(categorize('Something entirely unrelated happened')).toBe('Other / Uncategorised');
  });

  it('falls back to the description when the short description is uninformative', () => {
    expect(categorize('issue', 'The wifi keeps dropping in the north building')).toBe('Network & Connectivity');
  });
});

describe('period helpers', () => {
  it('computes ISO week numbers', () => {
    // 2025-01-01 is a Wednesday, so it falls in ISO week 1 of 2025.
    expect(isoWeek(new Date(Date.UTC(2025, 0, 1)))).toEqual({ year: 2025, week: 1 });
    // 2024-12-30 is a Monday belonging to ISO week 1 of 2025.
    expect(isoWeek(new Date(Date.UTC(2024, 11, 30)))).toEqual({ year: 2025, week: 1 });
    expect(isoWeek(new Date(Date.UTC(2025, 2, 4)))).toEqual({ year: 2025, week: 10 });
  });

  it('builds and labels week keys', () => {
    expect(weekKey('2025-03-04 09:00:00')).toBe('2025-W10');
    expect(weekKey('')).toBe('');
    expect(weekKey('not a date')).toBe('');
    expect(weekLabel('2025-W10')).toContain('W10');
  });

  it('measures resolution time and rejects impossible values', () => {
    expect(resolutionHours('2025-03-04 09:00:00', '2025-03-04 11:30:00')).toBe(2.5);
    expect(resolutionHours('2025-03-04 09:00:00', '')).toBeNull();
    // Closed before it opened.
    expect(resolutionHours('2025-03-04 11:00:00', '2025-03-04 09:00:00')).toBeNull();
  });

  it('formats durations for a service desk', () => {
    expect(formatDuration(0.5)).toBe('30m');
    expect(formatDuration(3.25)).toBe('3.3h');
    expect(formatDuration(72)).toBe('3d');
    expect(formatDuration(null)).toBe('—');
  });
});

describe('annotateIncidents', () => {
  it('groups differently-worded reports of the same problem', () => {
    const incidents = annotateIncidents([
      incident({ shortDescClean: 'VPN connection keeps dropping for remote staff' }),
      incident({ shortDescClean: 'VPN connection dropping for remote staff members' }),
      incident({ shortDescClean: 'Printer on floor 3 is offline' }),
    ]);

    expect(incidents[0].clusterId).toBe(incidents[1].clusterId);
    expect(incidents[2].clusterId).not.toBe(incidents[0].clusterId);
  });

  it('does not merge different problems that share a category', () => {
    const incidents = annotateIncidents([
      incident({ shortDescClean: 'Outlook mailbox will not synchronise' }),
      incident({ shortDescClean: 'Outlook calendar invitations missing entirely' }),
    ]);

    expect(incidents[0].category).toBe('Email & Collaboration');
    expect(incidents[1].category).toBe('Email & Collaboration');
    expect(incidents[0].clusterId).not.toBe(incidents[1].clusterId);
  });

  it('annotates category, root cause, week and resolution time', () => {
    const [inc] = annotateIncidents([
      incident({
        shortDescClean: 'Cannot connect to VPN',
        Opened: '2025-03-04 09:00:00',
        Closed: '2025-03-04 12:00:00',
        humanNotes: [note('Investigation found the root cause was an expired gateway certificate.')],
      }),
    ]);

    expect(inc.category).toBe('VPN & Remote Access');
    expect(inc.rootCauseText).toContain('certificate');
    expect(inc.week).toBe('2025-W10');
    expect(inc.resolutionHours).toBe(3);
    expect(inc.isClosed).toBe(true);
  });

  it('gives incidents with no distinctive wording their own cluster', () => {
    const incidents = annotateIncidents([
      incident({ shortDescClean: '' }),
      incident({ shortDescClean: '' }),
    ]);

    expect(incidents[0].clusterId).not.toBe(incidents[1].clusterId);
  });

  it('handles an empty dataset', () => {
    expect(annotateIncidents([])).toEqual([]);
  });
});

describe('computeProblemClusters', () => {
  function vpnDataset(): { incidents: AnnotatedIncident[]; scores: IncidentScore[] } {
    const incidents = annotateIncidents([
      incident({
        shortDescClean: 'VPN connection keeps dropping for remote staff',
        Opened: '2025-03-04 09:00:00', Closed: '2025-03-04 11:00:00',
        humanNotes: [note('Root cause was an expired gateway certificate.')],
      }),
      incident({
        shortDescClean: 'VPN connection dropping for remote staff members',
        Opened: '2025-03-11 09:00:00', Closed: '2025-03-11 10:00:00',
        humanNotes: [note('The gateway certificate had expired again, root cause confirmed.')],
      }),
      incident({
        shortDescClean: 'VPN connection keeps dropping for remote staff',
        Opened: '2025-03-18 09:00:00', Closed: '', State: 'In Progress',
        'Made SLA': false,
      }),
    ]);
    return { incidents, scores: incidents.map(i => score(i.Number, 70)) };
  }

  it('ranks recurring problems and counts the weeks they span', () => {
    const { incidents, scores } = vpnDataset();
    const clusters = computeProblemClusters(incidents, scores);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(3);
    expect(clusters[0].weeksActive).toBe(3);
    expect(clusters[0].isChronic).toBe(true);
    expect(clusters[0].category).toBe('VPN & Remote Access');
  });

  it('aggregates documented root causes with their coverage', () => {
    const { incidents, scores } = vpnDataset();
    const [cluster] = computeProblemClusters(incidents, scores);

    expect(cluster.documentedCount).toBe(2);
    expect(cluster.rcaCoverage).toBe(66.7);
    expect(cluster.rootCauses.length).toBeGreaterThan(0);
    expect(cluster.rootCauses[0].text.toLowerCase()).toContain('certificate');
  });

  it('reports resolution time from resolved incidents only', () => {
    const { incidents, scores } = vpnDataset();
    const [cluster] = computeProblemClusters(incidents, scores);

    // Two resolved incidents at 2h and 1h; the third never closed.
    expect(cluster.medianResolutionHours).toBe(1.5);
  });

  it('excludes one-off incidents from the recurring view', () => {
    const incidents = annotateIncidents([
      incident({ shortDescClean: 'A completely unique and singular failure of the widget' }),
    ]);

    expect(computeProblemClusters(incidents, [])).toEqual([]);
  });

  it('returns nothing for an empty dataset', () => {
    expect(computeProblemClusters([], [])).toEqual([]);
  });
});

describe('computeCategoryStats', () => {
  it('rolls incidents up by category with coverage and SLA', () => {
    const incidents = annotateIncidents([
      incident({ shortDescClean: 'Cannot connect to VPN', humanNotes: [note('Root cause was a certificate expiry.')] }),
      incident({ shortDescClean: 'VPN client will not start', 'Made SLA': false }),
      incident({ shortDescClean: 'Printer offline on floor 3' }),
    ]);
    const stats = computeCategoryStats(incidents, incidents.map(i => score(i.Number)));

    const vpn = stats.find(s => s.name === 'VPN & Remote Access')!;
    expect(vpn.count).toBe(2);
    expect(vpn.rcaCoverage).toBe(50);
    expect(vpn.slaBreachPct).toBe(50);
    expect(stats.find(s => s.name === 'Printing')!.count).toBe(1);
  });

  it('returns nothing for an empty dataset', () => {
    expect(computeCategoryStats([], [])).toEqual([]);
  });
});

describe('recommendActions', () => {
  it('flags a high-volume problem with no documented cause for problem management', () => {
    const incidents = annotateIncidents(
      Array.from({ length: 8 }, (_, i) => incident({
        shortDescClean: 'Shared drive mapping disappears after reboot',
        Opened: `2025-0${(i % 3) + 1}-04 09:00:00`,
      })),
    );
    const clusters = computeProblemClusters(incidents, incidents.map(i => score(i.Number)));
    const actions = recommendActions(clusters, incidents.length);

    expect(actions[0].kind).toBe('problem-management');
    expect(actions[0].cluster.count).toBe(8);
    expect(actions[0].reason).toContain('re-fixing');
  });

  it('flags a fast, well-understood, high-volume problem for automation', () => {
    const incidents = annotateIncidents(
      Array.from({ length: 8 }, () => incident({
        shortDescClean: 'Password reset required for domain account',
        Opened: '2025-03-04 09:00:00',
        Closed: '2025-03-04 09:30:00',
        humanNotes: [note('Root cause was the standard 90 day password expiry policy.')],
      })),
    );
    const clusters = computeProblemClusters(incidents, incidents.map(i => score(i.Number)));
    const actions = recommendActions(clusters, incidents.length);

    expect(actions.some(a => a.kind === 'automation')).toBe(true);
  });

  it('stays quiet when nothing clears the volume floor', () => {
    const incidents = annotateIncidents([
      incident({ shortDescClean: 'Shared drive mapping disappears after reboot' }),
      incident({ shortDescClean: 'Shared drive mapping disappears after reboot' }),
    ]);
    const clusters = computeProblemClusters(incidents, []);

    expect(recommendActions(clusters, 5000)).toEqual([]);
  });
});
