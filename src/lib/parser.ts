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
  'Made SLA': boolean;
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

function col(row: Record<string, any>, ...keys: string[]): any {
  for (const k of keys) {
    if (row[k] !== undefined) return row[k];
  }
  return '';
}

function normalizeDate(value: any): string {
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
  return String(value);
}

export function parseExcelFile(buffer: ArrayBuffer): EnrichedIncident[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[sheetName]);

  return rows.map(row => {
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
      Opened: normalizeDate(col(row, 'Opened', 'opened_at')),
      Closed: normalizeDate(col(row, 'Closed', 'closed_at')),
      Channel: String(col(row, 'Channel', 'contact_type')),
      'Made SLA': Boolean(col(row, 'Made SLA', 'made_sla')),
      shortDescClean: cleanText(shortDesc),
      descClean: cleanText(desc),
      allNotes,
      humanNotes,
      isAutoDesc: isAutoDescription(desc),
    };
  });
}
