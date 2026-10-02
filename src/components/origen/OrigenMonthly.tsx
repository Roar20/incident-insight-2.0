import { useState } from 'react';
import { ORIGEN_DISPLAY } from '@/config/display';
import { monthLabel } from '@/lib/analytics';
import { fraction, topWithOthers, type MonthlySeries } from '@/lib/serviceDimension';
import { OthersLabel, Pct, ValueLabel, numClass, tdClass, thClass } from './shared';

/**
 * Incidents per month for the top values (display config), a labelled
 * "Others" series and the no-value series. The month axis follows the global
 * month filter; a month with no visible incidents shows 0.
 */
export default function OrigenMonthly({ series, missingLabel, noun }: { series: MonthlySeries; missingLabel: string; noun: string }) {
  const [asShare, setAsShare] = useState(false);
  const known = series.series.filter(s => s.value !== null);
  const missing = series.series.find(s => s.value === null) ?? null;
  const top = topWithOthers(known, ORIGEN_DISPLAY.monthlySeries);
  const othersCounts = series.months.map((_, i) => known.slice(ORIGEN_DISPLAY.monthlySeries).reduce((a, s) => a + s.counts[i], 0));

  const cells = (counts: number[]) => counts.map((n, i) => (
    <td key={series.months[i]} className={numClass}>
      {asShare ? <Pct value={fraction(n, series.monthTotals[i])} /> : n}
    </td>
  ));

  return (
    <div className="v1-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 p-3 border-b border-card-foreground/10 text-[12px] text-muted-foreground">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input type="checkbox" checked={asShare} onChange={e => setAsShare(e.target.checked)} className="accent-primary" />
          Show as % of the month
        </label>
        {series.undated > 0 && <span>{series.undated} visible incidents have no Opened date and are not shown.</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-card-foreground/5">
              <th className={`${thClass} sticky left-0 bg-card`}>{noun}</th>
              {series.months.map(m => <th key={m} className={thClass}>{monthLabel(m)}</th>)}
            </tr>
          </thead>
          <tbody>
            {top.shown.map(s => (
              <tr key={s.value} className="border-t border-card-foreground/10">
                <td className={`${tdClass} sticky left-0 bg-card max-w-[220px] truncate`}>{s.value}</td>
                {cells(s.counts)}
              </tr>
            ))}
            {top.others && (
              <tr className="border-t border-card-foreground/10">
                <td className={`${tdClass} sticky left-0 bg-card`}><OthersLabel entries={top.others.entries} noun={`${noun}s`} /></td>
                {cells(othersCounts)}
              </tr>
            )}
            {missing && (
              <tr className="border-t border-card-foreground/10">
                <td className={`${tdClass} sticky left-0 bg-card`}><ValueLabel value={null} missing={missingLabel} /></td>
                {cells(missing.counts)}
              </tr>
            )}
            <tr className="border-t border-card-foreground/20 bg-card-foreground/5">
              <td className={`${tdClass} sticky left-0 bg-card font-medium`}>All visible</td>
              {series.monthTotals.map((n, i) => <td key={series.months[i]} className={numClass}>{asShare ? (n ? '100%' : '—') : n}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
