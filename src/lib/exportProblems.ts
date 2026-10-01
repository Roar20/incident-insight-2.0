/**
 * Recurring-problem export to XLSX, built entirely in the browser.
 *
 * Every value comes from the objects that already feed the dashboard — the
 * `ProblemCluster`s, the annotated incidents and their scores — so nothing is
 * recomputed here and the workbook cannot disagree with the screen.
 */
import * as XLSX from 'xlsx';
import { monthLabel } from './analytics';
import type { SourceColumn } from './parser';
import { formatDuration } from './periods';
import type { ProblemListFilters } from './problemView';
import type { AnnotatedIncident, NamedCount, ProblemCluster } from './problems';
import type { IncidentScore } from './scorer';
import { SCORER_VERSION } from './scorerVersion';

export const SHEET_PROBLEMS = 'Problemas';
export const SHEET_DETAIL = 'Detalle';
export const SHEET_METADATA = 'Metadatos';

/** Most characters Excel accepts in one cell. */
export const EXCEL_CELL_LIMIT = 32_767;

/** Written in place of Description / Work notes the worker dropped to save memory. */
export const RAW_TEXT_UNAVAILABLE =
  '[No disponible: el archivo tiene más de 10.000 filas y la app descarta este texto original para ahorrar memoria]';

export const PROBLEM_COLUMNS = [
  'ID de problema', 'Título', 'Categoría', 'Número de incidentes', '% share', 'Semanas activas',
  'Patrón', '% con causa raíz', 'Incidentes con causa documentada', 'Mediana de resolución',
  'Mediana de resolución (horas)', '% SLA incumplido', 'Score medio', 'Top 3 causas documentadas',
  'Assignment Groups principales', 'Agentes principales', 'Primer visto', 'Último visto',
] as const;

/** Canonical incident fields, in the order the Detalle sheet lists them. */
export const CANONICAL_COLUMNS = [
  'Number', 'Task type', 'Priority', 'State', 'Short description', 'Description', 'Work notes',
  'Assignment group', 'Assigned to', 'Opened', 'Closed', 'Channel', 'Made SLA',
] as const satisfies readonly (keyof AnnotatedIncident)[];

export const DETAIL_COLUMNS = [
  'ID de problema', 'Título del problema',
  ...CANONICAL_COLUMNS,
  'Categoría', 'Semana ISO', 'Horas de resolución', 'Cerrado',
  'Score', 'Score label', 'Score: description_quality', 'Score: root_cause',
  'Score: steps_documented', 'Score: spelling_grammar', 'Score: professionalism',
  'Causa raíz documentada',
] as const;

/** How the `Patrón` column represents the app's chronic classification. */
export const PATTERN_DEFINITION =
  "'chronic' = el problema es crónico en la app (isChronic: 3+ semanas ISO distintas y 3+ incidentes); vacío = no crónico";

export interface ProblemExportInput {
  /** Whole Problems view, or the single problem open in the modal. */
  scope: 'view' | 'problem';
  /** The problems to export, in on-screen order. */
  problems: ProblemCluster[];
  /** The month-filtered incidents the problems were aggregated from. */
  incidents: AnnotatedIncident[];
  scores: IncidentScore[];
  sourceColumns: SourceColumn[];
  fileName: string;
  exportedAt: Date;
  /** Selected `YYYY-MM` months; empty means no month filter. */
  selectedMonths: string[];
  listFilters: ProblemListFilters;
  rawTextTrimmed: boolean;
}

export interface ProblemExport {
  workbook: XLSX.WorkBook;
  problemCount: number;
  incidentCount: number;
  truncatedCells: number;
}

type Cell = string | number | boolean | null;

function formatCounts(items: NamedCount[]): string {
  return items.map(i => `${i.name} (${i.count})`).join('; ');
}

function formatRootCauses(problem: ProblemCluster): string {
  return problem.rootCauses
    .slice(0, 3)
    .map((rc, i) => `${i + 1}. ${rc.text} — ${rc.count}× (${rc.pct}%)`)
    .join('\n');
}

/** Earliest and latest `Opened` among the incidents, as "first → last". */
function openedRange(incidents: AnnotatedIncident[]): string {
  let first = '';
  let last = '';
  for (const inc of incidents) {
    if (!inc.Opened) continue;
    if (!first || inc.Opened < first) first = inc.Opened;
    if (!last || inc.Opened > last) last = inc.Opened;
  }
  return first ? `${first} → ${last}` : '—';
}

