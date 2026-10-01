import type { ProblemCluster } from '@/lib/problems';
import { getScoreColor } from '@/components/ui/dashboard-primitives';
import ExportButton from '@/components/ExportButton';
import { formatDuration } from '@/lib/periods';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  cluster: ProblemCluster;
  onClose: () => void;
  /** Export this problem and its incidents; the button is hidden without it. */
  onExport?: () => void;
  exporting?: boolean;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-card-foreground/40 mb-1">{label}</div>
      <div className={`font-mono text-[18px] font-bold ${tone ?? 'text-card-foreground'}`}>{value}</div>
    </div>
  );
}

export default function ProblemModal({ cluster, onClose, onExport, exporting = false }: Props) {
  const undocumented = cluster.count - cluster.documentedCount;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="v1-card w-full max-w-3xl max-h-[85vh] overflow-y-auto m-4 shadow-xl"
          onClick={e => e.stopPropagation()}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          <div className="flex items-start justify-between gap-4 p-5 border-b border-card-foreground/10">
            <div className="min-w-0">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-card-foreground/40 mb-1">
                {cluster.category}
                {cluster.isChronic && <span className="ml-2 text-score-critical">· chronic</span>}
              </div>
              <h2 className="text-[16px] font-medium text-card-foreground leading-snug">{cluster.title}</h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {onExport && (
                <ExportButton onClick={onExport} busy={exporting} title="Export this problem and all its incidents to XLSX" />
              )}
              <button onClick={onClose} className="text-card-foreground/50 hover:text-card-foreground p-1 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="p-5 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <Stat label="Incidents" value={cluster.count} />
              <Stat label="Share" value={`${cluster.share}%`} />
              <Stat label="Weeks Active" value={cluster.weeksActive} />
              <Stat
                label="Root Cause"
                value={`${cluster.rcaCoverage}%`}
                tone={cluster.rcaCoverage >= 50 ? 'text-score-good' : 'text-score-critical'}
              />
              <Stat label="Median Resolve" value={formatDuration(cluster.medianResolutionHours)} />
              <Stat
                label="SLA Breach"
                value={cluster.slaBreachPct === null ? '—' : `${cluster.slaBreachPct}%`}
                tone={cluster.slaBreachPct !== null && cluster.slaBreachPct > 10 ? 'text-score-critical' : undefined}
              />
            </div>

            <div>
              <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-2.5">
                Documented Root Causes
              </div>
              {cluster.rootCauses.length === 0 ? (
                <div className="text-[13px] text-score-critical bg-score-critical/5 border border-score-critical/20 rounded-lg p-3.5">
                  Not one of these {cluster.count} incidents records why this happens. Until someone
                  writes the cause down, every recurrence starts the diagnosis from scratch.
                </div>
              ) : (
                <div className="space-y-2">
                  {cluster.rootCauses.map((rc, i) => (
                    <div key={i} className="flex items-start gap-3 bg-card-foreground/5 border border-card-foreground/10 rounded-lg p-3">
                      <div className="font-mono text-[13px] font-bold text-card-foreground w-10 shrink-0 text-right">
                        {rc.count}×
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-card-foreground leading-relaxed">{rc.text}</div>
                        <div className="w-full h-1.5 bg-card-foreground/10 rounded-full overflow-hidden mt-2">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${rc.pct}%` }} />
                        </div>
                      </div>
                      <div className="font-mono text-[11px] text-card-foreground/50 w-11 text-right shrink-0">{rc.pct}%</div>
                    </div>
                  ))}
                  {undocumented > 0 && (
                    <div className="text-[12px] text-card-foreground/50 pl-[52px]">
                      {undocumented} of {cluster.count} incidents document no cause at all.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-2">
                  Handled By Group
                </div>
                <div className="space-y-1.5">
                  {cluster.topGroups.map(g => (
                    <div key={g.name} className="flex justify-between gap-3 text-[13px]">
                      <span className="text-card-foreground/70 truncate">{g.name}</span>
                      <span className="font-mono text-card-foreground/50 shrink-0">{g.count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-2">
                  Handled By Agent
                </div>
                <div className="space-y-1.5">
                  {cluster.topAgents.map(a => (
                    <div key={a.name} className="flex justify-between gap-3 text-[13px]">
                      <span className="text-card-foreground/70 truncate">{a.name}</span>
                      <span className="font-mono text-card-foreground/50 shrink-0">{a.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-2">
                  Seen Between
                </div>
                <div className="text-[13px] text-card-foreground/70">
                  {cluster.firstSeen ? cluster.firstSeen.slice(0, 10) : '—'} → {cluster.lastSeen ? cluster.lastSeen.slice(0, 10) : '—'}
                </div>
              </div>
              <div>
                <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-2">
                  Avg Documentation Quality
                </div>
                <div className={`font-mono text-[18px] font-bold ${getScoreColor(cluster.avgScore)}`}>
                  {cluster.avgScore}
                </div>
              </div>
            </div>

            <div>
              <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-2">
                Example Incidents
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cluster.sampleNumbers.map(n => (
                  <span key={n} className="font-mono text-[11px] bg-card-foreground/5 border border-card-foreground/10 text-card-foreground/70 px-2 py-1 rounded">
                    {n}
                  </span>
                ))}
                {cluster.count > cluster.sampleNumbers.length && (
                  <span className="font-mono text-[11px] text-card-foreground/40 px-2 py-1">
                    +{cluster.count - cluster.sampleNumbers.length} more
                  </span>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
