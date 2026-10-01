import * as XLSX from 'xlsx';
import { describe, it, expect } from 'vitest';
import { enrichRow, inferDateOrder, readIncidentTable, type SourceColumn } from './parser';
import { scoreIncident } from './scorer';
import { annotateIncidents, computeProblemClusters, type AnnotatedIncident, type ProblemCluster } from './problems';
import { filterByMonths, filterVisibleProblems, type ProblemListFilters } from './problemView';
import {
  buildProblemsWorkbook, exportFileName, CANONICAL_COLUMNS, DATE_FORMAT, DETAIL_COLUMNS, EXCEL_CELL_LIMIT,
  PROBLEM_COLUMNS, RAW_TEXT_UNAVAILABLE, SHEET_DETAIL, SHEET_METADATA, SHEET_PROBLEMS,
  type ProblemExportInput,
} from './exportProblems';
import { SCORER_VERSION } from './scorerVersion';

const HEADERS = [
  'Number', 'Priority', 'State', 'Short description', 'Description', 'Work notes',
  'Assignment group', 'Assigned to', 'Opened', 'Closed', 'Channel', 'Made SLA',
  'Service', 'Service offering', 'Resolution code', 'Resolved', 'Reassignment count', 'Code',
];
const EXTRA_HEADERS = ['Service', 'Service offering', 'Resolution code', 'Resolved', 'Reassignment count', 'Code'];