/** Build the three-sheet workbook. Pure: no download, no globals. */
export function buildProblemsWorkbook(input: ProblemExportInput): ProblemExport {
  let truncatedCells = 0;

  // Only the value written to the workbook is truncated; the app's data is untouched.
  const fit = (value: unknown): Cell => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    const text = String(value);
    if (text.length <= EXCEL_CELL_LIMIT) return text;
    truncatedCells++;
    const marker = `\n…[TRUNCADO: el valor original tiene ${text.length} caracteres; Excel admite ${EXCEL_CELL_LIMIT}]`;
    return text.slice(0, EXCEL_CELL_LIMIT - marker.length) + marker;
  };

  // --- Problemas ---------------------------------------------------------
  const problemRows: Cell[][] = [[...PROBLEM_COLUMNS]];
  for (const p of input.problems) {
    problemRows.push([
      p.id, p.title, p.category, p.count, p.share, p.weeksActive,
      p.isChronic ? 'chronic' : null,
      p.rcaCoverage, p.documentedCount,
      formatDuration(p.medianResolutionHours), p.medianResolutionHours,
      p.slaBreachPct, p.avgScore, formatRootCauses(p),
      formatCounts(p.topGroups), formatCounts(p.topAgents),
      p.firstSeen, p.lastSeen,
    ].map(fit));
  }

  // --- Detalle -----------------------------------------------------------
  const extraColumns = input.sourceColumns.filter(c => !c.mapped);
  const generated = new Set<string>(DETAIL_COLUMNS);
  const extraHeaders = extraColumns.map(c => (generated.has(c.name) ? `${c.name} (origen)` : c.name));

  const scoreByNumber = new Map(input.scores.map(s => [s.number, s]));
  const membersByProblem = new Map<string, AnnotatedIncident[]>(input.problems.map(p => [p.id, []]));
  for (const inc of input.incidents) membersByProblem.get(inc.clusterId)?.push(inc);

  const detailRows: Cell[][] = [[...DETAIL_COLUMNS, ...extraHeaders]];
  for (const p of input.problems) {
    for (const inc of membersByProblem.get(p.id) ?? []) {
      const score = scoreByNumber.get(inc.Number);
      const canonical = CANONICAL_COLUMNS.map(key => {
        if (input.rawTextTrimmed && (key === 'Description' || key === 'Work notes')) return RAW_TEXT_UNAVAILABLE;
        return inc[key];
      });
      detailRows.push([
        p.id, p.title,
        ...canonical,
        inc.category, inc.week, inc.resolutionHours, inc.isClosed,
        score?.totalScore ?? null, score?.label ?? null,
        score?.dimScores.description_quality ?? null, score?.dimScores.root_cause ?? null,
        score?.dimScores.steps_documented ?? null, score?.dimScores.spelling_grammar ?? null,
        score?.dimScores.professionalism ?? null,
        inc.rootCauseText,
        ...extraColumns.map(c => inc.extraFields?.[c.name]),
      ].map(fit));
    }
  }
  const incidentCount = detailRows.length - 1;

  // --- Metadatos ---------------------------------------------------------
  const { listFilters, selectedMonths } = input;
  const exported = input.scope === 'problem' ? input.problems[0] : undefined;
  const metadata: [string, unknown][] = [
    ['Nombre del archivo fuente', input.fileName],
    ['Fecha/hora de exportación (UTC)', input.exportedAt.toISOString()],
    ['Zona horaria del navegador', Intl.DateTimeFormat().resolvedOptions().timeZone],
    ['Alcance', input.scope === 'problem' ? 'Problema individual (modal)' : 'Vista de problemas'],
    ['Problema exportado', exported ? `${exported.id} — ${exported.title}` : '—'],
    ['Filtro de mes', selectedMonths.length ? selectedMonths.map(monthLabel).join(', ') : 'Sin filtro (todos los meses)'],
    ['Meses seleccionados (YYYY-MM)', selectedMonths.length ? [...selectedMonths].sort().join(', ') : '—'],
    ['Rango aplicado (Opened del universo filtrado)', openedRange(input.incidents)],
    ['Filtro: búsqueda', listFilters.search.trim() || '—'],
    ['Filtro: categoría', listFilters.category === 'all' ? 'Todas' : listFilters.category],
    ['Filtro: solo sin documentar', listFilters.onlyUndocumented ? 'Sí' : 'No'],
    ['Incidentes en el universo filtrado', input.incidents.length],
    ['Problemas exportados', input.problems.length],
    ['Incidentes exportados', incidentCount],
    ['Versión del scorer', SCORER_VERSION],
    ['Celdas truncadas por el límite de Excel', truncatedCells],
    ['Description / Work notes originales', input.rawTextTrimmed ? `No disponibles: ${RAW_TEXT_UNAVAILABLE}` : 'Completos'],
    ['Columnas originales no mapeadas', extraColumns.length ? `${extraColumns.length}: ${extraColumns.map(c => c.name).join(', ')}` : '0'],
    ['Patrón', PATTERN_DEFINITION],
    ['Procesamiento', 'Generado en el navegador; ningún dato se envió a un servidor.'],
  ];
  const metadataRows: Cell[][] = [['Campo', 'Valor'], ...metadata.map(([k, v]) => [k, fit(v)])];

  const detailSheet = XLSX.utils.aoa_to_sheet(detailRows);
  // Unmapped numeric columns keep their source number format (dates stay dates).
  extraColumns.forEach((column, i) => {
    if (!column.numFmt) return;
    const c = DETAIL_COLUMNS.length + i;
    for (let r = 1; r < detailRows.length; r++) {
      const cell = detailSheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (cell?.t === 'n') cell.z = column.numFmt;
    }
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(problemRows), SHEET_PROBLEMS);
  XLSX.utils.book_append_sheet(workbook, detailSheet, SHEET_DETAIL);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(metadataRows), SHEET_METADATA);

  return { workbook, problemCount: input.problems.length, incidentCount, truncatedCells };
}

/** File name such as `problemas_export_20260301-0915.xlsx`. */
export function exportFileName(input: Pick<ProblemExportInput, 'scope' | 'problems' | 'fileName' | 'exportedAt'>): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = input.exportedAt;
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const source = input.fileName.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'incidentes';
  const prefix = input.scope === 'problem' && input.problems[0] ? `problema_${input.problems[0].id}` : 'problemas';
  return `${prefix}_${source}_${stamp}.xlsx`;
}

/** Build the workbook and hand it to the browser as a download. */
export function downloadProblemsWorkbook(input: ProblemExportInput): ProblemExport {
  const result = buildProblemsWorkbook(input);
  XLSX.writeFile(result.workbook, exportFileName(input), { compression: true });
  return result;
}
