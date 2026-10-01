import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { enrichRow, inferDateOrder, isMappedColumn, parseExcelFile, readIncidentRows, readIncidentTable } from './parser';

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

describe('day/month text dates', () => {
  it('normalises dd/mm/yyyy text dates', () => {
    expect(enrichRow({ Opened: '13/03/2025 09:30' }).Opened).toBe('2025-03-13 09:30:00');
    expect(enrichRow({ Closed: '13-03-2025 09:30:15' }).Closed).toBe('2025-03-13 09:30:15');
    expect(enrichRow({ Opened: '13.03.2025' }).Opened).toBe('2025-03-13 00:00:00');
  });

  it('resolves an ambiguous day and month with the file-level order', () => {
    expect(enrichRow({ Opened: '04/03/2025 09:30:00' }, { dateOrder: 'dmy' }).Opened).toBe('2025-03-04 09:30:00');
    expect(enrichRow({ Opened: '04/03/2025 09:30:00' }, { dateOrder: 'mdy' }).Opened).toBe('2025-04-03 09:30:00');
  });

  it('reads a 12-hour clock', () => {
    expect(enrichRow({ Opened: '03/13/2025 01:05:00 PM' }, { dateOrder: 'mdy' }).Opened).toBe('2025-03-13 13:05:00');
    expect(enrichRow({ Opened: '13/03/2025 12:10 AM' }).Opened).toBe('2025-03-13 00:10:00');
  });

  it('leaves ISO, unrecognised and impossible dates as they were', () => {
    expect(enrichRow({ Opened: '2025-03-04 09:30:00' }).Opened).toBe('2025-03-04 09:30:00');
    expect(enrichRow({ Opened: '4-Mar-2025' }).Opened).toBe('4-Mar-2025');
    expect(enrichRow({ Opened: '31/02/2025' }).Opened).toBe('31/02/2025');
  });

  it('infers the day/month order of a file from its unambiguous dates', () => {
    expect(inferDateOrder([{ Opened: '04/03/2025' }, { Opened: '13/03/2025' }])).toBe('dmy');
    expect(inferDateOrder([{ opened_at: '04/03/2025' }, { closed_at: '03/13/2025' }])).toBe('mdy');
    // Nothing decides it: day first.
    expect(inferDateOrder([{ Opened: '04/03/2025' }, { Opened: '2025-03-04' }])).toBe('dmy');
  });

  it('reads CSV dates as written instead of as US month/day', () => {
    const csv = 'Number,Opened,Closed\r\n'
      + 'INC0001,04/03/2025 10:00,05/03/2025 11:30\r\n'
      + 'INC0002,13/03/2025 10:00,14/03/2025 08:00\r\n';
    const incidents = parseExcelFile(utf8(csv));

    expect(incidents.map(i => i.Opened)).toEqual(['2025-03-04 10:00:00', '2025-03-13 10:00:00']);
    expect(incidents[0].Closed).toBe('2025-03-05 11:30:00');
  });
});

describe('work-note journal splitting', () => {
  it('splits entries of every journal type, not only Work notes', () => {
    const inc = enrichRow({
      'Work notes': [
        '2025-03-04 10:00:00 - B. Tech (Work notes)',
        'Restarted the print spooler.',
        '',
        '2025-03-04 09:00:00 - A. Tech (Additional comments)',
        'Called the user, waiting for confirmation.',
        '',
        '2025-03-04 08:00:00 - System (Work notes)',
        'Task is created by system',
      ].join('\n'),
    });

    expect(inc.allNotes.map(n => [n.author, n.text])).toEqual([
      ['B. Tech', 'Restarted the print spooler.'],
      ['A. Tech', 'Called the user, waiting for confirmation.'],
      ['System', 'Task is created by system'],
    ]);
    expect(inc.humanNotes).toHaveLength(2);
  });

  it('never lets an author run across lines', () => {
    const inc = enrichRow({
      'Work notes': [
        '2025-03-04 09:00:00 - A. Tech (Additional comments)',
        'Called user',
        '2025-03-04 10:00:00 - B. Tech (Work notes)',
        'Restarted service',
      ].join('\n'),
    });

    expect(inc.allNotes.every(n => !n.author.includes('\n'))).toBe(true);
    expect(inc.allNotes.map(n => n.author)).toEqual(['A. Tech', 'B. Tech']);
  });

  it('splits entries whose timestamps are written day/month or with a 12-hour clock', () => {
    const inc = enrichRow({
      'Work notes': [
        '13/03/2025 09:30:00 - A. Tech (Work notes)',
        'Replaced the patch cable.',
        '',
        '03/13/2025 01:05:00 PM - System (Work notes)',
        'Task is created by system',
      ].join('\n'),
    });

    expect(inc.allNotes.map(n => [n.timestamp, n.author])).toEqual([
      ['13/03/2025 09:30:00', 'A. Tech'],
      ['03/13/2025 01:05:00 PM', 'System'],
    ]);
    expect(inc.humanNotes.map(n => n.text)).toEqual(['Replaced the patch cable.']);
  });

  it('keeps parentheses that belong to the author name', () => {
    const inc = enrichRow({
      'Work notes': '2025-03-04 09:00:00 - Jane Roe (Contractor) (Work notes)\nChecked the DNS records.',
    });

    expect(inc.allNotes).toEqual([
      { timestamp: '2025-03-04 09:00:00', author: 'Jane Roe (Contractor)', text: 'Checked the DNS records.', isSystem: false },
    ]);
  });

  it('does not split on a timestamp quoted inside a note body', () => {
    const inc = enrichRow({
      'Work notes': '2025-03-04 09:00:00 - A. Tech (Work notes)\nLogs show the crash at 2025-03-04 08:55:00 - see (attached).',
    });

    expect(inc.allNotes).toHaveLength(1);
    expect(inc.allNotes[0].text).toBe('Logs show the crash at 2025-03-04 08:55:00 - see (attached).');
  });
});

