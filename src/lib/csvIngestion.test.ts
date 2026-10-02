import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { checkIncidentTable, decodeWindows1252, enrichRow, inferDateOrder, parseExcelFile, readIncidentTable } from './parser';
import { isDedicatedEmailHeader, isExportExcludedExtraColumn } from '../config/schema';
import { getDimension } from './dimensions';
import { computeDatasetProfile } from './datasetProfile';
import { buildProblemsWorkbook } from './exportProblems';
import { annotateIncidents, computeProblemClusters } from './problems';
import { scoreIncident } from './scorer';

// All values here are synthetic.

const buf = (bytes: Uint8Array): ArrayBuffer => { const b = new ArrayBuffer(bytes.byteLength); new Uint8Array(b).set(bytes); return b; };
const utf8 = (text: string) => buf(new TextEncoder().encode(text));
/** Windows-1252 bytes for ASCII plus the few characters these tests use. */
const CP1252: Record<string, number> = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '…': 0x85, '€': 0x80, ' ': 0xa0, 'ñ': 0xf1 };
const cp1252 = (text: string) => buf(Uint8Array.from([...text].map(c => {
  if (c in CP1252) return CP1252[c];
  if (c.charCodeAt(0) > 0x7f) throw new Error(`no test byte for ${c}`);
  return c.charCodeAt(0);
})));
const table = (text: string) => readIncidentTable(utf8(text));

describe('Windows-1252 decoding (WHATWG, as browsers decode it)', () => {
  // The WHATWG index for 0x80–0x9F. Undefined Windows bytes (0x81, 0x8D, 0x8F,
  // 0x90, 0x9D) decode to the C1 control of the same value.
  const WHATWG_80_9F = [
    0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
    0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
  ];

  it('maps every one of the 256 byte values', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const decoded = [...decodeWindows1252(all)].map(c => c.codePointAt(0));
    const expected = Array.from({ length: 256 }, (_, b) => (b >= 0x80 && b <= 0x9f ? WHATWG_80_9F[b - 0x80] : b));
    expect(decoded).toEqual(expected);
  });

  it('keeps the five undefined positions as C1 controls', () => {
    for (const b of [0x81, 0x8d, 0x8f, 0x90, 0x9d]) expect(decodeWindows1252(Uint8Array.of(b)).charCodeAt(0)).toBe(b);
  });

  it('reads the punctuation Excel writes in a CP1252 CSV', () => {
    const csv = 'Number,Short description\r\nINC1,"Queue – backlog — “retry” ‘ok’ … 5 €"\r\n';
    const [inc] = parseExcelFile(cp1252(csv));
    expect(inc['Short description']).toBe('Queue – backlog — “retry” ‘ok’ … 5 €');
  });

  it('falls back to Windows-1252 only when the bytes are not valid UTF-8', () => {
    const csv = 'Number,Short description\r\nINC1,Contraseña – reset\r\n';
    expect(parseExcelFile(utf8(csv))[0]['Short description']).toBe('Contraseña – reset');
    expect(parseExcelFile(cp1252(csv))[0]['Short description']).toBe('Contraseña – reset');
    expect(parseExcelFile(utf8('﻿' + csv))[0].Number).toBe('INC1');
  });
});

