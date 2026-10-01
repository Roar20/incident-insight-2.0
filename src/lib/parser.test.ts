import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { enrichRow, parseExcelFile, readIncidentRows } from './parser';

function workbookBuffer(rows: Record<string, unknown>[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Incidents');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('enrichRow', () => {
  it('splits work notes into timestamped entries', () => {
    const inc = enrichRow({
      Number: 'INC0001',
      'Work notes': [
        '2025-03-04 09:12:00 - A. Tech (Work notes)',
        'Checked the mailbox rules and found a stale forwarding entry.',
        '2025-03-04 10:41:00 - B. Tech (Work notes)',
        'Removed the entry and verified delivery.',
      ].join('\n'),
    });

    expect(inc.allNotes).toHaveLength(2);
    expect(inc.allNotes[0]).toMatchObject({
      timestamp: '2025-03-04 09:12:00',
      author: 'A. Tech',
      isSystem: false,
    });
    expect(inc.allNotes[0].text).toBe('Checked the mailbox rules and found a stale forwarding entry.');
    expect(inc.allNotes[1].author).toBe('B. Tech');
  });

  it('separates system-generated notes from human ones', () => {
    const inc = enrichRow({
      'Work notes': [
        '2025-03-04 09:00:00 - System (Work notes)',
        'Task is created by system',
        '2025-03-04 09:30:00 - A. Tech (Work notes)',
        'Predicted AG: Network Operations',
        '2025-03-04 10:00:00 - A. Tech (Work notes)',
        'Replaced the faulty patch cable in rack B4.',
      ].join('\n'),
    });

    expect(inc.allNotes).toHaveLength(3);
    // Note 1 by author, note 2 by phrase, leaving one genuine human note.
    expect(inc.humanNotes).toHaveLength(1);
    expect(inc.humanNotes[0].text).toBe('Replaced the faulty patch cable in rack B4.');
  });

  it('keeps unstructured work notes as a single Unknown-author entry', () => {
    const inc = enrichRow({ 'Work notes': 'Rebooted the server, all good now.' });

    expect(inc.allNotes).toHaveLength(1);
    expect(inc.allNotes[0]).toMatchObject({ author: 'Unknown', timestamp: '' });
    expect(inc.humanNotes).toHaveLength(1);
  });

  it('returns no notes for blank work notes', () => {
    expect(enrichRow({ 'Work notes': '   ' }).allNotes).toEqual([]);
    expect(enrichRow({}).allNotes).toEqual([]);
  });

  it('cleans carriage-return markers, HTML and URLs out of text', () => {
    const inc = enrichRow({
      Description: 'Line one_x000D_<b>Line two</b> see https://example.com/ticket?id=5 for detail',
    });

    expect(inc.descClean).toBe('Line one\nLine two see [URL] for detail');
  });

  it('accepts snake_case column names as a fallback', () => {
    const inc = enrichRow({
      number: 'INC0042',
      short_description: 'Printer offline',
      assignment_group: 'Field Services',
      assigned_to: 'C. Tech',
      state: 'Resolved',
    });

    expect(inc.Number).toBe('INC0042');
    expect(inc['Short description']).toBe('Printer offline');
    expect(inc['Assignment group']).toBe('Field Services');
    expect(inc['Assigned to']).toBe('C. Tech');
    expect(inc.State).toBe('Resolved');
  });

  it('converts Excel serial dates and Date objects to a sortable string', () => {
    // 45720 is 2025-03-04 in the 1900 date system.
    expect(enrichRow({ Opened: 45720 }).Opened).toBe('2025-03-04 00:00:00');
    expect(enrichRow({ Opened: new Date(Date.UTC(2025, 2, 4, 9, 30, 0)) }).Opened)
      .toBe('2025-03-04 09:30:00');
    expect(enrichRow({ Opened: '2025-03-04 09:30:00' }).Opened).toBe('2025-03-04 09:30:00');
    expect(enrichRow({}).Opened).toBe('');
  });

  it('repairs mojibake in the Priority column', () => {
    const inc = enrichRow({ Priority: '3 â€“ Moderate' });

    expect(inc.Priority).toBe('3 – Moderate');
  });

  it('defaults Task type to Incident when absent', () => {
    expect(enrichRow({}).Priority).toBe('');
    expect(enrichRow({})['Task type']).toBe('Incident');
  });

  it('reads Made SLA as unknown when the column or the cell is empty', () => {
    expect(enrichRow({})['Made SLA']).toBeNull();
    expect(enrichRow({ 'Made SLA': '' })['Made SLA']).toBeNull();
    expect(enrichRow({ made_sla: 'false' })['Made SLA']).toBe(false);
    expect(enrichRow({ 'Made SLA': 'TRUE' })['Made SLA']).toBe(true);
    expect(enrichRow({ 'Made SLA': false })['Made SLA']).toBe(false);
  });

  it('detects auto-generated monitoring descriptions', () => {
    expect(enrichRow({ Description: 'Alert triggered at 03:15 UTC. Pod name: api-7f9' }).isAutoDesc).toBe(true);
    expect(enrichRow({ Description: 'User reports the VPN client disconnects hourly.' }).isAutoDesc).toBe(false);
  });
});

