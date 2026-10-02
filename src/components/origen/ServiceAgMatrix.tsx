import { useMemo, useState, type ReactNode } from 'react';
import { ORIGEN_DISPLAY } from '@/config/display';
import { fraction, topWithOthers, type CrossTab } from '@/lib/serviceDimension';
import { OthersLabel, Pager, Pct, ValueLabel, numClass, tdClass, thClass } from './shared';

/**
 * Service × Assignment group counts: observed handling, not ownership.
 *
 * The matrix draws the top Services and groups by volume (display config); the
 * rest are summed into labelled "Others" cells, and every pair is in the full
 * table. "No Service" and "No assignment group" stay separate from "Others".
 */
export default function ServiceAgMatrix({ tab }: { tab: CrossTab }) {
  const [full, setFull] = useState(false);
  const [page, setPage] = useState(0);

  const knownRows = useMemo(() => tab.rows.filter(r => r.value !== null), [tab]);
  const missingRow = tab.rows.find(r => r.value === null) ?? null;
  const knownCols = useMemo(() => tab.columns.filter(c => c.value !== null), [tab]);
  const missingCol = tab.columns.find(c => c.value === null) ?? null;

  const rows = topWithOthers(knownRows, ORIGEN_DISPLAY.matrixServices);
  const cols = topWithOthers(knownCols, ORIGEN_DISPLAY.matrixAssignmentGroups);
  const shownCols = new Set(cols.shown.map(c => c.value));

  // Display-only sums for the "Others" row and column.
  const othersRowCells = useMemo(() => {
    const cells = new Map<string | null, number>();
    for (const r of knownRows.slice(ORIGEN_DISPLAY.matrixServices)) {
      for (const [col, n] of r.cells) cells.set(col, (cells.get(col) ?? 0) + n);
    }
    return cells;
  }, [knownRows]);
  const othersColValue = (cells: Map<string | null, number>) => {
    let sum = 0;
    for (const [col, n] of cells) if (col !== null && !shownCols.has(col)) sum += n;
    return sum;
  };

  const pairs = useMemo(() => tab.rows.flatMap(r => [...r.cells.entries()].map(([ag, n]) => ({ service: r.value, ag, n, rowTotal: r.incidents })))
    .sort((a, b) => b.n - a.n), [tab]);

  const columnHeaders = [
    ...cols.shown.map(c => <th key={c.value} className={thClass} title={c.value!}><span className="block max-w-[120px] truncate">{c.value}</span></th>),
    ...(cols.others ? [<th key="__others__" className={thClass}><OthersLabel entries={cols.others.entries} noun="groups" /></th>] : []),
    ...(missingCol ? [<th key="__missing__" className={thClass}><ValueLabel value={null} missing="No assignment group" /></th>] : []),
  ];

  const cell = (cells: Map<string | null, number>, total: number, col: string | null) => {
    const n = cells.get(col) ?? 0;
    return <td key={col ?? '__missing__'} className={numClass} title={n ? `${n} · ${((n / total) * 100).toFixed(1)}% of the row` : undefined}>{n || '·'}</td>;
  };

  const rowView = (label: ReactNode, cells: Map<string | null, number>, total: number, key: string) => (
    <tr key={key} className="border-t border-card-foreground/10">
      <td className={`${tdClass} sticky left-0 bg-card max-w-[220px] truncate`}>{label}</td>
      <td className={numClass}>{total}</td>
      {cols.shown.map(c => cell(cells, total, c.value))}
      {cols.others && <td className={numClass}>{othersColValue(cells) || '·'}</td>}
      {missingCol && cell(cells, total, null)}
    </tr>
  );

  if (full) {
    const pages = Math.max(1, Math.ceil(pairs.length / ORIGEN_DISPLAY.tablePageSize));
    const current = Math.min(page, pages - 1);
    return (
      <div className="v1-card overflow-hidden">
        <div className="flex justify-between items-center p-3 border-b border-card-foreground/10 text-[12px]">
          <span className="text-muted-foreground">All {pairs.length} Service × Assignment group pairs</span>
          <button type="button" onClick={() => setFull(false)} className="underline text-muted-foreground hover:text-foreground">Back to matrix</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="bg-card-foreground/5">{['Service', 'Assignment group', 'Incidents', '% of Service'].map(h => <th key={h} className={thClass}>{h}</th>)}</tr></thead>
            <tbody>
              {pairs.slice(current * ORIGEN_DISPLAY.tablePageSize, (current + 1) * ORIGEN_DISPLAY.tablePageSize).map(p => (
                <tr key={`${p.service}|${p.ag}`} className="border-t border-card-foreground/10">
                  <td className={tdClass}><ValueLabel value={p.service} missing="No Service" /></td>
                  <td className={tdClass}><ValueLabel value={p.ag} missing="No assignment group" /></td>
                  <td className={numClass}>{p.n}</td>
                  <td className={numClass}><Pct value={fraction(p.n, p.rowTotal)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={current} pages={pages} onPage={setPage} />
      </div>
    );
  }

  return (
    <div className="v1-card overflow-hidden">
      <div className="flex justify-between items-center p-3 border-b border-card-foreground/10 text-[12px]">
        <span className="text-muted-foreground">Handled by Group (observed). Cell = incidents; hover for % of the Service.</span>
        <button type="button" onClick={() => setFull(true)} className="underline text-muted-foreground hover:text-foreground">View full table</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-card-foreground/5">
              <th className={`${thClass} sticky left-0 bg-card`}>Service</th>
              <th className={thClass}>Total</th>
              {columnHeaders}
            </tr>
          </thead>
          <tbody>
            {rows.shown.map(r => rowView(r.value, r.cells, r.incidents, r.value!))}
            {rows.others && rowView(<OthersLabel entries={rows.others.entries} noun="Services" />, othersRowCells, rows.others.incidents, '__others__')}
            {missingRow && rowView(<ValueLabel value={null} missing="No Service" />, missingRow.cells, missingRow.incidents, '__missing__')}
          </tbody>
        </table>
      </div>
    </div>
  );
}
