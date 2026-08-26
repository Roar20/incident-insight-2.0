import { useAppContext } from '@/context/AppContext';
import { SectionTitle, ScoreBadge, EmptyState, getNoiseColor } from '@/components/ui/dashboard-primitives';
import MonthFilter from '@/components/MonthFilter';

export default function ByGroupPage() {
  const { filteredGroupStats: groupStats } = useAppContext();

  return (
    <div className="animate-fade-in">
      <MonthFilter />
      <SectionTitle>Performance by Assignment Group</SectionTitle>
      {groupStats.length === 0 ? (
        <EmptyState message="No assignment groups match the selected months." />
      ) : (
      <div className="v1-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-card-foreground/5">
                {['Group', 'Count', 'Avg Score', 'Excellent', 'Critical', 'Avg Noise'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-card-foreground/50">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupStats.map(g => (
                <tr key={g.name} className="border-t border-card-foreground/10 hover:bg-card-foreground/5 transition-colors">
                  <td className="px-3 py-2.5 max-w-[250px] truncate text-xs text-card-foreground">{g.name}</td>
                  <td className="px-3 py-2.5 font-mono text-card-foreground/60 text-xs">{g.count}</td>
                  <td className="px-4 py-3">
                    <ScoreBadge label={g.avgScore >= 80 ? 'Excellent' : g.avgScore >= 55 ? 'Good' : g.avgScore >= 30 ? 'Poor' : 'Critical'} score={g.avgScore} />
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-score-excellent">{g.excellent}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-score-critical">{g.critical}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-[50px] h-[4px] bg-card-foreground/10 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${getNoiseColor(g.avgNoise / 100)}`} style={{ width: `${g.avgNoise}%` }} />
                      </div>
                      <span className="font-mono text-[11px] text-card-foreground/60">{g.avgNoise}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}