/** Excel serial for a UTC date-time. */
function serial(iso: string): number {
  return (Date.parse(`${iso}Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

interface Spec {
  short: string;
  opened: string;
  group: string;
  agent: string;
  cause?: string;
  service: string;
}

const SPECS: Spec[] = [
  // VPN: 6 incidents over 4 ISO weeks in Jan and Feb -> chronic
  { short: 'VPN connection drops for remote users', opened: '2026-01-05 09:00:00', group: 'Network', agent: 'Ana', cause: 'Root cause: expired certificate on the VPN gateway.', service: 'Remote Access' },
  { short: 'VPN connection drops for remote users', opened: '2026-01-13 09:00:00', group: 'Network', agent: 'Ana', cause: 'Root cause: expired certificate on the VPN gateway.', service: 'Remote Access' },
  { short: 'VPN connection drops for remote users', opened: '2026-01-21 09:00:00', group: 'Network', agent: 'Luis', service: 'Remote Access' },
  { short: 'VPN connection drops for remote users', opened: '2026-02-03 09:00:00', group: 'Network', agent: 'Luis', cause: 'Caused by a saturated tunnel pool.', service: 'Remote Access' },
  { short: 'VPN connection drops for remote users', opened: '2026-02-04 09:00:00', group: 'Service Desk', agent: 'Ana', service: 'Remote Access' },
  { short: 'VPN connection drops for remote users', opened: '2026-02-05 09:00:00', group: 'Network', agent: 'Ana', service: 'Remote Access' },
  // Printer: 3 incidents, Feb only, undocumented
  { short: 'Printer on floor 3 offline and not printing', opened: '2026-02-10 10:00:00', group: 'Field Support', agent: 'Marta', service: 'Printing' },
  { short: 'Printer on floor 3 offline and not printing', opened: '2026-02-11 10:00:00', group: 'Field Support', agent: 'Marta', service: 'Printing' },
  { short: 'Printer on floor 3 offline and not printing', opened: '2026-02-12 10:00:00', group: 'Field Support', agent: 'Pedro', service: 'Printing' },
  // Mailbox: 2 incidents, Jan only
  { short: 'Outlook mailbox not syncing for finance', opened: '2026-01-08 11:00:00', group: 'Messaging', agent: 'Sara', cause: 'Root cause: mailbox quota exceeded.', service: 'Email' },
  { short: 'Outlook mailbox not syncing for finance', opened: '2026-01-09 11:00:00', group: 'Messaging', agent: 'Sara', cause: 'Root cause: mailbox quota exceeded.', service: 'Email' },
  // Singletons: never part of a problem
  { short: 'Request new keyboard for reception desk', opened: '2026-01-15 08:00:00', group: 'Service Desk', agent: 'Luis', service: 'Hardware' },
  { short: 'Badge reader at main entrance rejects cards', opened: '2026-02-20 08:00:00', group: 'Facilities', agent: 'Pedro', service: 'Security' },
];

function fixtureRows(): unknown[][] {
  return SPECS.map((s, i) => {
    const opened = s.opened;
    const closed = opened.replace(/ (\d\d):/, (_, h) => ` ${String(Number(h) + 1).padStart(2, '0')}:`);
    const notes = `2026-01-01 10:00:00 - ${s.agent} (Work notes)\nRestarted the service and verified with the user.${s.cause ? ` ${s.cause}` : ''}`;
    return [
      `INC${1000 + i}`, '3 - Moderate', 'Closed', s.short, `${s.short}. Users are affected.`, notes,
      s.group, s.agent, opened, closed, i % 2 ? 'Email' : 'Phone', i % 4 === 0 ? 'false' : 'true',
      s.service, `${s.service} - Gold`, 'Solved (Permanently)', serial(closed.replace(' ', 'T')), i, '007',
    ];
  });
}

/** An xlsx file with a date-formatted unmapped column, read back through the real ingestion path. */
function loadFixture() {
  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...fixtureRows()]);
  const resolvedCol = HEADERS.indexOf('Resolved');
  for (let r = 1; r <= SPECS.length; r++) {
    sheet[XLSX.utils.encode_cell({ r, c: resolvedCol })].z = 'yyyy-mm-dd hh:mm';
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Page 1');
  // Copied into an ArrayBuffer of this realm, as File.arrayBuffer() returns it (see parser.test.ts).
  const written = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  const buffer = new ArrayBuffer(written.byteLength);
  new Uint8Array(buffer).set(written);

  const { rows, columns } = readIncidentTable(buffer);
  const dateOrder = inferDateOrder(rows);
  const enriched = rows.map(r => enrichRow(r, { dateOrder }));
  const scores = enriched.map(scoreIncident);
  const incidents = annotateIncidents(enriched);
  return { incidents, scores, columns };
}

const NO_LIST_FILTERS: ProblemListFilters = { search: '', category: 'all', onlyUndocumented: false };
const EXPORTED_AT = new Date(Date.UTC(2026, 2, 1, 9, 15, 0));

/** What the Problems view shows: month filter, then problem aggregation, then list filters. */
function view(months: string[] = [], listFilters: ProblemListFilters = NO_LIST_FILTERS) {
  const { incidents, scores, columns } = loadFixture();
  const universe = months.length ? filterByMonths(incidents, months) : incidents;
  const numbers = new Set(universe.map(i => i.Number));
  const universeScores = months.length ? scores.filter(s => numbers.has(s.number)) : scores;
  const problems = computeProblemClusters(universe, universeScores);
  const visible = filterVisibleProblems(problems, listFilters);
  return { universe, universeScores, columns, problems, visible, listFilters, months };
}

function exportInput(
  v: ReturnType<typeof view>,
  overrides: Partial<ProblemExportInput> = {},
): ProblemExportInput {
  return {
    scope: 'view',
    problems: v.visible,
    incidents: v.universe,
    scores: v.universeScores,
    sourceColumns: v.columns,
    fileName: 'SAP_Middleware_test.xlsx',
    exportedAt: EXPORTED_AT,
    selectedMonths: v.months,
    listFilters: v.listFilters,
    rawTextTrimmed: false,
    ...overrides,
  };
}

/** Write the workbook to bytes and read it back, as a user opening the file would. */
function roundTrip(workbook: XLSX.WorkBook) {
  const wb = XLSX.read(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellNF: true });
  const table = (name: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null });
  // The same cells as Excel displays them (formatted text).
  const shown = (name: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null, raw: false });
  const metadata = Object.fromEntries(table(SHEET_METADATA).slice(1).map(([k, v]) => [k, v]));
  return {
    wb, problems: table(SHEET_PROBLEMS), detail: table(SHEET_DETAIL), metadata,
    problemsShown: shown(SHEET_PROBLEMS), detailShown: shown(SHEET_DETAIL),
  };
}

/** The cell of a sheet at a header-relative row (1 = first data row) and named column. */
function cellAt(wb: XLSX.WorkBook, sheet: string, header: readonly unknown[], row: number, name: string): XLSX.CellObject {
  return wb.Sheets[sheet][XLSX.utils.encode_cell({ r: row, c: header.indexOf(name) })];
}

const col = (header: readonly unknown[], name: string) => header.indexOf(name);

describe('buildProblemsWorkbook', () => {
  it('writes exactly the Problemas, Detalle and Metadatos sheets', () => {
    const { wb } = roundTrip(buildProblemsWorkbook(exportInput(view())).workbook);
    expect(wb.SheetNames).toEqual(['Problemas', 'Detalle', 'Metadatos']);
  });

  it('lists the expected Problemas columns and Detalle columns, canonical then unmapped in source order', () => {
    const { problems, detail } = roundTrip(buildProblemsWorkbook(exportInput(view())).workbook);
    expect(problems[0]).toEqual([...PROBLEM_COLUMNS]);
    expect(detail[0]).toEqual([...DETAIL_COLUMNS, ...EXTRA_HEADERS]);
    // Channel is canonical, so it appears once, as a canonical column.
    expect(detail[0].filter(h => h === 'Channel')).toHaveLength(1);
    expect(CANONICAL_COLUMNS).toContain('Channel');
  });

  it('writes one Problemas row per visible problem with the values the view shows', () => {
    const v = view();
    const { problems, problemsShown } = roundTrip(buildProblemsWorkbook(exportInput(v)).workbook);
    const [header, ...rows] = problems;
    expect(rows).toHaveLength(v.visible.length);
    expect(v.visible.length).toBe(3);

    rows.forEach((row, i) => {
      const p = v.visible[i];
      expect(row[col(header, 'ID de problema')]).toBe(p.id);
      expect(row[col(header, 'Título')]).toBe(p.title);
      expect(row[col(header, 'Número de incidentes')]).toBe(p.count);
      expect(row[col(header, '% share')]).toBe(p.share);
      expect(row[col(header, 'Semanas activas')]).toBe(p.weeksActive);
      expect(row[col(header, 'Patrón')]).toBe(p.isChronic ? 'chronic' : null);
      expect(row[col(header, '% con causa raíz')]).toBe(p.rcaCoverage);
      expect(row[col(header, 'Score medio')]).toBe(p.avgScore);
      expect(problemsShown[i + 1][col(header, 'Primer visto')]).toBe(p.firstSeen);
      expect(problemsShown[i + 1][col(header, 'Último visto')]).toBe(p.lastSeen);
    });

    const vpn = rows.find(r => String(r[1]).startsWith('VPN'))!;
    expect(vpn[col(header, 'Patrón')]).toBe('chronic');
    expect(vpn[col(header, 'Top 3 causas documentadas')]).toContain('expired certificate');
    expect(vpn[col(header, 'Assignment Groups principales')]).toBe('Network (5); Service Desk (1)');
  });

  it('writes one Detalle row per incident of the exported problems, and the counts reconcile', () => {
    const v = view();
    const result = buildProblemsWorkbook(exportInput(v));
    const { detail, metadata } = roundTrip(result.workbook);
    const [header, ...rows] = detail;

    const expected = v.visible.reduce((sum, p) => sum + p.count, 0);
    expect(rows).toHaveLength(expected);
    expect(result.incidentCount).toBe(expected);
    expect(metadata['Incidentes exportados']).toBe(expected);
    expect(metadata['Problemas exportados']).toBe(v.visible.length);

    // Every row belongs to the problem it names; singletons are never exported.
    const byNumber = new Map(v.universe.map(i => [i.Number, i]));
    for (const row of rows) {
      const inc = byNumber.get(String(row[col(header, 'Number')]))!;
      expect(row[col(header, 'ID de problema')]).toBe(inc.clusterId);
    }
    const numbers = rows.map(r => r[col(header, 'Number')]);
    expect(numbers).not.toContain('INC1011');
    expect(numbers).not.toContain('INC1012');
  });

  it('carries the canonical fields, score and documented root cause of each incident', () => {
    const v = view();
    const { detail, detailShown } = roundTrip(buildProblemsWorkbook(exportInput(v)).workbook);
    const [header, ...rows] = detail;
    const index = rows.findIndex(r => r[col(header, 'Number')] === 'INC1000');
    const row = rows[index];
    const inc = v.universe.find(i => i.Number === 'INC1000')!;
    const score = v.universeScores.find(s => s.number === 'INC1000')!;

    for (const key of CANONICAL_COLUMNS) {
      const expected = inc[key] === '' ? null : inc[key];
      // Dates are Excel dates now; compare them as displayed.
      const actual = key === 'Opened' || key === 'Closed' ? detailShown[index + 1][col(header, key)] : row[col(header, key)];
      expect(actual, key).toEqual(expected);
    }
    expect(row[col(header, 'Made SLA')]).toBe(false);
    expect(row[col(header, 'Score')]).toBe(score.totalScore);
    expect(row[col(header, 'Score label')]).toBe(score.label);
    expect(row[col(header, 'Causa raíz documentada')]).toBe(inc.rootCauseText);
    expect(inc.rootCauseText).toContain('expired certificate');
  });

  it('preserves unmapped source columns verbatim, with their type and number format', () => {
    const v = view();
    const { wb, detail } = roundTrip(buildProblemsWorkbook(exportInput(v)).workbook);
    const [header, ...rows] = detail;
    const rowIndex = rows.findIndex(r => r[col(header, 'Number')] === 'INC1003');
    const row = rows[rowIndex];
    const source = fixtureRows()[3];

    expect(row[col(header, 'Service')]).toBe('Remote Access');
    expect(row[col(header, 'Service offering')]).toBe('Remote Access - Gold');
    expect(row[col(header, 'Resolution code')]).toBe('Solved (Permanently)');
    expect(row[col(header, 'Reassignment count')]).toBe(3);
    expect(row[col(header, 'Code')]).toBe('007'); // stays text, leading zeros intact
    expect(row[col(header, 'Resolved')]).toBeCloseTo(source[HEADERS.indexOf('Resolved')] as number, 9);

    // The date column keeps its Excel date format, so it still reads as a date.
    const cell = wb.Sheets[SHEET_DETAIL][XLSX.utils.encode_cell({ r: rowIndex + 1, c: col(header, 'Resolved') })];
    expect(cell.t).toBe('n');
    expect(cell.z).toBe(DATE_FORMAT);
    expect(cell.w).toBe('2026-02-03 10:00:00');
  });

  it('exports only the months selected in the global month filter', () => {
    const v = view(['2026-02']);
    const result = buildProblemsWorkbook(exportInput(v));
    const { problems, detail, detailShown, metadata } = roundTrip(result.workbook);
    const [dHeader, ...rows] = detailShown;

    // Feb: VPN (3 of its 6) and the printer; the Jan-only mailbox problem is gone.
    expect(problems.slice(1).map(r => r[1])).toEqual(v.visible.map(p => p.title));
    expect(v.visible.map(p => p.count)).toEqual([3, 3]);
    expect(rows).toHaveLength(6);
    expect(detail).toHaveLength(7);
    for (const row of rows) expect(String(row[col(dHeader, 'Opened')])).toMatch(/^2026-02-/);

    const vpn = problems.find(r => String(r[1]).startsWith('VPN'))!;
    expect(vpn[col(problems[0], '% share')]).toBe(v.visible[0].share);
    expect(metadata['Filtro de mes']).toBe('Feb 2026');
    expect(metadata['Meses seleccionados (YYYY-MM)']).toBe('2026-02');
    expect(metadata['Incidentes en el universo filtrado']).toBe(v.universe.length);
    expect(metadata['Rango aplicado (Opened del universo filtrado)']).toBe('2026-02-03 09:00:00 → 2026-02-20 08:00:00');
  });

  it('applies the Problems view filters and records them in Metadatos', () => {
    const undocumented = view([], { search: '', category: 'all', onlyUndocumented: true });
    const searched = view([], { search: 'printer', category: 'all', onlyUndocumented: false });
    const vpnCategory = view().visible.find(p => p.title.startsWith('VPN'))!.category;
    const categorised = view([], { search: '', category: vpnCategory, onlyUndocumented: false });

    for (const v of [undocumented, searched, categorised]) {
      const { problems, detail } = roundTrip(buildProblemsWorkbook(exportInput(v)).workbook);
      expect(problems.slice(1).map(r => r[0])).toEqual(v.visible.map(p => p.id));
      expect(detail.length - 1).toBe(v.visible.reduce((s, p) => s + p.count, 0));
    }
    expect(undocumented.visible.every(p => p.rcaCoverage < 50)).toBe(true);
    expect(searched.visible.map(p => p.title)).toEqual(['Printer on floor 3 offline and not printing']);

    const { metadata } = roundTrip(buildProblemsWorkbook(exportInput(searched)).workbook);
    expect(metadata['Filtro: búsqueda']).toBe('printer');
    expect(metadata['Filtro: categoría']).toBe('Todas');
    expect(metadata['Filtro: solo sin documentar']).toBe('No');
    expect(metadata['Filtro de mes']).toBe('Sin filtro (todos los meses)');

    const { metadata: m2 } = roundTrip(buildProblemsWorkbook(exportInput(undocumented)).workbook);
    expect(m2['Filtro: solo sin documentar']).toBe('Sí');
  });

  it('exports a single problem from the modal with all of its incidents in the filtered universe', () => {
    const v = view(['2026-01']);
    const vpn = v.visible.find(p => p.title.startsWith('VPN'))!;
    const result = buildProblemsWorkbook(exportInput(v, { scope: 'problem', problems: [vpn] }));
    const { problems, detail, metadata } = roundTrip(result.workbook);

    expect(problems).toHaveLength(2);
    expect(problems[1][0]).toBe(vpn.id);
    expect(vpn.count).toBe(3); // Jan only
    expect(detail.length - 1).toBe(vpn.count);
    expect(new Set(detail.slice(1).map(r => r[0]))).toEqual(new Set([vpn.id]));
    expect(metadata['Alcance']).toBe('Problema individual (modal)');
    expect(metadata['Problema exportado']).toBe(`${vpn.id} — ${vpn.title}`);
    expect(metadata['Filtro de mes']).toBe('Jan 2026');
  });

  it('records source file, export time, scorer version and unmapped columns in Metadatos', () => {
    const { metadata } = roundTrip(buildProblemsWorkbook(exportInput(view())).workbook);
    expect(metadata['Nombre del archivo fuente']).toBe('SAP_Middleware_test.xlsx');
    expect(metadata['Fecha/hora de exportación (UTC)']).toBe('2026-03-01T09:15:00.000Z');
    expect(metadata['Alcance']).toBe('Vista de problemas');
    expect(metadata['Versión del scorer']).toBe(SCORER_VERSION);
    expect(metadata['Columnas originales no mapeadas']).toBe(`6: ${EXTRA_HEADERS.join(', ')}`);
    expect(metadata['Description / Work notes originales']).toBe('Completos');
    expect(metadata['Patrón']).toContain("'chronic'");
  });

  it("truncates only the written cell at Excel's limit, marks it and counts it", () => {
    const v = view();
    // An xlsx cannot hold this, but a CSV export of a long journal can.
    v.universe.find(i => i.Number === 'INC1010')!['Work notes'] = 'x'.repeat(40_000);
    const result = buildProblemsWorkbook(exportInput(v));
    const { detail, metadata } = roundTrip(result.workbook);
    const [header, ...rows] = detail;
    const cell = String(rows.find(r => r[col(header, 'Number')] === 'INC1010')![col(header, 'Work notes')]);

    expect(cell).toHaveLength(EXCEL_CELL_LIMIT);
    expect(cell).toMatch(/…\[TRUNCADO: el valor original tiene 40000 caracteres; Excel admite 32767\]$/);
    expect(result.truncatedCells).toBe(1);
    expect(metadata['Celdas truncadas por el límite de Excel']).toBe(1);
    // The app's own copy is untouched.
    expect(v.universe.find(i => i.Number === 'INC1010')!['Work notes']).toHaveLength(40_000);
  });

  it('marks Description and Work notes as unavailable, not blank, when the worker trimmed them', () => {
    const v = view();
    const { detail, metadata } = roundTrip(buildProblemsWorkbook(exportInput(v, { rawTextTrimmed: true })).workbook);
    const [header, ...rows] = detail;
    for (const row of rows) {
      expect(row[col(header, 'Description')]).toBe(RAW_TEXT_UNAVAILABLE);
      expect(row[col(header, 'Work notes')]).toBe(RAW_TEXT_UNAVAILABLE);
    }
    expect(metadata['Description / Work notes originales']).toMatch(/^No disponibles/);
  });

  it('renames an unmapped column that collides with a generated header', () => {
    const v = view();
    const columns: SourceColumn[] = [...v.columns, { name: 'Score', mapped: false }];
    const incidents = v.universe.map(i => ({ ...i, extraFields: { ...i.extraFields, Score: 'A+' } })) as AnnotatedIncident[];
    const { detail } = roundTrip(buildProblemsWorkbook(exportInput(v, { sourceColumns: columns, incidents })).workbook);
    expect(detail[0].slice(-1)).toEqual(['Score (origen)']);
    expect(detail[1].slice(-1)).toEqual(['A+']);
  });

  it('produces an empty but well-formed workbook when no problem is visible', () => {
    const v = view([], { search: 'no such problem', category: 'all', onlyUndocumented: false });
    const { problems, detail, metadata } = roundTrip(buildProblemsWorkbook(exportInput(v)).workbook);
    expect(problems).toEqual([[...PROBLEM_COLUMNS]]);
    expect(detail).toHaveLength(1);
    expect(metadata['Problemas exportados']).toBe(0);
  });
});

describe('exportFileName', () => {
  const p = { id: 'p-3' } as ProblemCluster;
  const at = new Date(2026, 2, 1, 9, 5);
  it('names view and single-problem exports after the source file', () => {
    expect(exportFileName({ scope: 'view', problems: [p], fileName: 'SAP Middleware 2026.xlsx', exportedAt: at }))
      .toBe('problemas_SAP_Middleware_2026_20260301-0905.xlsx');
    expect(exportFileName({ scope: 'problem', problems: [p], fileName: 'x.csv', exportedAt: at }))
      .toBe('problema_p-3_x_20260301-0905.xlsx');
  });
});


describe('date round trip: xlsx -> parser -> export -> xlsx (F-25)', () => {
  const EPOCH = Date.UTC(1899, 11, 30);
  const serialOf = (iso: string) => (Date.parse(`${iso.replace(' ', 'T')}Z`) - EPOCH) / 86_400_000;
  const OPENED = ['2026-09-26 23:14:56', '2026-09-01 00:00:07', '2026-01-31 23:59:59', '2026-03-01 00:00:00'];
  const CLOSED = ['2026-09-27 01:02:03', '2026-09-01 00:00:08', '2026-02-01 00:00:00', '2026-03-01 23:59:59'];

  function exportDates() {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Number', 'Short description', 'State', 'Opened', 'Closed', 'Resolved'],
      ...OPENED.map((o, i) => [`INC${i}`, 'SAP PI message stuck in queue', 'Closed', serialOf(o), serialOf(CLOSED[i]), serialOf(CLOSED[i])]),
    ]);
    for (let r = 1; r <= OPENED.length; r++) {
      for (const c of [3, 4, 5]) sheet[XLSX.utils.encode_cell({ r, c })].z = 'yyyy-mm-dd hh:mm:ss';
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Page 1');
    const written = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    const buffer = new ArrayBuffer(written.byteLength);
    new Uint8Array(buffer).set(written);

    const { rows, columns } = readIncidentTable(buffer);
    const enriched = rows.map(r => enrichRow(r, { dateOrder: inferDateOrder(rows) }));
    const scores = enriched.map(scoreIncident);
    const incidents = annotateIncidents(enriched);
    const problems = computeProblemClusters(incidents, scores);
    expect(problems).toHaveLength(1);
    const { workbook } = buildProblemsWorkbook({
      scope: 'view', problems, incidents, scores, sourceColumns: columns, fileName: 'dates.xlsx',
      exportedAt: EXPORTED_AT, selectedMonths: [], listFilters: NO_LIST_FILTERS, rawTextTrimmed: false,
    });
    return { incidents, ...roundTrip(workbook) };
  }

  it('keeps every Opened, Closed and unmapped date exactly as yyyy-mm-dd hh:mm:ss, typed as an Excel date', () => {
    const { incidents, wb, detail, detailShown } = exportDates();
    const header = detail[0];
    expect(incidents.map(i => i.Opened)).toEqual(OPENED);
    const rowOf = new Map(detail.slice(1).map((r, i) => [r[col(header, 'Number')], i + 1]));
    OPENED.forEach((o, i) => {
      const r = rowOf.get(`INC${i}`)!;
      expect(detailShown[r][col(header, 'Opened')]).toBe(o);
      expect(detailShown[r][col(header, 'Closed')]).toBe(CLOSED[i]);
      expect(detailShown[r][col(header, 'Resolved')]).toBe(CLOSED[i]);
      for (const name of ['Opened', 'Closed', 'Resolved']) {
        const cell = cellAt(wb, SHEET_DETAIL, header, r, name);
        expect(cell.t, name).toBe('n');
        expect(cell.z, name).toBe(DATE_FORMAT);
      }
      expect(cellAt(wb, SHEET_DETAIL, header, r, 'Opened').v).toBeCloseTo(serialOf(o), 9);
    });
  });
});

describe('Excel cell types in Detalle', () => {
  const HEAD = [
    'Number', 'Short description', 'State', 'Opened', 'Closed',
    'Resolve time', 'Reassignment count', 'Job ID', 'Correlation ID', 'Code', 'Updated', 'Mixed', 'Short date', 'Ratio',
  ];
  const ROWS = [
    ['INC1', 'SAP PI message stuck in queue', 'Closed', '2026-09-26 23:14:56', '2026-09-27 01:00:00', '9089', 2, '12345', '98765', '007', '2026-09-26 23:14:56', '12', '26/09/2026', 0.5],
    ['INC2', 'SAP PI message stuck in queue', 'Closed', '2026-09-27 08:00:00', '2026-09-27 09:30:00', '120', 0, '12346', '98766', '008', '2026-09-27 09:30:00', 'n/a', '27/09/2026', 0.25],
    ['INC3', 'SAP PI message stuck in queue', 'Closed', '4-Mar-2026', '', '', 1, '', '', '009', '', '', '', 1],
  ];

  function exportTyped() {
    const sheet = XLSX.utils.aoa_to_sheet([HEAD, ...ROWS]);
    for (let r = 1; r <= ROWS.length; r++) sheet[XLSX.utils.encode_cell({ r, c: HEAD.indexOf('Ratio') })].z = '0.00%';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Page 1');
    const written = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    const buffer = new ArrayBuffer(written.byteLength);
    new Uint8Array(buffer).set(written);

    const { rows, columns } = readIncidentTable(buffer);
    const enriched = rows.map(r => enrichRow(r, { dateOrder: inferDateOrder(rows) }));
    const scores = enriched.map(scoreIncident);
    const incidents = annotateIncidents(enriched);
    const problems = computeProblemClusters(incidents, scores);
    const { workbook } = buildProblemsWorkbook({
      scope: 'view', problems, incidents, scores, sourceColumns: columns, fileName: 'types.xlsx',
      exportedAt: EXPORTED_AT, selectedMonths: [], listFilters: NO_LIST_FILTERS, rawTextTrimmed: false,
    });
    return { columns, problems, incidents, ...roundTrip(workbook) };
  }

  it('classifies each unmapped column once, from every row', () => {
    const { columns } = exportTyped();
    const kinds = Object.fromEntries(columns.filter(c => !c.mapped).map(c => [c.name, c.kind]));
    expect(kinds).toEqual({
      'Resolve time': 'number', 'Reassignment count': 'number', 'Job ID': 'text', 'Correlation ID': 'text',
      Code: 'text', Updated: 'date', Mixed: 'text', 'Short date': 'text', Ratio: 'number',
    });
  });

  it('writes numeric text as Excel numbers, but keeps identifiers, codes and mixed columns as text', () => {
    const { wb, detail } = exportTyped();
    const header = detail[0];
    const r = detail.findIndex(row => row[col(header, 'Number')] === 'INC1');
    const cell = (name: string) => cellAt(wb, SHEET_DETAIL, header, r, name);

    expect([cell('Resolve time').t, cell('Resolve time').v]).toEqual(['n', 9089]);
    expect([cell('Reassignment count').t, cell('Reassignment count').v]).toEqual(['n', 2]);
    expect([cell('Job ID').t, cell('Job ID').v]).toEqual(['s', '12345']);
    expect([cell('Correlation ID').t, cell('Correlation ID').v]).toEqual(['s', '98765']);
    expect([cell('Code').t, cell('Code').v]).toEqual(['s', '007']);
    expect([cell('Mixed').t, cell('Mixed').v]).toEqual(['s', '12']);
    expect([cell('Short date').t, cell('Short date').v]).toEqual(['s', '26/09/2026']);
    expect([cell('Ratio').t, cell('Ratio').v, cell('Ratio').z, cell('Ratio').w]).toEqual(['n', 0.5, '0.00%', '50.00%']);
  });

  it('writes ISO date text, canonical or unmapped, as Excel dates shown yyyy-mm-dd hh:mm:ss', () => {
    const { wb, detail } = exportTyped();
    const header = detail[0];
    const r = detail.findIndex(row => row[col(header, 'Number')] === 'INC1');
    for (const name of ['Opened', 'Updated']) {
      const c = cellAt(wb, SHEET_DETAIL, header, r, name);
      expect([c.t, c.z, c.w], name).toEqual(['n', DATE_FORMAT, '2026-09-26 23:14:56']);
    }
    const closed = cellAt(wb, SHEET_DETAIL, header, r, 'Closed');
    expect([closed.t, closed.w]).toEqual(['n', '2026-09-27 01:00:00']);
  });

  it('keeps an Opened the parser could not read as text, and leaves blanks blank', () => {
    const { wb, detail } = exportTyped();
    const header = detail[0];
    const r = detail.findIndex(row => row[col(header, 'Number')] === 'INC3');
    expect([cellAt(wb, SHEET_DETAIL, header, r, 'Opened').t, cellAt(wb, SHEET_DETAIL, header, r, 'Opened').v]).toEqual(['s', '4-Mar-2026']);
    expect(cellAt(wb, SHEET_DETAIL, header, r, 'Closed')).toBeUndefined();
    expect(cellAt(wb, SHEET_DETAIL, header, r, 'Resolve time')).toBeUndefined();
  });

  it('writes Primer visto / Último visto as Excel dates, and an unreadable value as the text the app holds', () => {
    const { wb, problems, problemsShown } = exportTyped();
    const header = problems[0];
    const first = cellAt(wb, SHEET_PROBLEMS, header, 1, 'Primer visto');
    expect([first.t, first.z, problemsShown[1][col(header, 'Primer visto')]]).toEqual(['n', DATE_FORMAT, '2026-09-26 23:14:56']);
    // lastSeen sorts Opened as text, so the unparsed '4-Mar-2026' is what the app shows; it stays text.
    const last = cellAt(wb, SHEET_PROBLEMS, header, 1, 'Último visto');
    expect([last.t, last.v]).toEqual(['s', '4-Mar-2026']);
  });
});
