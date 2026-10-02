import * as XLSX from 'xlsx';
import { AUTO_DESCRIPTION_KEYWORDS, SYSTEM_NOTE_AUTHORS, SYSTEM_NOTE_PHRASES } from '../config/patterns';

export interface RawIncident {
  Number: string;
  'Task type': string;
  Priority: string;
  State: string;
  'Short description': string;
  Description: string;
  'Work notes': string;
  'Assignment group': string;
  'Assigned to': string;
  Opened: string;
  Closed: string;
  Channel: string;
  /** Null when the export has no Made SLA column or leaves the cell blank. */
  'Made SLA': boolean | null;
}

export interface NoteEntry {
  timestamp: string;
  author: string;
  text: string;
  isSystem: boolean;
}

export interface EnrichedIncident extends RawIncident {
  shortDescClean: string;
  descClean: string;
  allNotes: NoteEntry[];
  humanNotes: NoteEntry[];
  isAutoDesc: boolean;
  /**
   * Source columns the canonical model does not map, keyed by their original
   * header and holding the cell value exactly as read. Absent when the export
   * has no such columns.
   */
  extraFields?: Record<string, unknown>;
}

/**
 * One journal entry header on a line of its own:
 * "<timestamp> - <author> (<journal>)", e.g. "2025-03-04 09:12:00 - A. Tech (Work notes)".
 *
 * Any journal label is accepted (Work notes, Additional comments, a localised
 * label), the timestamp may be ISO or day/month with an optional 12-hour clock,
 * and the author cannot span lines. Group 1 is the line break preceding the
 * header, so the header itself starts after it.
 */
const NOTE_HEADER_RE = /(^|\n|_x000D_)[ \t]*((?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4})[ T]+\d{1,2}:\d{2}(?::\d{2})?(?:[ \t]*[AaPp][Mm])?)[ \t]*-[ \t]*([^\n]+?)[ \t]*\([^()\n]+\)[ \t]*(?=_x000D_|\r?\n|$)/g;

// Instance/tool wording for system notes and alert descriptions lives in the
// versioned registry, src/config/patterns.ts.
const SYSTEM_PHRASES = SYSTEM_NOTE_PHRASES.values;
const SYSTEM_AUTHORS = SYSTEM_NOTE_AUTHORS.values;
const AUTO_DESC_KW = AUTO_DESCRIPTION_KEYWORDS.values;

function cleanText(text: string): string {
  if (!text) return "";
  let t = text;
  t = t.replace(/_x000D_/g, "\n");
  t = t.replace(/\[\/?(code)\]/g, "");
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/https?:\/\/\S+/g, "[URL]");
  t = t.replace(/nav_to\.do\S+/g, "[URL]");
  t = t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/g, "");
  t = t.replace(/\s{3,}/g, "  ");
  return t.trim();
}

function isSystemText(text: string): boolean {
  const t = text.toLowerCase();
  return SYSTEM_PHRASES.some(p => t.includes(p));
}

function isAutoDescription(text: string): boolean {
  const t = (text || "").toLowerCase();
  return AUTO_DESC_KW.some(k => t.includes(k));
}

function parseNotes(raw: string): NoteEntry[] {
  if (!raw || typeof raw !== 'string') return [];
  const headers = [...raw.matchAll(NOTE_HEADER_RE)].map(m => ({
    start: m.index! + m[1].length,
    end: m.index! + m[0].length,
    timestamp: m[2].trim(),
    author: m[3].trim(),
  }));

  // Each entry's body runs from the end of its header to the next header.
  const entries: NoteEntry[] = headers.map((h, i) => {
    const text = cleanText(raw.slice(h.end, headers[i + 1]?.start ?? raw.length));
    const isSystem = SYSTEM_AUTHORS.includes(h.author.toLowerCase()) || isSystemText(text);
    return { timestamp: h.timestamp, author: h.author, text, isSystem };
  });
  if (entries.length === 0 && raw.trim()) {
    entries.push({ timestamp: "", author: "Unknown", text: cleanText(raw), isSystem: false });
  }
  return entries;
}

/** One raw spreadsheet row, keyed by whatever headers the export happened to use. */
export type IncidentRow = Record<string, unknown>;

/**
 * Source headers read into each canonical field: the ServiceNow display name
 * first, then the field name. Every header listed here is mapped; any other
 * column is kept verbatim in `extraFields`.
 */
