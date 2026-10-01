import * as XLSX from 'xlsx';

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
}

const NOTE_RE = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*-\s*(.+?)\s*\(Work notes\)\n(.*?)(?=\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s*-|$)/gs;

const SYSTEM_PHRASES = [
  "sent communication to", "could not contact", "task is created by system",
  "escalation is in progress", "escalate in", "faq on alerts",
  "predicted ag:", "attachment added", "why was this incident created",
  "how is the priority", "confidence:",
];

const AUTO_DESC_KW = [
  "we have identified unusually", "alert triggered at", "usage overview",
  "cluster name", "namespace :", "container name:", "pod name:",
  "document count:", "conditions met:", "links for investigation",
];

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
  const entries: NoteEntry[] = [];
  let match;
  NOTE_RE.lastIndex = 0;
  while ((match = NOTE_RE.exec(raw)) !== null) {
    const [, ts, author, body] = match;
    const text = cleanText(body);
    const isSystem = author.trim().toLowerCase() === 'system' || isSystemText(text);
    entries.push({ timestamp: ts.trim(), author: author.trim(), text, isSystem });
  }
  if (entries.length === 0 && raw.trim()) {
    entries.push({ timestamp: "", author: "Unknown", text: cleanText(raw), isSystem: false });
  }
  return entries;
}

/** One raw spreadsheet row, keyed by whatever headers the export happened to use. */
export type IncidentRow = Record<string, unknown>;

/** First present value among `keys`, so display names and field names both work. */
function col(row: IncidentRow, ...keys: string[]): unknown {
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

const DATE_COLUMNS = ['Opened', 'opened_at', 'Closed', 'closed_at'];

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
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const ms = epoch.getTime() + value * 86400000;
    const d = new Date(ms);
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
  const shortDesc = String(col(row, 'Short description', 'short_description'));
  const desc = String(col(row, 'Description', 'description'));
  const workNotes = String(col(row, 'Work notes', 'work_notes'));
  const allNotes = parseNotes(workNotes);
  const humanNotes = allNotes.filter(n => !n.isSystem);

  return {
    Number: String(col(row, 'Number', 'number')),
    'Task type': String(col(row, 'Task type', 'sys_class_name') || 'Incident'),
    Priority: String(col(row, 'Priority', 'priority'))
      .replace(/\u00e2\u20ac\u201c/g, '\u2013')
      .replace(/\u00e2\u20ac\u0153/g, '\u201c')
      .replace(/\u00e2\u20ac\u009d/g, '\u201d')
      .trim(),
    State: String(col(row, 'State', 'state')),
    'Short description': shortDesc,
    Description: desc,
    'Work notes': workNotes,
    'Assignment group': String(col(row, 'Assignment group', 'assignment_group')),
    'Assigned to': String(col(row, 'Assigned to', 'assigned_to')),
    Opened: normalizeDate(col(row, 'Opened', 'opened_at'), dateOrder),
    Closed: normalizeDate(col(row, 'Closed', 'closed_at'), dateOrder),
    Channel: String(col(row, 'Channel', 'contact_type')),
    'Made SLA': toSlaFlag(col(row, 'Made SLA', 'made_sla')),
    shortDescClean: cleanText(shortDesc),
    descClean: cleanText(desc),
    allNotes,
    humanNotes,
    isAutoDesc: isAutoDescription(desc),
  };
}

const READ_OPTIONS = {
  cellFormula: false,
  cellHTML: false,
  cellStyles: false,
  dense: true,
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

/** Read the first sheet of a workbook into plain header-keyed rows. */
export function readIncidentRows(buffer: ArrayBuffer): IncidentRow[] {
  const wb = readWorkbook(buffer);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<IncidentRow>(wb.Sheets[sheetName], { defval: '' });
}

export function parseExcelFile(buffer: ArrayBuffer): EnrichedIncident[] {
  const rows = readIncidentRows(buffer);
  const dateOrder = inferDateOrder(rows);
  return rows.map(row => enrichRow(row, { dateOrder }));
}
