/**
 * Cross-format equivalence: the same logical incidents, written as XLSX and as
 * CSV in several encodings and line-break styles, must reach scoring and
 * clustering identically. All values are synthetic.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { enrichRow, inferDateOrder, readIncidentTable, type EnrichedIncident } from './parser';
import { scoreIncident } from './scorer';
import { annotateIncidents } from './problems';
import { categorize } from './taxonomy';
import { tokenize } from './text';
import { getDimension } from './dimensions';

const HEADERS = ['Number', 'Short description', 'Description', 'Work notes', 'State', 'Priority', 'Assignment group', 'Assigned to', 'Opened', 'Closed', 'Channel', 'Made SLA', 'Service', 'Service offering'];

/** Logical incidents. Text uses '\n' for a line break; each format writes it its own way. */
const NOTES = (a: string, b: string) => `2026-03-04 09:12:00 - A. Tech (Work notes)\n${a}\n\n2026-03-04 08:00:00 - B. Tech (Work notes)\n${b}`;
const LOGICAL: string[][] = [
  ['INC0001', 'Queue backlog on integration node', 'Messages pile up – retries “stuck”.\nRoot cause: adapter thread pool exhausted.', NOTES('Restarted the adapter and verified the queue drained.', 'Checked the connector logs — backlog seen.'), 'Closed', '3 - Moderate', 'AG-Integration', 'Analyst One', '2026-03-04 07:59:00', '2026-03-04 10:00:00', 'Channel-Alpha', 'true', 'Service-01', 'Offering-1'],
  ['INC0002', 'Queue backlog on integration node', 'Backlog again after deploy.\nWorkaround applied.', NOTES('Cleared the queue manually.', 'Escalated to platform team.'), 'Resolved', '2 - High', 'AG-Integration', 'Analyst Two', '2026-03-05 08:10:00', '2026-03-05 12:00:00', 'Channel-Beta', 'false', 'Service-01', ''],
  ['INC0003', 'Printer offline on floor three', 'Printer shows offline.', '', 'New', '4 - Low', 'AG-Desk', '', '2026-03-06 09:00:00', '', 'Channel-Alpha', '', '', ''],
  ['INC0004', 'Printer offline on floor three', 'Printer offline again…\nUsers can’t print.', NOTES('Power cycled the printer.', 'Replaced toner.'), 'Closed', '4 - Low', 'AG-Desk', 'Analyst One', '2026-03-07 09:00:00', '2026-03-07 11:30:00', 'Channel-Alpha', 'true', 'Service-02', 'Offering-2'],
];

const ab = (bytes: Uint8Array) => { const b = new ArrayBuffer(bytes.byteLength); new Uint8Array(b).set(bytes); return b; };
const CP1252: Record<string, number> = { '–': 0x96, '—': 0x97, '“': 0x93, '”': 0x94, '’': 0x92, '…': 0x85, ' ': 0xa0 };
const toCp1252 = (s: string) => Uint8Array.from([...s].map(c => CP1252[c] ?? c.charCodeAt(0)));
const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
const csvText = (eol: string) => [HEADERS, ...LOGICAL].map(r => r.map(v => quote(v.replace(/\n/g, eol))).join(',')).join('\r\n') + '\r\n';
function xlsx(eol: string): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...LOGICAL.map(r => r.map(v => v.replace(/\n/g, eol)))]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Page 1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const FORMATS: Record<string, ArrayBuffer> = {
  'XLSX (CRLF in cells)': xlsx('\r\n'),
  'XLSX (LF in cells)': xlsx('\n'),
  'CSV UTF-8 CRLF': ab(new TextEncoder().encode(csvText('\r\n'))),
  'CSV UTF-8 LF': ab(new TextEncoder().encode(csvText('\n'))),
  'CSV UTF-8 BOM': ab(new TextEncoder().encode('﻿' + csvText('\r\n'))),
  'CSV CP1252': ab(toCp1252(csvText('\r\n'))),
  'CSV bare CR': ab(new TextEncoder().encode(csvText('\r'))),
};

function ingest(buffer: ArrayBuffer) {
  const { rows } = readIncidentTable(buffer);
  const order = inferDateOrder(rows);
  const incidents = rows.map(r => enrichRow(r, { dateOrder: order }));
  const scores = incidents.map(scoreIncident);
  const downstream = incidents.map(i => downstreamView(i));
  const annotated = annotateIncidents(incidents.map(i => ({ ...i })));
  return { downstream, scores, clusterIds: annotated.map(i => i.clusterId) };
}

/**
 * Every incident field that feeds scoring, clustering, filters and problems.
 * Left out on purpose: the raw `Short description`, `Description` and `Work notes`
 * strings, which keep the source's own line-break characters because the export
 * reproduces them as written.
 */
function downstreamView(i: EnrichedIncident) {
  return {
    Number: i.Number, State: i.State, Priority: i.Priority, 'Task type': i['Task type'],
    'Assignment group': i['Assignment group'], 'Assigned to': i['Assigned to'], Channel: i.Channel,
    Opened: i.Opened, Closed: i.Closed, 'Made SLA': i['Made SLA'],
    shortDescClean: i.shortDescClean, descClean: i.descClean, isAutoDesc: i.isAutoDesc,
    allNotes: i.allNotes, humanNotes: i.humanNotes,
    service: getDimension(i, 'service'), serviceOffering: getDimension(i, 'serviceOffering'),
    category: categorize(i.shortDescClean, i.descClean),
    signatureTokens: tokenize(i.shortDescClean.trim().length >= 8 ? i.shortDescClean : i.descClean.slice(0, 200)),
  };
}

describe('cross-format equivalence', () => {
  const reference = ingest(FORMATS['XLSX (CRLF in cells)']);

  it('the reference parses every logical incident with its journal entries', () => {
    expect(reference.downstream).toHaveLength(LOGICAL.length);
    expect(reference.downstream[0].allNotes).toHaveLength(2);
    expect(reference.downstream[0].shortDescClean).toContain(' ');
    expect(reference.downstream[0].descClean).toContain('–');
  });

  for (const [name, buffer] of Object.entries(FORMATS)) {
    it(`${name}: same normalized incidents, scorer output and clustering`, () => {
      const result = ingest(buffer);
      expect(result.downstream).toEqual(reference.downstream);
      expect(result.scores).toEqual(reference.scores);
      expect(result.clusterIds).toEqual(reference.clusterIds);
    });
  }
});
