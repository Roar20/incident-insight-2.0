/**
 * Deterministic behaviour snapshot of the ingestion → scoring → aggregation
 * pipeline, used to compare the app before and after a change.
 *
 *   npx vite-node scripts/baseline.ts docs/baseline_before.json [label]
 *   npx vite-node scripts/baseline.ts docs/baseline_after.json  [label] [real-export.xlsx|csv ...]
 *
 * A synthetic incident set (fixed seed) is rendered into several export
 * variants. `control` triggers none of the known ingestion bugs, so any change
 * to it is a regression; every other variant isolates one export trait (CSV
 * encoding, BOM, missing Made SLA, dd/mm dates, mixed journal entries) so a
 * before/after difference can be attributed to a specific fix.
 *
 * The pipeline mirrors `src/workers/scoringWorker.ts`. It runs unchanged on
 * code before and after the date fix: `inferDateOrder` is used when the parser
 * exports it, exactly as the worker does.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as XLSX from 'xlsx';
import * as parser from '../src/lib/parser';
import type { EnrichedIncident, IncidentRow } from '../src/lib/parser';
import { scoreIncident, type IncidentScore } from '../src/lib/scorer';
import { annotateIncidents, computeCategoryStats, computeProblemClusters } from '../src/lib/problems';
import { computePeriodTrends } from '../src/lib/trends';
import { parseMonthKey } from '../src/lib/analytics';
import { ROOT_CAUSE_RE, extractRootCause } from '../src/lib/rootCause';

const SEED = 20250301;
const INCIDENTS = 120;

// ---------------------------------------------------------------------------
// Synthetic incidents
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Note { at: Date; author: string; text: string; journal: 'Work notes' | 'Additional comments' }

interface BaseIncident {
  number: string;
  priority: string;
  state: string;
  shortDescription: string;
  description: string;
  notes: Note[];
  group: string;
  agent: string;
  opened: Date;
  closed: Date | null;
  channel: string;
  madeSla: boolean;
}

interface Template {
  short: string;
  desc: string;
  cause: string;
  steps: string;
  group: string;
}

const TEMPLATES: Template[] = [
  { short: 'VPN connection drops every hour for remote staff', desc: 'Remote users report the VPN client disconnects roughly every hour and has to be restarted manually, interrupting calls and file transfers.', cause: 'Root cause was an exhausted licence pool on the VPN concentrator.', steps: 'Increased the licence pool and restarted the concentrator service. Verified with two users.', group: 'Network Operations' },
  { short: 'La VPN se desconecta para usuarios remotos de finanzas', desc: 'Los usuarios remotos de finanzas indican que la VPN se desconecta cada hora y deben volver a iniciar sesión, lo que interrumpe su trabajo.', cause: 'Se identificó que la causa raíz era el agotamiento de licencias en el concentrador.', steps: 'Se amplió el pool de licencias y se reinició el servicio. Se verificó con el usuario.', group: 'Network Operations' },
  { short: 'Contraseña bloqueada, usuario solicita desbloqueo de cuenta', desc: 'El usuario no puede iniciar sesión porque su contraseña quedó bloqueada tras varios intentos fallidos desde el móvil.', cause: 'Se encontró que el móvil seguía usando la contraseña antigua; esa es la causa raíz del bloqueo.', steps: 'Se desbloqueó la cuenta y se actualizó la contraseña en el móvil. Solución confirmada.', group: 'Mesa de Ayuda' },
  { short: 'Password reset required - account locked out after MFA change', desc: 'User is locked out of the domain account after changing the MFA method and cannot reach email or the intranet from any device.', cause: 'The issue was a stale cached credential on the user laptop.', steps: 'Unlocked the account, cleared cached credentials and confirmed login.', group: 'Service Desk' },
  { short: 'Buzón de correo no sincroniza en Outlook desde ayer', desc: 'El buzón del usuario no sincroniza en Outlook desde ayer por la tarde; los correos nuevos sólo aparecen en la versión web.', cause: 'Diagnóstico: el perfil de Outlook estaba dañado.', steps: 'Se recreó el perfil y se verificó la sincronización.', group: 'Messaging' },
  { short: 'Outlook mailbox not syncing for finance users', desc: 'Several finance users report Outlook stops syncing after the morning maintenance window; new mail only appears in webmail.', cause: 'Traced to an expired certificate on the sync connector.', steps: 'Applied the renewed certificate and restarted the sync service. Verified mail flow.', group: 'Messaging' },
  { short: 'Impresora del piso 3 sin conexión otra vez', desc: 'La impresora del piso 3 aparece sin conexión para todo el equipo de contabilidad y los trabajos quedan en cola.', cause: 'Causado por una IP duplicada asignada por DHCP.', steps: 'Se reservó la IP en DHCP y se reinició la impresora. Resuelto.', group: 'Field Services' },
  { short: 'Printer on floor 3 is offline and jobs stay queued', desc: 'The floor 3 printer shows as offline for the accounting team and every job stays in the queue until it is deleted.', cause: 'Caused by a duplicate IP address handed out by DHCP.', steps: 'Reserved the address and restarted the printer. Tested a print job.', group: 'Field Services' },
  { short: 'Disk space full on the reporting file server', desc: 'The reporting file server ran out of disk space overnight and the scheduled exports failed with write errors.', cause: 'Root cause: log rotation was disabled after the last patch.', steps: 'Re-enabled log rotation, cleared old logs and confirmed free space.', group: 'Infra Linux' },
  { short: 'Elasticsearch document count anomaly in prod cluster', desc: 'We have identified unusually high document count. Alert triggered at 03:15 UTC. Cluster name: prod-eu-1. Conditions met: count > threshold.', cause: 'Investigation showed a retry loop in the ingestion job.', steps: 'Fixed the retry configuration and restarted the job.', group: 'Infra Linux' },
  { short: 'Certificado SSL caducado en el portal de intranet', desc: 'Los usuarios ven un aviso de seguridad al entrar al portal de intranet porque el certificado SSL caducó esta mañana.', cause: 'Se debe a que la renovación automática falló por un cambio de DNS.', steps: 'Se renovó el certificado manualmente y se verificó el acceso.', group: 'Infra Linux' },
  { short: 'Application response extremely slow every morning', desc: 'The ERP application response is extremely slow between 8 and 10 every morning for all branches; pages take over a minute to load.', cause: 'Diagnosis: a batch job overlaps business hours.', steps: 'Moved the batch window and verified response times.', group: 'Service Desk' },
];

const AGENTS = Array.from({ length: 12 }, (_, i) => `Agent ${String(i + 1).padStart(2, '0')}`);
const STATES = ['Closed', 'Closed', 'Closed', 'Closed', 'Closed', 'Resolved', 'Resolved', 'In Progress', 'New', 'Canceled'];
const PRIORITIES = ['1 - Critical', '2 - High', '3 – Moderate', '4 - Low'];
const CHANNELS = ['Phone', 'Self-service', 'Email', 'Monitoring'];
const AUTO_CLOSE = 'This incident will be closed due to has been completed';

function buildIncidents(): BaseIncident[] {
  const rnd = mulberry32(SEED);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const out: BaseIncident[] = [];

  for (let i = 0; i < INCIDENTS; i++) {
    const t = TEMPLATES[i % TEMPLATES.length];
    const month = Math.floor(rnd() * 3); // Jan..Mar 2025
    const day = 1 + Math.floor(rnd() * 28);
    const opened = new Date(Date.UTC(2025, month, day, 7 + Math.floor(rnd() * 10), Math.floor(rnd() * 60), 0));
    const state = pick(STATES);
    const isClosed = state === 'Closed' || state === 'Resolved';
    const closed = isClosed ? new Date(opened.getTime() + Math.round((0.5 + rnd() * 72) * 3600000 / 60000) * 60000) : null;
    const agent = pick(AGENTS);

    const notes: Note[] = [];
    let at = new Date(opened.getTime() + 5 * 60000);
    const add = (author: string, text: string, journal: Note['journal'] = 'Work notes') => {
      notes.push({ at, author, text, journal });
      at = new Date(at.getTime() + (20 + Math.floor(rnd() * 200)) * 60000);
    };

    add('System', 'Task is created by system');
    if (rnd() < 0.3) add(agent, pick(['Hi team, please assist the user', 'N/A', 'Please check']));
    const documentsCause = rnd() < 0.5;
    if (documentsCause) add(agent, t.cause);
    if (isClosed || rnd() < 0.3) add(agent, t.steps);
    // Auto-closure template, only on some closed incidents that document no cause.
    if (isClosed && !documentsCause && rnd() < 0.35) add(agent, AUTO_CLOSE);

    out.push({
      number: `INC${String(10001 + i).padStart(7, '0')}`,
      priority: pick(PRIORITIES),
      state,
      shortDescription: t.short,
      description: rnd() < 0.15 ? 'Please check' : t.desc,
      notes,
      group: rnd() < 0.85 ? t.group : 'Service Desk',
      agent,
      opened,
      closed,
      channel: pick(CHANNELS),
      madeSla: rnd() < 0.8,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Export variants
// ---------------------------------------------------------------------------

interface Variant {
  name: string;
  description: string;
  format: 'xlsx' | 'csv';
  bom: boolean;
  headers: 'display' | 'snake';
  dateFormat: 'iso' | 'dmy';
  madeSla: boolean;
  mixedJournal: boolean;
}

const VARIANTS: Variant[] = [
  { name: 'control_xlsx', description: 'XLSX, display headers, ISO text dates, Made SLA present, work notes only. Triggers no known bug — must not change.', format: 'xlsx', bom: false, headers: 'display', dateFormat: 'iso', madeSla: true, mixedJournal: false },
  { name: 'csv_utf8', description: 'Same data as UTF-8 CSV without BOM (F-01 encoding).', format: 'csv', bom: false, headers: 'display', dateFormat: 'iso', madeSla: true, mixedJournal: false },
  { name: 'csv_utf8_bom', description: 'Same data as UTF-8 CSV with BOM (F-02 BOM/Number).', format: 'csv', bom: true, headers: 'display', dateFormat: 'iso', madeSla: true, mixedJournal: false },
  { name: 'xlsx_no_made_sla', description: 'XLSX without the Made SLA column (F-03).', format: 'xlsx', bom: false, headers: 'display', dateFormat: 'iso', madeSla: false, mixedJournal: false },
  { name: 'xlsx_ddmm_text', description: 'XLSX with dd/mm/yyyy text dates in Opened, Closed and work-note headers (F-04).', format: 'xlsx', bom: false, headers: 'display', dateFormat: 'dmy', madeSla: true, mixedJournal: false },
  { name: 'csv_ddmm', description: 'UTF-8 CSV with dd/mm/yyyy dates (F-04 + F-01).', format: 'csv', bom: false, headers: 'display', dateFormat: 'dmy', madeSla: true, mixedJournal: false },
  { name: 'xlsx_mixed_journal', description: 'XLSX whose Work notes column interleaves (Additional comments) entries (F-05).', format: 'xlsx', bom: false, headers: 'display', dateFormat: 'iso', madeSla: true, mixedJournal: true },
  { name: 'csv_combined_snake', description: 'Realistic worst case: CSV with BOM, snake_case headers, dd/mm dates, no Made SLA, mixed journal.', format: 'csv', bom: true, headers: 'snake', dateFormat: 'dmy', madeSla: false, mixedJournal: true },
];

const DISPLAY_TO_SNAKE: Record<string, string> = {
  Number: 'number', Priority: 'priority', State: 'state', 'Short description': 'short_description',
  Description: 'description', 'Work notes': 'work_notes', 'Assignment group': 'assignment_group',
  'Assigned to': 'assigned_to', Opened: 'opened_at', Closed: 'closed_at', Channel: 'contact_type',
  'Made SLA': 'made_sla',
};

const pad = (n: number) => String(n).padStart(2, '0');
function fmtDate(d: Date | null, style: 'iso' | 'dmy'): string {
  if (!d) return '';
  const date = style === 'iso'
    ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    : `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** ServiceNow journal layout: newest entry first, blank line between entries. */
