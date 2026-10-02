import { useMemo, useState } from 'react';
import { useAppContext } from '@/context/AppContext';
import {
  KPICard, SectionTitle, EmptyState, getScoreColor,
} from '@/components/ui/dashboard-primitives';
import GlobalFilters from '@/components/GlobalFilters';
import ProblemModal from '@/components/ProblemModal';
import ExportButton from '@/components/ExportButton';
import { useProblemExport } from '@/hooks/useProblemExport';
import type { ProblemCluster, ActionKind } from '@/lib/problems';
import { filterVisibleProblems, type ProblemListFilters } from '@/lib/problemView';
import { formatDuration } from '@/lib/periods';

/** Shown while a Service or Service offering filter blocks export (handled in S5). */
const DIMENSION_FILTER_EXPORT_NOTICE =
  'Export is not available while a Service or Service offering filter is active. Clear those filters to export; the month filter is supported.';
import { Search, AlertTriangle, Bot, HelpCircle, Repeat } from 'lucide-react';

const ACTION_META: Record<ActionKind, { icon: typeof AlertTriangle; tone: string; label: string }> = {
  'problem-management': { icon: AlertTriangle, tone: 'text-score-critical', label: 'Problem record' },
  chronic: { icon: Repeat, tone: 'text-score-poor', label: 'Chronic' },
  automation: { icon: Bot, tone: 'text-score-excellent', label: 'Automate' },
  'knowledge-gap': { icon: HelpCircle, tone: 'text-score-good', label: 'Knowledge gap' },
};

function CoverageBar({ pct }: { pct: number }) {
  const tone = pct >= 70 ? 'bg-score-excellent' : pct >= 40 ? 'bg-score-good' : pct >= 20 ? 'bg-score-poor' : 'bg-score-critical';
  return (
    <div className="flex items-center gap-2">
      <div className="w-[52px] h-[4px] bg-card-foreground/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[11px] text-card-foreground/60 w-9 text-right">{pct}%</span>
    </div>
  );
}