describe('unmapped source columns', () => {
  const MAPPED = [
    'Number', 'Task type', 'Priority', 'State', 'Short description', 'Description', 'Work notes',
    'Assignment group', 'Assigned to', 'Opened', 'Closed', 'Channel', 'Made SLA',
    'number', 'sys_class_name', 'priority', 'state', 'short_description', 'description', 'work_notes',
    'assignment_group', 'assigned_to', 'opened_at', 'closed_at', 'contact_type', 'made_sla',
  ];

  it('treats every display name and field name the model reads as mapped', () => {
    for (const header of MAPPED) expect(isMappedColumn(header), header).toBe(true);
    expect(isMappedColumn('Service offering')).toBe(false);
    expect(isMappedColumn('Resolution code')).toBe(false);
  });

  it('keeps unmapped columns verbatim in extraFields, in source order', () => {
    const inc = enrichRow({
      Number: 'INC0001',
      Service: 'SAP PI/PO',
      Channel: 'Phone',
      'Service offering': 'Middleware - Gold',
      'Resolution code': 'Solved (Work Around)',
      'Reassignment count': 2,
      Code: '007',
    });
    expect(inc.extraFields).toEqual({
      Service: 'SAP PI/PO',
      'Service offering': 'Middleware - Gold',
      'Resolution code': 'Solved (Work Around)',
      'Reassignment count': 2,
      Code: '007',
    });
    expect(Object.keys(inc.extraFields!)).toEqual(['Service', 'Service offering', 'Resolution code', 'Reassignment count', 'Code']);
    // Channel is canonical: read into the model, never duplicated as an extra.
    expect(inc.Channel).toBe('Phone');
  });

  it('does not copy snake_case mapped columns into extraFields', () => {
    const inc = enrichRow({ number: 'INC0002', contact_type: 'Email', short_description: 'x' });
    expect(inc.Channel).toBe('Email');
    expect(inc.extraFields).toBeUndefined();
  });

  it('leaves extraFields out when every column is mapped', () => {
    expect(enrichRow({ Number: 'INC0003', State: 'Closed' }).extraFields).toBeUndefined();
  });

  it('does not change the canonical fields or the cleaned text', () => {
    const row = { Number: 'INC0004', 'Short description': 'VPN down', Description: 'Body', State: 'Closed' };
    const plain = enrichRow(row);
    const withExtras = enrichRow({ ...row, Service: 'Network' });
    const { extraFields, ...rest } = withExtras;
    expect(extraFields).toEqual({ Service: 'Network' });
    expect(rest).toEqual(plain);
  });
});