function renderNotes(inc: BaseIncident, v: Variant, rowIndex: number): string {
  const notes = [...inc.notes];
  if (v.mixedJournal && rowIndex % 2 === 0) {
    const first = notes[0];
    notes.splice(1, 0, {
      at: new Date(first.at.getTime() + 60000),
      author: inc.agent,
      text: 'Called the user, waiting for confirmation before closing.',
      journal: 'Additional comments',
    });
  }
  return notes
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map(n => `${fmtDate(n.at, v.dateFormat)} - ${n.author} (${n.journal})\n${n.text}`)
    .join('\n\n');
}

function renderRows(incidents: BaseIncident[], v: Variant): Record<string, unknown>[] {
  return incidents.map((inc, i) => {
    const row: Record<string, unknown> = {
      Number: inc.number,
      Priority: inc.priority,
      State: inc.state,
      'Short description': inc.shortDescription,
      Description: inc.description,
      'Work notes': renderNotes(inc, v, i),
      'Assignment group': inc.group,
      'Assigned to': inc.agent,
      Opened: fmtDate(inc.opened, v.dateFormat),
      Closed: fmtDate(inc.closed, v.dateFormat),
      Channel: inc.channel,
    };
    if (v.madeSla) row['Made SLA'] = inc.madeSla;
    if (v.headers === 'display') return row;
    return Object.fromEntries(Object.entries(row).map(([k, val]) => [DISPLAY_TO_SNAKE[k] ?? k, val]));
  });
}