export default function ProblemsPage() {
  const { filteredProblems, filteredCategories, filteredActions, filteredIncidents, isDimensionFilterActive } = useAppContext();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [onlyUndocumented, setOnlyUndocumented] = useState(false);
  const [selected, setSelected] = useState<ProblemCluster | null>(null);
  const { exportProblems, exporting } = useProblemExport();

  const listFilters = useMemo<ProblemListFilters>(
    () => ({ search, category: categoryFilter, onlyUndocumented }),
    [search, categoryFilter, onlyUndocumented],
  );

  // The export reuses this exact list, so it always matches the table.
  const visible = useMemo(
    () => filterVisibleProblems(filteredProblems, listFilters),
    [filteredProblems, listFilters],
  );

  const totals = useMemo(() => {
    const recurring = filteredProblems.reduce((sum, p) => sum + p.count, 0);
    const documented = filteredProblems.reduce((sum, p) => sum + p.documentedCount, 0);
    const top10 = filteredProblems.slice(0, 10).reduce((sum, p) => sum + p.count, 0);
    return {
      distinct: filteredProblems.length,
      recurring,
      chronic: filteredProblems.filter(p => p.isChronic).length,
      rcaCoverage: recurring > 0 ? Math.round((documented / recurring) * 100) : 0,
      concentration: filteredIncidents.length > 0 ? Math.round((top10 / filteredIncidents.length) * 100) : 0,
    };
  }, [filteredProblems, filteredIncidents.length]);

  const selectClass = 'bg-secondary border border-border rounded-md px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

  if (filteredIncidents.length === 0) {
    return (
      <div className="animate-fade-in">
        <GlobalFilters />
        <EmptyState message="No incidents match the current filters." />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <GlobalFilters />

      <SectionTitle>Problem Overview</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-6">
        <KPICard label="Distinct Problems" value={totals.distinct} sub="seen 2+ times" />
        <KPICard label="Repeat Incidents" value={totals.recurring} sub={`${Math.round(totals.recurring / filteredIncidents.length * 100)}% of all incidents`} />
        <KPICard
          label="Chronic Problems"
          value={totals.chronic}
          colorClass={totals.chronic > 0 ? 'text-score-critical' : undefined}
          sub="recur across 3+ weeks"
        />
        <KPICard
          label="Root Cause Coverage"
          value={`${totals.rcaCoverage}%`}
          colorClass={totals.rcaCoverage >= 50 ? 'text-score-good' : 'text-score-critical'}
          sub="of repeat incidents"
        />
        <KPICard label="Top 10 Concentration" value={`${totals.concentration}%`} sub="of volume from 10 problems" />
      </div>

      {filteredActions.length > 0 && (
        <>
          <SectionTitle>Where to Act First</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            {filteredActions.slice(0, 6).map((a, i) => {
              const meta = ACTION_META[a.kind];
              const Icon = meta.icon;
              return (
                <button
                  key={`${a.cluster.id}-${i}`}
                  onClick={() => setSelected(a.cluster)}
                  className="v1-card-hover p-4 text-left"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 shrink-0 ${meta.tone}`} />
                    <span className={`font-mono text-[10px] font-bold uppercase tracking-wider ${meta.tone}`}>
                      {meta.label}
                    </span>
                    <span className="font-mono text-[11px] text-card-foreground/40 ml-auto">{a.cluster.count} incidents</span>
                  </div>
                  <div className="text-[13px] text-card-foreground leading-snug mb-1.5">{a.cluster.title}</div>
                  <div className="text-[12px] text-card-foreground/55 leading-snug">{a.reason}</div>
                </button>
              );
            })}
          </div>
        </>
      )}

      <SectionTitle>Volume by Category</SectionTitle>
      <div className="v1-card overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-card-foreground/5">
                {['Category', 'Incidents', 'Share', 'Distinct Problems', 'Root Cause', 'Median Resolve', 'SLA Breach', 'Avg Quality'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-card-foreground/50 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredCategories.map(c => (
                <tr key={c.name} className="border-t border-card-foreground/10 hover:bg-card-foreground/5 transition-colors">
                  <td className="px-4 py-2.5 text-card-foreground">{c.name}</td>
                  <td className="px-4 py-2.5 font-mono text-card-foreground/70">{c.count}</td>
                  <td className="px-4 py-2.5 font-mono text-card-foreground/50">{c.share}%</td>
                  <td className="px-4 py-2.5 font-mono text-card-foreground/50">{c.distinctProblems}</td>
                  <td className="px-4 py-2.5"><CoverageBar pct={c.rcaCoverage} /></td>
                  <td className="px-4 py-2.5 font-mono text-card-foreground/70">{formatDuration(c.medianResolutionHours)}</td>
                  <td className={`px-4 py-2.5 font-mono ${c.slaBreachPct !== null && c.slaBreachPct > 10 ? 'text-score-critical' : 'text-card-foreground/50'}`}>
                    {c.slaBreachPct === null ? '—' : `${c.slaBreachPct}%`}
                  </td>
                  <td className={`px-4 py-2.5 font-mono ${getScoreColor(c.avgScore)}`}>{c.avgScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SectionTitle>Recurring Problems</SectionTitle>
      <div className="flex flex-wrap gap-2.5 mb-5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search problems..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-secondary border border-border rounded-md pl-8 pr-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-56"
          />
        </div>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className={`${selectClass} max-w-[240px]`}>
          <option value="all">All Categories</option>
          {filteredCategories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-[13px] text-foreground cursor-pointer select-none px-3">
          <input
            type="checkbox"
            checked={onlyUndocumented}
            onChange={e => setOnlyUndocumented(e.target.checked)}
            className="accent-primary"
          />
          Undocumented only
        </label>
        <div className="text-[12px] text-muted-foreground self-center ml-auto font-medium">{visible.length} problems</div>
        <ExportButton
          onClick={() => exportProblems('view', visible, listFilters)}
          busy={exporting}
          disabled={visible.length === 0 || isDimensionFilterActive}
          title={isDimensionFilterActive
            ? DIMENSION_FILTER_EXPORT_NOTICE
            : 'Export the problems listed below, with all their incidents, to XLSX'}
        />
      </div>
      {isDimensionFilterActive && (
        <div className="text-[12px] text-muted-foreground -mt-3 mb-5 text-right">{DIMENSION_FILTER_EXPORT_NOTICE}</div>
      )}

      {visible.length === 0 ? (
        <EmptyState message="No recurring problems match these filters. A problem needs to appear at least twice." />
      ) : (
        <div className="v1-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-card-foreground/5">
                  {['Problem', 'Category', 'Count', 'Weeks', 'Root Cause Documented', 'Top Documented Cause', 'Median Resolve', 'Quality'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-card-foreground/50 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map(p => (
                  <tr
                    key={p.id}
                    onClick={() => setSelected(p)}
                    className="border-t border-card-foreground/10 hover:bg-card-foreground/5 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-2.5 text-card-foreground max-w-[320px]">
                      <div className="truncate">{p.title}</div>
                      {p.isChronic && (
                        <span className="inline-block mt-1 font-mono text-[9px] uppercase tracking-wider text-score-critical bg-score-critical/10 px-1.5 py-0.5 rounded">chronic</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-card-foreground/60 whitespace-nowrap">{p.category}</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-card-foreground">{p.count}</td>
                    <td className="px-4 py-2.5 font-mono text-card-foreground/50">{p.weeksActive}</td>
                    <td className="px-4 py-2.5"><CoverageBar pct={p.rcaCoverage} /></td>
                    <td className="px-4 py-2.5 text-card-foreground/60 max-w-[280px]">
                      <div className="truncate">{p.rootCauses[0]?.text ?? <span className="text-score-critical">none documented</span>}</div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-card-foreground/70 whitespace-nowrap">{formatDuration(p.medianResolutionHours)}</td>
                    <td className={`px-4 py-2.5 font-mono ${getScoreColor(p.avgScore)}`}>{p.avgScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <ProblemModal
          cluster={selected}
          onClose={() => setSelected(null)}
          onExport={() => exportProblems('problem', [selected], listFilters)}
          exporting={exporting}
          exportDisabledReason={isDimensionFilterActive ? DIMENSION_FILTER_EXPORT_NOTICE : undefined}
        />
      )}
    </div>
  );
}