const SOURCE_COLUMNS = {
  Number: ['Number', 'number'],
  'Task type': ['Task type', 'sys_class_name'],
  Priority: ['Priority', 'priority'],
  State: ['State', 'state'],
  'Short description': ['Short description', 'short_description'],
  Description: ['Description', 'description'],
  'Work notes': ['Work notes', 'work_notes'],
  'Assignment group': ['Assignment group', 'assignment_group'],
  'Assigned to': ['Assigned to', 'assigned_to'],
  Opened: ['Opened', 'opened_at'],
  Closed: ['Closed', 'closed_at'],
  Channel: ['Channel', 'contact_type'],
  'Made SLA': ['Made SLA', 'made_sla'],
} as const satisfies Record<keyof RawIncident, readonly string[]>;

const MAPPED_HEADERS: ReadonlySet<string> = new Set(Object.values(SOURCE_COLUMNS).flat());

/** True when a source header is read into the canonical model. */
export function isMappedColumn(header: string): boolean {
  return MAPPED_HEADERS.has(header);
}

/** The row's unmapped columns, in source order, or undefined when there are none. */
function unmappedFields(row: IncidentRow): Record<string, unknown> | undefined {
  let extra: Record<string, unknown> | undefined;
  for (const key of Object.keys(row)) {
    if (MAPPED_HEADERS.has(key)) continue;
    (extra ??= {})[key] = row[key];
  }
  return extra;
}

/** First present value among `keys`, so display names and field names both work. */
function col(row: IncidentRow, keys: readonly string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined) return row[k];
  }
  return '';
}

/**
 * Coerce a spreadsheet cell to a boolean.
 *
 * Exports write this column as a real boolean, as 0/1, or as text — and `false`
 * arrives as the *string* "FALSE" often enough that a bare Boolean() cast reads
 * every row as a pass.
 */
function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return /^(true|yes|y|1|si|sí)$/i.test(value.trim());
  }
  return Boolean(value);
}

/**
 * Made SLA as recorded, or null when the export does not say.
 *
 * A missing column or blank cell is unknown, not a breach: reading it as false
 * reported every closed incident as having missed SLA.
 */
function toSlaFlag(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return toBool(value);
}

/** How a numeric day/month text date is written: 13/03/2025 or 03/13/2025. */
export type DateOrder = 'dmy' | 'mdy';

export interface EnrichOptions {
  /** Order for text dates whose day and month are both ≤ 12. Defaults to 'dmy'. */
  dateOrder?: DateOrder;
}

/** dd/mm/yyyy or mm/dd/yyyy (/, - or . separated), optional time and AM/PM. */
const DAY_MONTH_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;

const DATE_COLUMNS = [...SOURCE_COLUMNS.Opened, ...SOURCE_COLUMNS.Closed];

/**
 * Decide whether a file writes text dates day-first or month-first.
 *
 * A single date like 04/03/2025 cannot say, so the whole file is examined: a
 * first number above 12 means day-first, a second number above 12 means
 * month-first. A file where nothing decides it is read day-first.
 */
export function inferDateOrder(rows: IncidentRow[]): DateOrder {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const row of rows) {
    for (const key of DATE_COLUMNS) {
      const value = row[key];
      if (typeof value !== 'string') continue;
      const m = value.trim().match(DAY_MONTH_RE);
      if (!m) continue;
      if (+m[1] > 12) dayFirst++;
      else if (+m[2] > 12) monthFirst++;
    }
  }
  return monthFirst > dayFirst ? 'mdy' : 'dmy';
}