describe('CSV structure', () => {
  it('reads quoted commas, escaped quotes, multiline values and trailing empty fields', () => {
    const { rows } = table('Number,Short description,Description,Work notes,Extra\r\n'
      + 'INC1,"Printer, floor 3","Line one\r\nLine ""two""","2026-03-04 09:12:00 - A. Tech (Work notes)\r\nChecked it.",\r\n'
      + 'INC2,Short only,,,\r\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]['Short description']).toBe('Printer, floor 3');
    const inc = enrichRow(rows[0]);
    expect(inc.descClean).toBe('Line one\nLine "two"');
    expect(inc.allNotes).toHaveLength(1);
    expect(enrichRow(rows[1]).Description).toBe('');
  });

  it('keeps unknown columns as extras without failing the file', () => {
    const t = table('Number,Short description,Mystery column\r\nINC1,x,value\r\n');
    expect(checkIncidentTable(utf8('Number,Short description,Mystery column\r\nINC1,x,value\r\n'), t).errors).toEqual([]);
    expect(enrichRow(t.rows[0]).extraFields).toEqual({ 'Mystery column': 'value' });
  });

  it('keeps NBSP as written; tokens treat it as whitespace', () => {
    const [inc] = parseExcelFile(utf8('Number,Short description\r\nINC1,Queue backlog\r\n'));
    expect(inc.shortDescClean).toBe('Queue backlog');
  });
});

describe('line breaks: LF, CRLF, bare CR and _x000D_ read the same', () => {
  const notes = (eol: string) => `2026-03-04 09:12:00 - A. Tech (Work notes)${eol}Restarted the adapter.${eol}${eol}2026-03-04 08:00:00 - B. Tech (Work notes)${eol}Checked the logs.`;
  const desc = (eol: string) => `Users cannot save.${eol}Root cause: rotation disabled.`;
  const variants = { LF: '\n', CRLF: '\r\n', CR: '\r', XLSX: '_x000D_\n' };

  it('splits the same journal entries and cleans to the same text', () => {
    const results = Object.entries(variants).map(([, eol]) => enrichRow({ Number: 'INC1', 'Short description': 'x', Description: desc(eol), 'Work notes': notes(eol) }));
    const lf = results[0];
    expect(lf.allNotes).toHaveLength(2);
    for (const r of results.slice(1, 3)) {
      expect(r.allNotes).toEqual(lf.allNotes);
      expect(r.humanNotes).toEqual(lf.humanNotes);
      expect(r.descClean).toBe(lf.descClean);
      expect(scoreIncident(r)).toEqual(scoreIncident(lf));
    }
    // _x000D_ followed by LF is two line breaks, as before; its entries are unchanged.
    expect(results[3].allNotes.map(n => n.author)).toEqual(lf.allNotes.map(n => n.author));
  });

  it('a bare-CR CSV no longer collapses journal entries', () => {
    const csv = `Number,Short description,Work notes\r\nINC1,x,"${notes('\r')}"\r\n`;
    expect(parseExcelFile(utf8(csv))[0].allNotes).toHaveLength(2);
  });
});

describe('dates', () => {
  it('converges CSV ISO text and XLSX serials; keeps invalid and empty values as before', () => {
    const csv = parseExcelFile(utf8('Number,Opened,Closed,resolved_at\r\nINC1,2026-03-04 07:59:00,,2026-03-04 09:00:00\r\nINC2,not a date,2026-02-30 10:00:00,\r\n'));
    expect(csv[0].Opened).toBe('2026-03-04 07:59:00');
    expect(csv[0].Closed).toBe('');
    expect(csv[1].Opened).toBe('not a date');
    expect(csv[1].Closed).toBe('2026-02-30 10:00:00');
    const serial = (Date.UTC(2026, 2, 4, 7, 59) - Date.UTC(1899, 11, 30)) / 86_400_000;
    const ws = XLSX.utils.aoa_to_sheet([['Number', 'Opened'], ['INC1', serial]]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'S');
    expect(parseExcelFile(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)[0].Opened).toBe('2026-03-04 07:59:00');
    expect(readIncidentTable(utf8('Number,Short description,resolved_at\r\nINC1,x,2026-03-04 09:00:00\r\n')).columns.find(c => c.name === 'resolved_at')?.kind).toBe('date');
  });
});

describe('technical headers', () => {
  const csv = 'number,short_description,opened_at,assignment_group,contact_type,business_service,service_offering,close_code,u_close_code,comments\r\n'
    + 'INC1,Queue backlog,2026-03-04 07:59:00,AG-1,Channel-Alpha,Service-01,Offering-1,Code-1,Code-2,2026-03-04 09:00:00 - A. Tech (Additional comments)\nHello\r\n';
  const [inc] = parseExcelFile(utf8(csv));

  it('maps canonical fields and the approved Service / Service offering aliases', () => {
    expect(inc.Number).toBe('INC1');
    expect(inc['Assignment group']).toBe('AG-1');
    expect(inc.Channel).toBe('Channel-Alpha');
    expect(getDimension(inc, 'service')).toBe('Service-01');
    expect(getDimension(inc, 'serviceOffering')).toBe('Offering-1');
  });

  it('leaves unapproved headers as plain extras: close_code, u_close_code, comments', () => {
    expect(getDimension(inc, 'resolutionCode')).toBeNull();
    expect(Object.keys(inc.extraFields ?? {})).toEqual(expect.arrayContaining(['close_code', 'u_close_code', 'comments']));
    expect(inc.allNotes).toEqual([]); // comments never feed the notes the scorer reads
  });
});

describe('privacy boundaries', () => {
  it('recognises only dedicated email columns', () => {
    for (const h of ['email', 'Email', 'e-mail', 'assigned_to.email', 'assignment_group.email', 'caller_id.e-mail']) expect(isDedicatedEmailHeader(h), h).toBe(true);
    for (const h of ['email_notes', 'Emails sent', 'Caller email', 'description', 'emailed', 'work_notes']) expect(isDedicatedEmailHeader(h), h).toBe(false);
  });

  const csv = 'number,short_description,assigned_to,assigned_to.email,assignment_group.email,opened_by,closed_by,sys_updated_by,cmdb_ci\r\n'
    + 'INC1,Queue backlog,Analyst One,one@example.com,ag@example.com,Person A,Person B,Person C,CI-1\r\n'
    + 'INC2,Queue backlog,Analyst Two,two@example.com,ag@example.com,Person A,Person B,Person C,CI-2\r\n';
  const t = table(csv);

  it('drops dedicated email columns before any incident is built', () => {
    expect(t.columns.map(c => c.name)).not.toContain('assigned_to.email');
    expect(t.columns.map(c => c.name)).not.toContain('assignment_group.email');
    for (const row of t.rows) expect(Object.keys(row).some(isDedicatedEmailHeader)).toBe(false);
    expect(JSON.stringify(t.rows.map(r => enrichRow(r)))).not.toContain('@example.com');
    // enrichRow also skips them when called on raw rows (serverless path).
    expect(enrichRow({ Number: 'INC1', 'assigned_to.email': 'x@example.com' }).extraFields).toBeUndefined();
  });

  it('keeps person extras for analysis but leaves them out of the export; assigned_to is unchanged', () => {
    const incidents = t.rows.map(r => enrichRow(r));
    expect(incidents[0].extraFields).toMatchObject({ opened_by: 'Person A', closed_by: 'Person B', sys_updated_by: 'Person C' });
    expect(incidents[0]['Assigned to']).toBe('Analyst One');
    const scores = incidents.map(scoreIncident);
    const annotated = annotateIncidents(incidents);
    const problems = computeProblemClusters(annotated, scores);
    const { workbook } = buildProblemsWorkbook({
      scope: 'view', problems, incidents: annotated, scores, sourceColumns: t.columns, fileName: 'synthetic.csv',
      exportedAt: new Date(Date.UTC(2026, 0, 1)), selectedMonths: [], listFilters: { search: '', category: 'all', onlyUndocumented: false }, rawTextTrimmed: false,
    });
    const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Detalle);
    const headers = Object.keys(detail[0]);
    for (const h of ['opened_by', 'closed_by', 'sys_updated_by', 'assigned_to.email', 'assignment_group.email']) expect(headers).not.toContain(h);
    expect(headers).toContain('Assigned to');
    expect(headers).toContain('cmdb_ci');
    expect(detail.map(r => r['Assigned to'])).toEqual(['Analyst One', 'Analyst Two']);
    expect(JSON.stringify(XLSX.utils.sheet_to_json(workbook.Sheets.Metadatos))).not.toMatch(/opened_by|closed_by|sys_updated_by|\.email/);
    expect(isExportExcludedExtraColumn('assigned_to')).toBe(false);
    expect(isExportExcludedExtraColumn('Assigned to')).toBe(false);
  });
});

