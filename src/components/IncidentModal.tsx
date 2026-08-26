import type { EnrichedIncident } from '@/lib/parser';
import type { IncidentScore } from '@/lib/scorer';
import { getScoreColor } from '@/components/ui/dashboard-primitives';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  incident: EnrichedIncident;
  score: IncidentScore;
  onClose: () => void;
}

const DIM_LABELS: Record<string, string> = {
  description_quality: 'Description Quality',
  root_cause: 'Root Cause',
  steps_documented: 'Steps Documented',
  spelling_grammar: 'Spelling & Grammar',
  professionalism: 'Professionalism',
};

export default function IncidentModal({ incident, score, onClose }: Props) {
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
          className="v1-card w-full max-w-2xl max-h-[85vh] overflow-y-auto m-4 shadow-xl"
          onClick={e => e.stopPropagation()}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          <div className="flex items-center justify-between p-5 border-b border-card-foreground/10">
            <h2 className="font-mono text-lg font-bold text-card-foreground">{incident.Number}</h2>
            <button onClick={onClose} className="text-card-foreground/50 hover:text-card-foreground p-1 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            <div className="text-[13px] text-card-foreground/60">
              {incident['Assigned to']} · {incident['Assignment group']} · {incident.State} · {incident.Priority}
            </div>

            <div className="flex items-center gap-4">
              <div className={`font-mono text-[38px] font-bold ${getScoreColor(score.totalScore)}`}>
                {score.totalScore}
              </div>
              <div>
                <div className={`font-mono text-[15px] font-bold ${getScoreColor(score.totalScore)}`}>{score.label}</div>
                <div className="text-[12px] text-card-foreground/50 mt-0.5">
                  Noise: {Math.round(score.noiseRatio * 100)}% · Notes: {score.noteCount} · {score.noteChars} chars
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              {Object.entries(score.dimScores).map(([key, val]) => (
                <div key={key} className="flex items-center gap-3">
                  <div className="text-[12px] text-card-foreground/60 w-40">{DIM_LABELS[key]}</div>
                  <div className="flex-1 h-2.5 bg-card-foreground/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${val >= 80 ? 'bg-score-excellent' : val >= 55 ? 'bg-score-good' : val >= 30 ? 'bg-score-poor' : 'bg-score-critical'}`}
                      style={{ width: `${val}%` }}
                    />
                  </div>
                  <div className="font-mono text-[12px] text-card-foreground/60 w-10 text-right">{val}</div>
                </div>
              ))}
            </div>

            {score.feedback.length > 0 && (
              <div>
                <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-2">Feedback</div>
                <ul className="space-y-1.5">
                  {score.feedback.map((f, i) => (
                    <li key={i} className="text-[13px] text-score-poor">• {f}</li>
                  ))}
                </ul>
              </div>
            )}

            {incident.shortDescClean && (
              <div>
                <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-1.5">Short Description</div>
                <p className="text-[13px] text-card-foreground">{incident.shortDescClean}</p>
              </div>
            )}

            {incident.humanNotes.length > 0 && (
              <div>
                <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-2">Human Work Notes</div>
                <div className="space-y-2.5">
                  {incident.humanNotes.map((n, i) => (
                    <div key={i} className="bg-card-foreground/5 border border-card-foreground/10 rounded-lg p-3">
                      <div className="flex justify-between text-[11px] text-card-foreground/50 mb-1.5">
                        <span>{n.author}</span>
                        <span>{n.timestamp}</span>
                      </div>
                      <p className="text-[13px] text-card-foreground whitespace-pre-wrap leading-relaxed">{n.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {incident.descClean && (
              <div>
                <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-1.5">Full Description</div>
                <p className="text-[13px] text-card-foreground/70 whitespace-pre-wrap leading-relaxed">{incident.descClean}</p>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