/** A day/month text date as "YYYY-MM-DD HH:MM:SS", or null if it is not one. */
function parseDayMonthDate(text: string, order: DateOrder): string | null {
  const m = text.trim().match(DAY_MONTH_RE);
  if (!m) return null;
  const [, a, b, y, h = '0', mi = '0', s = '0', meridiem] = m;
  // An unambiguous value overrides the file-level order.
  const dayFirst = +a > 12 || (+b <= 12 && order === 'dmy');
  const day = dayFirst ? +a : +b;
  const month = dayFirst ? +b : +a;
  let hour = +h;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  }
  const date = new Date(Date.UTC(+y, month - 1, day, hour, +mi, +s));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getUTCHours() !== hour) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeDate(value: unknown, order: DateOrder): string {
  if (!value) return '';
  if (value instanceof Date) {
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  if (typeof value === 'number') {
    // An Excel serial is fractional days, and most times of day are not exact in
    // binary: 23:14:56 is stored as 46291.9687037037, whose product with
    // 86,400,000 lands a fraction of a millisecond *before* the second. Slicing
    // the ISO string then truncated it to 23:14:55. Round to the nearest whole
    // second — the precision of this format and of Excel's hh:mm:ss display.
    const seconds = Math.round(value * 86400);
    const d = new Date(Date.UTC(1899, 11, 30) + seconds * 1000);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }
  return parseDayMonthDate(String(value), order) ?? String(value);
}

/**
 * Turn one raw spreadsheet row into an incident with cleaned text and split notes.
 *
 * This is the single definition used by both the browser worker and the
 * serverless API - keep enrichment changes here rather than copying them.
 */
export function enrichRow(row: IncidentRow, options: EnrichOptions = {}): EnrichedIncident {
  const dateOrder = options.dateOrder ?? 'dmy';
  const shortDesc = String(col(row, SOURCE_COLUMNS['Short description']));
  const desc = String(col(row, SOURCE_COLUMNS.Description));
  const workNotes = String(col(row, SOURCE_COLUMNS['Work notes']));
  const allNotes = parseNotes(workNotes);
  const humanNotes = allNotes.filter(n => !n.isSystem);
  const extraFields = unmappedFields(row);

  return {
    Number: String(col(row, SOURCE_COLUMNS.Number)),
    'Task type': String(col(row, SOURCE_COLUMNS['Task type']) || 'Incident'),
    Priority: String(col(row, SOURCE_COLUMNS.Priority))
      .replace(/\u00e2\u20ac\u201c/g, '\u2013')
      .replace(/\u00e2\u20ac\u0153/g, '\u201c')
      .replace(/\u00e2\u20ac\u009d/g, '\u201d')
      .trim(),
    State: String(col(row, SOURCE_COLUMNS.State)),
    'Short description': shortDesc,
    Description: desc,
    'Work notes': workNotes,
    'Assignment group': String(col(row, SOURCE_COLUMNS['Assignment group'])),
    'Assigned to': String(col(row, SOURCE_COLUMNS['Assigned to'])),
    Opened: normalizeDate(col(row, SOURCE_COLUMNS.Opened), dateOrder),
    Closed: normalizeDate(col(row, SOURCE_COLUMNS.Closed), dateOrder),
    Channel: String(col(row, SOURCE_COLUMNS.Channel)),
    'Made SLA': toSlaFlag(col(row, SOURCE_COLUMNS['Made SLA'])),
    shortDescClean: cleanText(shortDesc),
    descClean: cleanText(desc),
    allNotes,
    humanNotes,
    isAutoDesc: isAutoDescription(desc),
    ...(extraFields && { extraFields }),
  };
}

const READ_OPTIONS = {
  cellFormula: false,
  cellHTML: false,
  cellStyles: false,
  dense: true,
  // Number formats, so an unmapped date column can be written back as a date.
  cellNF: true,
  // Keep text-format cells (CSV, HTML) as written. Otherwise SheetJS converts
  // date-looking strings with US month/day rules before we can see them.
  raw: true,
} as const;

/**
 * True when the bytes are a binary spreadsheet container, or text whose
 * encoding SheetJS already detects from its byte-order mark.
 */
function isBinaryOrMarkedText(bytes: Uint8Array): boolean {
  const [a, b, c, d] = bytes;
  if (a === 0x50 && b === 0x4b && c === 0x03 && d === 0x04) return true; // zip: xlsx, xlsb, ods
  if (a === 0xd0 && b === 0xcf && c === 0x11 && d === 0xe0) return true; // OLE2: legacy xls
  if ((a === 0xff && b === 0xfe) || (a === 0xfe && b === 0xff)) return true; // UTF-16 BOM
  return false;
}

/**
 * Decode a text export. SheetJS reads BOM-less text as Latin-1, which turns
 * UTF-8 accents into mojibake ("Contraseña" -> "ContraseÃ±a"), so decode it
 * ourselves: UTF-8 when the bytes are valid UTF-8, else Windows-1252, which is
 * what Excel writes for "CSV (comma delimited)".
 */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Parse an uploaded file into a workbook, decoding text exports explicitly. */
export function readWorkbook(buffer: ArrayBuffer): XLSX.WorkBook {
  const bytes = new Uint8Array(buffer);
  if (isBinaryOrMarkedText(bytes)) {
    return XLSX.read(buffer, { type: 'array', ...READ_OPTIONS });
  }
  return XLSX.read(decodeText(bytes), { type: 'string', ...READ_OPTIONS });
}

/**
 * What an unmapped column holds, decided once over every row of the source:
 * - `date`: every non-empty cell is an Excel date, or ISO text `YYYY-MM-DD[ HH:MM[:SS]]`.
 * - `number`: every non-empty cell is an Excel number, or plain decimal text —
 *   unless the text column's header names an identifier, whose digits are a code.
 * - `text`: anything else, kept exactly as written.
 */
export type ColumnKind = 'date' | 'number' | 'text';

/** One column of the source sheet, in its original position. */
export interface SourceColumn {
  /** Header as the rows key it (SheetJS renames blanks and duplicates). */
  name: string;
  /** Read into the canonical model rather than kept in `extraFields`. */
  mapped: boolean;
  /** For unmapped columns: how the export should type the column's cells. */
  kind?: ColumnKind;
  /** For unmapped number columns: the source's non-General number format, if any. */
  numFmt?: string;
}

export interface IncidentTable {
  rows: IncidentRow[];
  /** Every column of the sheet, in source order. */
  columns: SourceColumn[];
}

/** ISO date text as ServiceNow writes it, with optional minutes and seconds. */
export const ISO_DATE_TEXT_RE = /^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?::\d{2})?)?$/;