function toCsv(rows: Record<string, unknown>[]): string {
  const headers = Object.keys(rows[0]);
  const cell = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
  return [headers.map(cell).join(','), ...rows.map(r => headers.map(h => cell(r[h])).join(','))].join('\r\n') + '\r\n';
}

function encodeVariant(rows: Record<string, unknown>[], v: Variant): ArrayBuffer {
  if (v.format === 'xlsx') {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Page 1');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  }
  const bytes = new TextEncoder().encode((v.bom ? '﻿' : '') + toCsv(rows));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// Pipeline (mirrors src/workers/scoringWorker.ts) and snapshot
// ---------------------------------------------------------------------------

type EnrichFn = (row: IncidentRow, options?: unknown) => EnrichedIncident;
const inferDateOrder = (parser as Record<string, unknown>).inferDateOrder as
  ((rows: IncidentRow[]) => unknown) | undefined;

function runPipeline(buffer: ArrayBuffer) {
  const rows = parser.readIncidentRows(buffer);
  const options = inferDateOrder ? { dateOrder: inferDateOrder(rows) } : undefined;
  const incidents = rows.map(r => (parser.enrichRow as EnrichFn)(r, options));
  const scores = incidents.map(scoreIncident);
  const annotated = annotateIncidents(incidents);
  return { incidents: annotated, scores, dateOrder: options?.dateOrder ?? null };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, whole: number) => (whole > 0 ? round1((part / whole) * 100) : 0);

const AUTO_CLOSE_RE = /this incident will be closed due (yo|to) has been completed/gi;

function snapshot(buffer: ArrayBuffer) {
  const { incidents, scores, dateOrder } = runPipeline(buffer);
  // The app joins scores to incidents by Number (AllIncidentsPage, analytics).
  const scoreByNumber = new Map(scores.map(s => [s.number, s]));

  const closed = incidents.filter(i => i.isClosed);
  const slaKnown = closed.filter(i => typeof i['Made SLA'] === 'boolean');
  const slaBreached = slaKnown.filter(i => i['Made SLA'] === false);
  const labels = { Excellent: 0, Good: 0, Poor: 0, Critical: 0 } as Record<IncidentScore['label'], number>;
  for (const s of scores) labels[s.label]++;
  const categoryCounts: Record<string, number> = {};
  for (const i of incidents) categoryCounts[i.category] = (categoryCounts[i.category] ?? 0) + 1;

  // Proposed scorer v2 (NOT applied): ignore the auto-closure template when
  // looking for a documented root cause.
  const combined = (i: EnrichedIncident) => [i.descClean, ...i.humanNotes.map(n => n.text)].join('\n');
  const rcNow = incidents.map(i => ROOT_CAUSE_RE.test(combined(i)));
  const rcV2 = incidents.map(i => ROOT_CAUSE_RE.test(combined(i).replace(AUTO_CLOSE_RE, '')));
  const rcaNow = incidents.filter(i => i.rootCauseText).length;
  const rcaV2 = incidents.filter(i => extractRootCause(combined(i).replace(AUTO_CLOSE_RE, ''))).length;

  return {
    summary: {
      rows: incidents.length,
      distinctNumbers: new Set(incidents.map(i => i.Number)).size,
      emptyNumbers: incidents.filter(i => !i.Number).length,
      dateOrder,
      openedWithMonth: incidents.filter(i => parseMonthKey(i.Opened)).length,
      openedWithWeek: incidents.filter(i => i.week).length,
      withResolutionTime: incidents.filter(i => i.resolutionHours !== null).length,
      months: [...new Set(incidents.map(i => parseMonthKey(i.Opened)).filter(Boolean))].sort(),
      mojibakeRows: incidents.filter(i => /Ã|â€/.test(i['Short description'] + i.Description)).length,
      avgScore: round1(scores.reduce((a, s) => a + s.totalScore, 0) / Math.max(1, scores.length)),
      labels,
      noRootCausePct: pct(scores.filter(s => s.dimScores.root_cause === 0).length, scores.length),
      rcaCoveragePct: pct(rcaNow, incidents.length),
      humanNotes: incidents.reduce((a, i) => a + i.humanNotes.length, 0),
      systemNotes: incidents.reduce((a, i) => a + (i.allNotes.length - i.humanNotes.length), 0),
      unknownAuthorNotes: incidents.reduce((a, i) => a + i.allNotes.filter(n => n.author === 'Unknown').length, 0),
      multilineAuthors: incidents.reduce((a, i) => a + i.allNotes.filter(n => n.author.includes('\n')).length, 0),
      sla: {
        closed: closed.length,
        withValue: slaKnown.length,
        breached: slaBreached.length,
        breachPct: slaKnown.length > 0 ? pct(slaBreached.length, slaKnown.length) : null,
      },
      recurringProblems: computeProblemClusters(incidents, scores).length,
      categoryCounts,
    },
    autoCloseRootCauseProposal: {
      incidentsWithTemplate: incidents.filter(i => /this incident will be closed due (yo|to) has been completed/i.test(combined(i))).length,
      noRootCausePctNow: pct(rcNow.filter(x => !x).length, incidents.length),
      noRootCausePctV2: pct(rcV2.filter(x => !x).length, incidents.length),
      incidentsLosingRootCause: rcNow.filter((x, k) => x && !rcV2[k]).length,
      rcaCoveragePctNow: pct(rcaNow, incidents.length),
      rcaCoveragePctV2: pct(rcaV2, incidents.length),
    },
    categories: computeCategoryStats(incidents, scores).map(c => ({
      name: c.name, count: c.count, rcaCoverage: c.rcaCoverage, slaBreachPct: c.slaBreachPct, avgScore: c.avgScore,
    })),
    months: computePeriodTrends(incidents, scores, 'month').map(t => ({
      key: t.key, count: t.count, avgScore: t.avgScore, slaBreachPct: t.slaBreachPct, rcaCoveragePct: t.rcaCoveragePct,
    })),
    incidents: incidents.map((i, row) => ({
      row,
      number: i.Number,
      opened: i.Opened,
      category: i.category,
      humanNotes: i.humanNotes.length,
      totalScore: scores[row].totalScore,
      label: scores[row].label,
      rootCause: scores[row].dimScores.root_cause,
      // What All Incidents displays after its Number-keyed join.
      displayedScore: scoreByNumber.get(i.Number)?.totalScore ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------

const [outPath, label = 'snapshot', ...realFiles] = process.argv.slice(2);
if (!outPath) {
  console.error('usage: vite-node scripts/baseline.ts <out.json> [label] [real export files...]');
  process.exit(1);
}

const base = buildIncidents();
const variants: Record<string, unknown> = {};
for (const v of VARIANTS) {
  const { name, ...file } = v;
  variants[name] = { file, ...snapshot(encodeVariant(renderRows(base, v), v)) };
}
const real: Record<string, unknown> = {};
for (const f of realFiles) {
  const buf = readFileSync(f);
  real[basename(f)] = snapshot(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

writeFileSync(outPath, JSON.stringify({
  label,
  dataset: { generator: 'scripts/baseline.ts', seed: SEED, incidentsPerVariant: INCIDENTS },
  variants,
  ...(realFiles.length ? { realFiles: real } : {}),
}, null, 2) + '\n');

for (const [name, v] of Object.entries(variants) as [string, ReturnType<typeof snapshot>][]) {
  const s = v.summary;
  console.log(
    name.padEnd(20),
    `num=${s.distinctNumbers}/${s.rows}`, `month=${s.openedWithMonth}`, `week=${s.openedWithWeek}`,
    `moji=${s.mojibakeRows}`, `avg=${s.avgScore}`, `noRC=${s.noRootCausePct}%`, `rca=${s.rcaCoveragePct}%`,
    `notes h/s/u/ml=${s.humanNotes}/${s.systemNotes}/${s.unknownAuthorNotes}/${s.multilineAuthors}`,
    `sla=${s.sla.breachPct}% (${s.sla.breached}/${s.sla.withValue})`, `probs=${s.recurringProblems}`,
  );
}