describe('readIncidentTable', () => {
  it('returns the source columns in order, flagging which are mapped', () => {
    const { rows, columns } = readIncidentTable(workbookBuffer([
      { Number: 'INC0001', Service: 'SAP', State: 'Closed', 'Resolution code': 'Solved' },
    ]));
    expect(rows).toHaveLength(1);
    expect(columns).toEqual([
      { name: 'Number', mapped: true },
      { name: 'Service', mapped: false, kind: 'text' },
      { name: 'State', mapped: true },
      { name: 'Resolution code', mapped: false, kind: 'text' },
    ]);
  });

  it('types unmapped columns: Excel dates as date, Excel numbers as number with their format', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['Number', 'Resolved', 'Cost'], ['INC0001', 46085.5, 12.5]]);
    sheet.B2.z = 'yyyy-mm-dd hh:mm';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Incidents');
    const { rows, columns } = readIncidentTable(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    expect(rows[0].Resolved).toBe(46085.5);
    expect(columns).toEqual([
      { name: 'Number', mapped: true },
      { name: 'Resolved', mapped: false, kind: 'date' },
      { name: 'Cost', mapped: false, kind: 'number' },
    ]);
  });

  it('types text columns strictly, never turning identifiers or codes into numbers', () => {
    const csv = [
      'Number,Resolve time,Job ID,App number,Code,Updated,Notes,Empty',
      'INC1,9089,12345,700,007,2026-09-26 23:14:56,12,',
      'INC2,-1.5,12346,701,008,2026-09-27,ok,',
    ].join('\n');
    const bytes = new TextEncoder().encode(csv);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const kinds = Object.fromEntries(readIncidentTable(buffer).columns.filter(c => !c.mapped).map(c => [c.name, c.kind]));
    expect(kinds).toEqual({
      'Resolve time': 'number', 'Job ID': 'text', 'App number': 'text', Code: 'text',
      Updated: 'date', Notes: 'text', Empty: 'text',
    });
  });

  it('returns no columns for an empty sheet', () => {
    expect(readIncidentTable(workbookBuffer([]))).toEqual({ rows: [], columns: [] });
  });
});

describe('Excel serial dates (F-25)', () => {
  const EPOCH = Date.UTC(1899, 11, 30);
  /** The serial Excel stores for a UTC wall-clock time: fractional days since 1899-12-30. */
  const serialOf = (iso: string) => (Date.parse(`${iso.replace(' ', 'T')}Z`) - EPOCH) / 86_400_000;

  it('reads a serial whose float product falls just short of the second without losing that second', () => {
    // 46291.9687037037 * 86400000 lands 0.0005 ms before 23:14:56.
    expect(serialOf('2026-09-26 23:14:56')).toBe(46291.9687037037);
    expect(enrichRow({ Opened: serialOf('2026-09-26 23:14:56') }).Opened).toBe('2026-09-26 23:14:56');
    expect(enrichRow({ Closed: serialOf('2026-09-01 00:00:07') }).Closed).toBe('2026-09-01 00:00:07');
  });

  it('keeps midnight on its own day', () => {
    expect(enrichRow({ Opened: serialOf('2026-03-01 00:00:00') }).Opened).toBe('2026-03-01 00:00:00');
    expect(enrichRow({ Opened: 46082 }).Opened).toBe('2026-03-01 00:00:00');
  });

  it('keeps 23:59:59 on the last day of the month, without rolling into the next day or month', () => {
    for (const iso of ['2026-01-31 23:59:59', '2026-02-28 23:59:59', '2025-12-31 23:59:59', '2024-02-29 23:59:59']) {
      expect(enrichRow({ Closed: serialOf(iso) }).Closed, iso).toBe(iso);
    }
  });

  it('reads every second of a day exactly', () => {
    const wrong: string[] = [];
    for (let s = 0; s < 86_400; s++) {
      const iso = new Date(Date.UTC(2026, 8, 26) + s * 1000).toISOString().slice(0, 19).replace('T', ' ');
      const read = enrichRow({ Opened: serialOf(iso) }).Opened;
      if (read !== iso) wrong.push(`${iso} -> ${read}`);
    }
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  it('reads date-typed cells from an xlsx file exactly, in canonical and unmapped columns', () => {
    const times = ['2026-09-26 23:14:56', '2026-09-01 00:00:07', '2026-01-31 23:59:59', '2026-03-01 00:00:00'];
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Number', 'Opened', 'Closed', 'Resolved'],
      ...times.map((t, i) => [`INC${i}`, serialOf(t), serialOf(t), serialOf(t)]),
    ]);
    for (let r = 1; r <= times.length; r++) {
      for (const c of [1, 2, 3]) sheet[XLSX.utils.encode_cell({ r, c })].z = 'yyyy-mm-dd hh:mm:ss';
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Incidents');
    const incidents = parseExcelFile(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);

    expect(incidents.map(i => i.Opened)).toEqual(times);
    expect(incidents.map(i => i.Closed)).toEqual(times);
    // The unmapped column keeps the serial as stored; its date is that serial, not one second earlier.
    incidents.forEach((inc, i) => expect(inc.extraFields?.Resolved).toBeCloseTo(serialOf(times[i]), 9));
  });
});
