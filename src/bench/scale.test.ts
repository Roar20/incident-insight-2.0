import { describe, it, expect } from 'vitest';
import { enrichRow } from '../lib/parser';
import { scoreIncident } from '../lib/scorer';
import { annotateIncidents, computeProblemClusters } from '../lib/problems';
import { computeWeeklyDigest, availableWeeks } from '../lib/weekly';

/**
 * Guards the cost of the corpus-level work the worker does on every upload.
 * Clustering is the only step whose cost is not linear in row count, so this
 * pins it at a realistic export size.
 */

const PROBLEMS = [
  'VPN connection keeps dropping for remote staff',
  'Password reset required for domain account',
  'Outlook mailbox not syncing for finance users',
  'Printer on floor 3 is offline and will not print',
  'Shared network drive mapping disappears after reboot',
  'Application response times extremely slow in the morning',
  'Laptop will not power on after docking station update',
  'Disk space full on the reporting file server',
];

const ROWS = 20_000;

function buildRows() {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < ROWS; i++) {
    const problem = PROBLEMS[i % PROBLEMS.length];
    const day = 1 + (i % 112); // ~16 weeks
    const date = new Date(Date.UTC(2025, 0, day, 9));
    const stamp = date.toISOString().slice(0, 19).replace('T', ' ');
    const closed = new Date(date.getTime() + 3 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
    const documented = i % 3 === 0;

    rows.push({
      Number: `INC${100000 + i}`,
      Priority: '3 - Moderate',
      State: 'Closed',
      'Short description': problem,
      Description: `The user reports: ${problem.toLowerCase()}. Affecting their work since this morning.`,
      'Work notes': [
        `${stamp} - System (Work notes)`,
        'Task is created by system',
        `${closed} - A. Tech (Work notes)`,
        documented
          ? 'Root cause was an expired service certificate. Applied the renewal and verified.'
          : 'Restarted the service and confirmed with the user.',
      ].join('\n'),
      'Assignment group': `Group ${i % 6}`,
      'Assigned to': `Agent ${i % 25}`,
      Opened: stamp,
      Closed: closed,
      Channel: 'Phone',
      'Made SLA': i % 7 !== 0,
    });
  }
  return rows;
}

describe('scale', () => {
  it(`clusters ${ROWS.toLocaleString()} incidents into the problems that generated them`, () => {
    const incidents = buildRows().map(row => enrichRow(row));
    const scores = incidents.map(scoreIncident);

    const started = Date.now();
    const annotated = annotateIncidents(incidents);
    const clusterMs = Date.now() - started;
    console.log(`annotate+cluster ${ROWS} incidents: ${clusterMs}ms`);

    const clusters = computeProblemClusters(annotated, scores);
    console.log(`-> ${clusters.length} problems, largest ${clusters[0]?.count}`);

    // Each seeded problem should come back as exactly one cluster.
    expect(clusters).toHaveLength(PROBLEMS.length);
    expect(clusters[0].count).toBe(ROWS / PROBLEMS.length);
    // Every third incident documents a cause.
    expect(clusters[0].rcaCoverage).toBeGreaterThan(25);
    expect(clusters[0].rcaCoverage).toBeLessThan(42);

    // Well clear of the ~200ms this takes, so it fails on a regression rather
    // than on a slow CI runner.
    expect(clusterMs).toBeLessThan(5000);

    const weeks = availableWeeks(annotated);
    expect(weeks.length).toBeGreaterThan(10);
    const digest = computeWeeklyDigest(annotated, scores, weeks[weeks.length - 1]);
    expect(digest).not.toBeNull();
    expect(digest!.incidentCount).toBeGreaterThan(0);
  }, 180000);
});
