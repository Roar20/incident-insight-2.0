import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { ORIGEN_DISPLAY } from '@/config/display';
import { crossTab, dimensionValue, fraction, type DimensionRow, type DimensionTable, type OrigenDimension } from '@/lib/serviceDimension';
import type { AnnotatedIncident } from '@/lib/problems';
import { Pager, Pct, ValueLabel, numClass, tdClass, thClass } from './shared';

interface Props {
  table: DimensionTable;
  incidents: AnnotatedIncident[];
  dimension: 'service' | 'serviceOffering';
  /** The dimension rows expand into (observed relationship, not a hierarchy). */
  expandTo: OrigenDimension | null;
  labels: { singular: string; missing: string; expandMissing: string };
}

type SortKey = 'incidents' | 'name';

/**
 * Full, searchable, sortable table of one dimension's values. Every value is
 * reachable here — no Top N. The no-value row is pinned last and never sorted
 * with the values.
 */
export default function DimensionTableView({ table, incidents, dimension, expandTo, labels }: Props) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('incidents');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? table.rows.filter(r => r.value!.toLowerCase().includes(q)) : [...table.rows];
    if (sort === 'name') list.sort((a, b) => a.value!.localeCompare(b.value!, 'en'));
    return list;
  }, [table.rows, search, sort]);

  // The relationship counts for the expanded row, from the same visible incidents.
  const expansion = useMemo(() => {
    if (!expandTo || expanded === null) return null;
    const value = expanded === '__missing__' ? null : expanded;
    const members = incidents.filter(i => dimensionValue(i, dimension) === value);
    return crossTab(members, dimension, expandTo).columns;
  }, [incidents, expanded, expandTo, dimension]);

  const pageSize = ORIGEN_DISPLAY.tablePageSize;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * pageSize, (current + 1) * pageSize);

  const renderRow = (row: DimensionRow, key: string) => {
    const isOpen = expanded === key;
    return (
      <Fragment key={key}>
        <tr className="border-t border-card-foreground/10 hover:bg-card-foreground/5">
          <td className={tdClass}>
            {expandTo ? (
              <button type="button" onClick={() => setExpanded(isOpen ? null : key)} className="inline-flex items-center gap-1 text-left">
                {isOpen ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                <ValueLabel value={row.value} missing={labels.missing} />
              </button>
            ) : <ValueLabel value={row.value} missing={labels.missing} />}
          </td>
          <td className={numClass}>{row.incidents}</td>
          <td className={numClass}><Pct value={row.shareOfVisible} /></td>
          <td className={numClass}>{row.distinctAssignmentGroups}</td>
          <td className={numClass}>{dimension === 'service' ? row.distinctServiceOfferings : row.distinctServices}</td>
          <td className={numClass}>{row.candidates}</td>
        </tr>
        {isOpen && expansion && (
          <tr className="bg-card-foreground/[0.03]">
            <td colSpan={6} className="px-8 py-2">
              <div className="text-[11px] text-card-foreground/50 mb-1">Observed relationship — not a hierarchy.</div>
              <table className="w-full max-w-xl">
                <tbody>
                  {expansion.map(c => (
                    <tr key={c.value ?? '__missing__'}>
                      <td className={tdClass}><ValueLabel value={c.value} missing={labels.expandMissing} /></td>
                      <td className={numClass}>{c.incidents}</td>
                      <td className={numClass}><Pct value={fraction(c.incidents, row.incidents)} /> of {row.value === null ? labels.missing : 'this row'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <div className="v1-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-card-foreground/10">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder={`Search ${labels.singular.toLowerCase()}…`}
            className="bg-secondary border border-border rounded-md pl-7 pr-2 py-1.5 text-[12px] w-56"
          />
        </div>
        <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="bg-secondary border border-border rounded-md px-2 py-1.5 text-[12px]">
          <option value="incidents">Most incidents</option>
          <option value="name">Name</option>
        </select>
        <span className="ml-auto text-[11px] text-muted-foreground">{table.rows.length} {labels.singular}s with a value</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-card-foreground/5">
              {[labels.singular, 'Incidents', '% of visible', 'Assignment groups', dimension === 'service' ? 'Offerings' : 'Services', 'Problems'].map(h => (
                <th key={h} className={thClass}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(r => renderRow(r, r.value!))}
            {table.missing && renderRow(table.missing, '__missing__')}
          </tbody>
        </table>
      </div>
      <Pager page={current} pages={pages} onPage={setPage} />
    </div>
  );
}

