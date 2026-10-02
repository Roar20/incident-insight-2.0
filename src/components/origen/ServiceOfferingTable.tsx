import { useState } from 'react';
import { ORIGEN_DISPLAY } from '@/config/display';
import type { PairRow } from '@/lib/serviceDimension';
import { Pager, Pct, ValueLabel, numClass, tdClass, thClass } from './shared';

/** Observed Service × Service offering pairs; pairs missing a side are listed separately. */
export default function ServiceOfferingTable({ pairs, partial }: { pairs: PairRow[]; partial: PairRow[] }) {
  const [page, setPage] = useState(0);
  const size = ORIGEN_DISPLAY.tablePageSize;
  const pages = Math.max(1, Math.ceil(pairs.length / size));
  const current = Math.min(page, pages - 1);

  const header = (
    <thead>
      <tr className="bg-card-foreground/5">
        {['Service', 'Offering', 'Incidents', '% of visible', 'Assignment groups', 'Problems'].map(h => <th key={h} className={thClass}>{h}</th>)}
      </tr>
    </thead>
  );
  const row = (p: PairRow) => (
    <tr key={`${p.left}|${p.right}`} className="border-t border-card-foreground/10">
      <td className={tdClass}><ValueLabel value={p.left} missing="No Service" /></td>
      <td className={tdClass}><ValueLabel value={p.right} missing="No Offering" /></td>
      <td className={numClass}>{p.incidents}</td>
      <td className={numClass}><Pct value={p.shareOfVisible} /></td>
      <td className={numClass}>{p.distinctAssignmentGroups}</td>
      <td className={numClass}>{p.candidates}</td>
    </tr>
  );

  return (
    <div className="space-y-3">
      <div className="v1-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            {header}
            <tbody>{pairs.slice(current * size, (current + 1) * size).map(row)}</tbody>
          </table>
        </div>
        <Pager page={current} pages={pages} onPage={setPage} />
      </div>
      {partial.length > 0 && (
        <div className="v1-card overflow-hidden">
          <div className="p-3 border-b border-card-foreground/10 text-[12px] text-muted-foreground">Incidents missing a Service or an Offering</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              {header}
              <tbody>{partial.map(row)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