describe('readIncidentRows / parseExcelFile', () => {
  it('reads every data row of the first sheet', () => {
    const buffer = workbookBuffer([
      { Number: 'INC0001', 'Short description': 'First', State: 'Closed' },
      { Number: 'INC0002', 'Short description': 'Second', State: 'Open' },
      { Number: 'INC0003', 'Short description': 'Third', State: 'Open' },
    ]);

    const rows = readIncidentRows(buffer);
    expect(rows).toHaveLength(3);
    expect(rows[0].Number).toBe('INC0001');

    const incidents = parseExcelFile(buffer);
    expect(incidents.map(i => i.Number)).toEqual(['INC0001', 'INC0002', 'INC0003']);
    expect(incidents[2]['Short description']).toBe('Third');
  });

  it('fills missing cells rather than dropping the column', () => {
    const buffer = workbookBuffer([
      { Number: 'INC0001', 'Assigned to': 'A. Tech' },
      { Number: 'INC0002' },
    ]);

    const incidents = parseExcelFile(buffer);
    expect(incidents[1]['Assigned to']).toBe('');
  });

  it('returns an empty list for a header-only sheet', () => {
    expect(parseExcelFile(workbookBuffer([]))).toEqual([]);
  });
});

/**
 * Bytes as `File.arrayBuffer()` returns them in the browser.
 *
 * Copied into an ArrayBuffer of this realm on purpose: under jsdom a
 * TextEncoder buffer fails `instanceof ArrayBuffer`, which sends SheetJS down a
 * different code path than the browser takes and produces misleading results.
 */
function fileBuffer(bytes: ArrayLike<number>): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(Array.from(bytes));
  return buffer;
}

const utf8 = (text: string) => fileBuffer(new TextEncoder().encode(text));

describe('CSV text encoding', () => {
  const csv = 'Number,Short description,Work notes\r\n'
    + 'INC0001,Contraseña bloqueada,"2025-03-04 09:00:00 - A. Tech (Work notes)\nSe identificó que la causa raíz era un certificado caducado."\r\n';

  it('decodes a UTF-8 CSV without a byte-order mark', () => {
    const [inc] = parseExcelFile(utf8(csv));

    expect(inc['Short description']).toBe('Contraseña bloqueada');
    expect(inc.humanNotes[0].text).toBe('Se identificó que la causa raíz era un certificado caducado.');
  });

  it('decodes a UTF-8 CSV with a byte-order mark', () => {
    const [inc] = parseExcelFile(utf8('﻿' + csv));

    expect(inc.Number).toBe('INC0001');
    expect(inc['Short description']).toBe('Contraseña bloqueada');
  });

  it('still reads a legacy Windows-1252 CSV', () => {
    // "Contraseña" with ñ as the single byte 0xF1, as Excel saves "CSV (comma delimited)".
    const bytes = [...new TextEncoder().encode('Number,Short description\r\nINC0001,Contrase'), 0xf1, 0x61, 0x0d, 0x0a];
    const [inc] = parseExcelFile(fileBuffer(bytes));

    expect(inc['Short description']).toBe('Contraseña');
  });
});
