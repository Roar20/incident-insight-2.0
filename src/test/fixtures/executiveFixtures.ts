/**
 * Synthetic incident populations for the Executive Summary. Every value is
 * generated — nothing comes from a real export.
 *
 * - alertLike: several Handling Groups, template-style monitoring alerts that
 *   repeat, a mixed SLA flag.
 * - ticketLike: one Handling Group, free-text user tickets that rarely repeat,
 *   an SLA flag that is the same on every incident.
 */
import type { IncidentRow } from '../../lib/parser';

const pad = (n: number, width = 5) => String(n).padStart(width, '0');

export function alertLikeRows(): IncidentRow[] {
  const groups = ['AG-001', 'AG-001', 'AG-001', 'AG-002', 'AG-002', 'AG-003', 'AG-004', 'AG-005'];
  const services = ['Service-001', 'Service-002', 'Service-003', 'Service-004', 'Service-005', 'Service-006', 'Service-007'];
  const alerts = [
    'Synthetic monitor alert: job step failed on node',
    'Synthetic monitor alert: queue depth above limit',
    'Synthetic monitor alert: certificate expiring soon',
  ];
  const rows: IncidentRow[] = [];
  for (let i = 0; i < 120; i++) {
    const month = `2026-0${1 + (i % 4)}`;
    const day = String(1 + (i % 27)).padStart(2, '0');
    rows.push({
      Number: `SYNA${pad(i)}`,
      State: 'Closed',
      'Short description': alerts[i % 7 === 0 ? 2 : i % 3 === 0 ? 1 : 0],
      Description: `Monitor....Synthetic-Monitor\nCategory....Synthetic-Batch\nObject....synthetic_object_${i % 4}`,
      'Work notes': `${month}-${day} 10:00:00 - Synthetic Analyst (Work notes)\nRestarted the synthetic job; root cause: synthetic dependency was down.`,
      'Assignment group': groups[i % groups.length],
      'Assigned to': `Person-${(i % 4) + 1}`,
      Opened: `${month}-${day} 09:00:00`,
      Closed: `${month}-${day} 15:30:00`,
      'Made SLA': i % 5 === 0 ? 'false' : 'true',
      Service: i % 20 === 19 ? '' : services[i % services.length],
      'Service offering': `Offering-00${(i % 6) + 1}`,
    });
  }
  return rows;
}

export function ticketLikeRows(): IncidentRow[] {
  const topics = ['dashboard', 'report export', 'login', 'data refresh', 'access request', 'printer', 'mailbox', 'laptop', 'VPN', 'license'];
  const verbs = ['cannot open', 'shows an error for', 'is slow when using', 'needs help with', 'lost access to'];
  const rows: IncidentRow[] = [];
  for (let i = 0; i < 60; i++) {
    const month = `2025-${String(10 + (i % 3)).padStart(2, '0')}`;
    const day = String(1 + (i % 27)).padStart(2, '0');
    rows.push({
      Number: `SYNT${pad(i)}`,
      State: 'Resolved',
      'Short description': `Synthetic user ${verbs[i % verbs.length]} ${topics[(i * 3) % topics.length]} item ${String.fromCharCode(65 + (i % 26))}${i}`,
      Description: `Synthetic ticket ${i}: the requester describes their own situation in free text.`,
      'Work notes': `${month}-${day} 11:00:00 - Synthetic Agent (Work notes)\nContacted the synthetic requester.`,
      'Assignment group': 'AG-001',
      'Assigned to': `Person-${(i % 3) + 1}`,
      Opened: `${month}-${day} 08:00:00`,
      Closed: `${month}-${day} 18:00:00`,
      'Made SLA': 'true',
      Service: `Service-00${(i % 4) + 1}`,
      'Service offering': i % 15 === 14 ? '' : `Offering-00${(i % 9) + 1}`,
    });
  }
  return rows;
}