/** Plain decimal text that converts to a number without losing anything. */
const PLAIN_NUMBER_TEXT_RE = /^-?(?:0|[1-9]\d{0,14})(?:\.\d+)?$/;

/** Headers whose digits are codes, not quantities: ID, number, code, key, ref... */
function isIdentifierHeader(header: string): boolean {
  return /(^|[^a-z])(ids?|numbers?|no|nbr|num|codes?|keys?|refs?|sys_id)([^a-z]|$)|#/i.test(header)
    || /[a-z](ID|Id)\b/.test(header);
}

/** Type an unmapped column from all of its data cells. */
function classifyColumn(sheet: XLSX.WorkSheet, header: string, col: number, firstRow: number, lastRow: number): Pick<SourceColumn, 'kind' | 'numFmt'> {
  const dense = sheet as unknown as XLSX.CellObject[][];
  let dates = 0;
  let numbers = 0;
  let numberText = 0;
  let other = 0;
  let numFmt: string | undefined;

  for (let r = firstRow; r <= lastRow; r++) {
    const cell = dense[r]?.[col];
    if (!cell || cell.v === undefined || cell.v === null || cell.v === '') continue;
    if (cell.t === 'n') {
      if (typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z)) dates++;
      else {
        numbers++;
        if (!numFmt && typeof cell.z === 'string' && cell.z !== 'General') numFmt = cell.z;
      }
    } else if (cell.t === 'd') {
      dates++;
    } else if (cell.t === 's' && typeof cell.v === 'string') {
      const text = cell.v.trim();
      if (!text) continue;
      if (ISO_DATE_TEXT_RE.test(text)) dates++;
      else if (PLAIN_NUMBER_TEXT_RE.test(text)) numberText++;
      else other++;
    } else {
      other++;
    }
  }

  const filled = dates + numbers + numberText + other;
  if (filled > 0 && dates === filled) return { kind: 'date' };
  if (filled > 0 && numbers + numberText === filled && (numberText === 0 || !isIdentifierHeader(header))) {
    return numFmt ? { kind: 'number', numFmt } : { kind: 'number' };
  }
  return { kind: 'text' };
}

/**
 * Read the first sheet into header-keyed rows plus its column layout.
 *
 * The layout keeps the source column order and the type of each unmapped
 * column, so an export can rebuild those columns as they were.
 */
export function readIncidentTable(buffer: ArrayBuffer): IncidentTable {
  const wb = readWorkbook(buffer);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], columns: [] };
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<IncidentRow>(sheet, { defval: '' });
  if (rows.length === 0 || !sheet['!ref']) return { rows, columns: [] };

  // With `defval` every row carries every header, in sheet column order.
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const columns = Object.keys(rows[0]).map((name, i): SourceColumn => {
    const mapped = MAPPED_HEADERS.has(name);
    if (mapped) return { name, mapped };
    return { name, mapped, ...classifyColumn(sheet, name, range.s.c + i, range.s.r + 1, range.e.r) };
  });
  return { rows, columns };
}

/** Read the first sheet of a workbook into plain header-keyed rows. */
export function readIncidentRows(buffer: ArrayBuffer): IncidentRow[] {
  return readIncidentTable(buffer).rows;
}

export function parseExcelFile(buffer: ArrayBuffer): EnrichedIncident[] {
  const rows = readIncidentRows(buffer);
  const dateOrder = inferDateOrder(rows);
  return rows.map(row => enrichRow(row, { dateOrder }));
}
