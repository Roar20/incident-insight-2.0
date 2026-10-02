import { useAppContext } from '@/context/AppContext';
import { SectionTitle, EmptyState, getScoreColor } from '@/components/ui/dashboard-primitives';
import GlobalFilters from '@/components/GlobalFilters';
import { motion } from 'framer-motion';

export default function ByAgentPage() {
  const { filteredAgentStats: agentStats, filterLabel } = useAppContext();

  const filtered = filterLabel === 'all'
    ? agentStats
    : agentStats.filter(a => {
        if (filterLabel === 'Excellent') return a.excellent > 0;
        if (filterLabel === 'Good') return a.good > 0;
        if (filterLabel === 'Poor') return a.poor > 0;
        if (filterLabel === 'Critical') return a.critical > 0;
        return true;
      });

  return (
    <div className="animate-fade-in">
      <GlobalFilters />
      <SectionTitle>Performance by Agent</SectionTitle>
      {filtered.length === 0 && (
        <EmptyState message="No agents match the current filters and quality filter." />
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filtered.map((a, i) => (
          <motion.div
            key={a.name}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className="v1-card-hover p-4"
          >
            <div className="text-[13px] text-card-foreground font-medium mb-1">{a.name}</div>
            <div className="text-[11px] text-card-foreground/50 mb-3">{a.count} incidents</div>
            <div className={`font-mono text-[32px] font-bold mb-3 ${getScoreColor(a.avgScore)}`}>
              {a.avgScore}
            </div>
            <div className="flex gap-2 flex-wrap">
              {a.excellent > 0 && <span className="font-mono text-[11px] bg-score-excellent/15 text-score-excellent px-2 py-0.5 rounded-md">{a.excellent} Excellent</span>}
              {a.good > 0 && <span className="font-mono text-[11px] bg-score-good/15 text-score-good px-2 py-0.5 rounded-md">{a.good} Good</span>}
              {a.poor > 0 && <span className="font-mono text-[11px] bg-score-poor/15 text-score-poor px-2 py-0.5 rounded-md">{a.poor} Poor</span>}
              {a.critical > 0 && <span className="font-mono text-[11px] bg-score-critical/15 text-score-critical px-2 py-0.5 rounded-md">{a.critical} Critical</span>}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
