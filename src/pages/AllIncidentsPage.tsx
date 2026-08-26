import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useAppContext } from '@/context/AppContext';
import { SectionTitle, ScoreBadge, MiniBar, getNoiseColor } from '@/components/ui/dashboard-primitives';
import IncidentModal from '@/components/IncidentModal';
import type { IncidentScore } from '@/lib/scorer';
import type { EnrichedIncident } from '@/lib/parser';
import { Search } from 'lucide-react';
import MonthFilter from '@/components/MonthFilter';
import { useVirtualizer } from '@tanstack/react-virtual';

type SortKey = 'score_desc' | 'score_asc' | 'noise_desc' | 'number';

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function AllIncidentsPage() {
  const { filteredIncidents: incidents, filteredScores: scores, filterLabel } = useAppContext();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [labelFilter, setLabelFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [sort, setSort] = useState<SortKey>('score_desc');
  const [selectedIncident, setSelectedIncident] = useState<{ incident: EnrichedIncident; score: IncidentScore } | null>(null);

  const parentRef = useRef<HTMLDivElement>(null);

  const scoreMap = useMemo(() => new Map(scores.map(s => [s.number, s])), [scores]);
  const groups = useMemo(() => [...new Set(incidents.map(i => i['Assignment group']))].filter(Boolean).sort(), [incidents]);
  const states = useMemo(() => [...new Set(incidents.map(i => i.State))].filter(Boolean).sort(), [incidents]);

  const activeLabel = filterLabel !== 'all' ? filterLabel : labelFilter;

  const filtered = useMemo(() => {
    let result = incidents.map(inc => ({ incident: inc, score: scoreMap.get(inc.Number)! })).filter(r => r.score);

    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(r =>
        r.incident.Number.toLowerCase().includes(q) ||
        r.incident['Assigned to'].toLowerCase().includes(q) ||
        r.incident['Short description'].toLowerCase().includes(q) ||
        r.incident['Assignment group'].toLowerCase().includes(q)
      );
    }
    if (activeLabel !== 'all') result = result.filter(r => r.score.label === activeLabel);
    if (groupFilter !== 'all') result = result.filter(r => r.incident['Assignment group'] === groupFilter);
    if (stateFilter !== 'all') result = result.filter(r => r.incident.State === stateFilter);

    switch (sort) {
      case 'score_desc': result.sort((a, b) => b.score.totalScore - a.score.totalScore); break;
      case 'score_asc': result.sort((a, b) => a.score.totalScore - b.score.totalScore); break;
      case 'noise_desc': result.sort((a, b) => b.score.noiseRatio - a.score.noiseRatio); break;
      case 'number': result.sort((a, b) => a.incident.Number.localeCompare(b.incident.Number)); break;
    }

    return result;
  }, [incidents, scoreMap, debouncedSearch, activeLabel, groupFilter, stateFilter, sort]);

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });

  const selectClass = "bg-secondary border border-border rounded-md px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="animate-fade-in">
      <MonthFilter />
      <SectionTitle>All Incidents</SectionTitle>

      <div className="flex flex-wrap gap-2.5 mb-5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search incidents..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-secondary border border-border rounded-md pl-8 pr-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-56"
          />
        </div>
        <select value={labelFilter} onChange={e => setLabelFilter(e.target.value)} className={selectClass}>
          <option value="all">All Labels</option>
          <option value="Excellent">Excellent</option>
          <option value="Good">Good</option>
          <option value="Poor">Poor</option>
          <option value="Critical">Critical</option>
        </select>
        <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)} className={`${selectClass} max-w-[220px]`}>
          <option value="all">All Groups</option>
          {groups.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} className={selectClass}>
          <option value="all">All States</option>
          {states.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className={selectClass}>
          <option value="score_desc">Score ↓</option>
          <option value="score_asc">Score ↑</option>
          <option value="noise_desc">Noise ↓</option>
          <option value="number">Incident #</option>
        </select>
        <div className="text-[12px] text-muted-foreground self-center ml-auto font-medium">{filtered.length} results</div>
      </div>

      <div className="v1-card overflow-hidden">
        <table className="w-full table-fixed">
          <thead>
            <tr className="bg-card-foreground/5">
              <th className="w-[130px] px-4 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-card-foreground/50">Number</th>
              <th className="px-4 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-card-foreground/50">Short Description</th>
              <th className="w-[200px] px-4 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-card-foreground/50">Group</th>
              <th className="w-[90px] px-4 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-card-foreground/50">State</th>
              <th className="w-[180px] px-4 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-card-foreground/50">Score</th>
              <th className="w-[110px] px-4 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-card-foreground/50">Noise</th>
              <th className="w-[60px] px-4 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-card-foreground/50">Notes</th>
            </tr>
          </thead>
        </table>

        <div ref={parentRef} className="overflow-auto" style={{ height: Math.min(filtered.length * 44, 600) }}>
          <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map(virtualRow => {
              const { incident, score } = filtered[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  onClick={() => setSelectedIncident({ incident, score })}
                  className="flex items-center border-t border-card-foreground/10 cursor-pointer hover:bg-card-foreground/5 transition-colors"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="w-[130px] px-4 py-2.5 font-mono text-[13px] text-card-foreground shrink-0">
                    {incident.Number}
                    {incident.isAutoDesc && <span className="ml-1.5 text-[9px] text-auto-tag bg-auto-tag/10 px-1.5 py-0.5 rounded">auto</span>}
                  </div>
                  <div className="flex-1 px-4 py-2.5 text-[13px] text-card-foreground truncate">{incident['Short description']}</div>
                  <div className="w-[200px] px-4 py-2.5 text-[12px] text-card-foreground/60 truncate shrink-0">{incident['Assignment group']}</div>
                  <div className="w-[90px] px-4 py-2.5 text-[12px] text-card-foreground/60 shrink-0">{incident.State}</div>
                  <div className="w-[180px] px-4 py-2.5 shrink-0">
                    <div className="flex items-center gap-2">
                      <ScoreBadge label={score.label} score={score.totalScore} />
                      <MiniBar value={score.totalScore} />
                    </div>
                  </div>
                  <div className="w-[110px] px-4 py-2.5 shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="w-[50px] h-[4px] bg-card-foreground/10 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${getNoiseColor(score.noiseRatio)}`} style={{ width: `${score.noiseRatio * 100}%` }} />
                      </div>
                      <span className="font-mono text-[11px] text-card-foreground/60">{Math.round(score.noiseRatio * 100)}%</span>
                    </div>
                  </div>
                  <div className="w-[60px] px-4 py-2.5 font-mono text-[12px] text-card-foreground/60 shrink-0">{score.noteCount}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selectedIncident && (
        <IncidentModal
          incident={selectedIncident.incident}
          score={selectedIncident.score}
          onClose={() => setSelectedIncident(null)}
        />
      )}
    </div>
  );
}