describe('input checks', () => {
  const check = (text: string) => checkIncidentTable(utf8(text), table(text));

  it('blocks an empty file and a file with no rows', () => {
    expect(checkIncidentTable(new ArrayBuffer(0), { rows: [], columns: [] }).errors).toEqual(['The file is empty.']);
    expect(check('Number,Short description\r\n').errors).toEqual(['The file has no incident rows.']);
  });

  it('blocks a file missing the incident number or any text to identify problems by', () => {
    expect(check('Short description\r\nx\r\n').errors[0]).toMatch(/incident number/);
    expect(check('Number,Opened\r\nINC1,2026-03-04 07:59:00\r\n').errors[0]).toMatch(/short description or description/);
  });

  it('accepts display labels and technical names alike, plus unknown columns', () => {
    expect(check('Number,Short description\r\nINC1,x\r\n').errors).toEqual([]);
    expect(check('number,description,anything\r\nINC1,x,y\r\n').errors).toEqual([]);
  });

  it('only warns when the structure looks damaged — it never rejects', () => {
    const unbalanced = check('Number,Short description\r\nINC1,"open\r\nINC2,b\r\n');
    expect(unbalanced.errors).toEqual([]);
    expect(unbalanced.warnings.join(' ')).toMatch(/odd number of double quotes/);
    const misaligned = check('Number,Short description\r\nINC1,x,extra value\r\n');
    expect(misaligned.errors).toEqual([]);
    expect(misaligned.warnings.join(' ')).toMatch(/no header/);
    expect(check('Number,Short description\r\nINC1,"a ""quoted"" value"\r\n').warnings).toEqual([]);
  });

  it('detects the format from the bytes, never from a MIME type or file name', () => {
    // Windows often reports a .csv as application/vnd.ms-excel. The parser never
    // sees that type or the name: it receives only the bytes and reads them by content.
    const csvBytes = utf8('Number,Short description\r\nINC1,x\r\n');
    expect(parseExcelFile.length).toBe(1);
    expect(parseExcelFile(csvBytes)[0].Number).toBe('INC1');
    const ws = XLSX.utils.aoa_to_sheet([['Number', 'Short description'], ['INC1', 'x']]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'S');
    expect(parseExcelFile(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)[0].Number).toBe('INC1');
  });
});

describe('zero-variance fields are discovered, not configured', () => {
  it('reports a single-valued column through the dataset profile', () => {
    const t = table('number,short_description,assignment_group,contact_type\r\nINC1,a,AG-1,Channel-Alpha\r\nINC2,b,AG-1,Channel-Beta\r\n');
    const profile = computeDatasetProfile(t.rows.map(r => enrichRow(r, { dateOrder: inferDateOrder(t.rows) })), t.columns);
    expect(profile.values.assignmentGroup.distinct).toBe(1);
    expect(profile.values.channel.distinct).toBe(2);
  });
});
