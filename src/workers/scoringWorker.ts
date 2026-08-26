/**
 * Off-main-thread parsing and scoring of a ServiceNow incident export.
 *
 * All parsing, scoring and aggregation logic lives in `src/lib` and is imported
 * here — this file only owns the chunking, progress reporting and the memory
 * trimming that keeps very large exports transferable back to the main thread.
 */
import { enrichRow, readIncidentRows, type EnrichedIncident } from '../lib/parser';
import { scoreIncident, type IncidentScore } from '../lib/scorer';
import {
  computeOverview, computeDimStats, computeFeedback,
  computeAgentStats, computeGroupStats,
  type OverviewStats, type DimStats, type FeedbackItem, type AgentStat, type GroupStat,
} from '../lib/analytics';

export interface WorkerRequest {
  buffer: ArrayBuffer;
  name: string;
}

export interface WorkerResult {
  incidents: EnrichedIncident[];
  scores: IncidentScore[];
  overview: OverviewStats;
  dimStats: DimStats[];
  feedbackItems: FeedbackItem[];
  agentStats: AgentStat[];
  groupStats: GroupStat[];
  fileName: string;
}

export type WorkerMessage =
  | { type: 'progress'; percent: number; processed: number; total: number }
  | { type: 'result'; payload: WorkerResult }
  | { type: 'error'; payload: string };

/** Rows scored between progress reports / event-loop yields. */
const CHUNK = 500;

/**
 * Above this row count, drop the raw fields that nothing in the UI renders.
 * `descClean` and `humanNotes` text are deliberately kept — the incident detail
 * modal reads them, and blanking them silently emptied the modal for large files.
 */
const TRIM_RAW_FIELDS_ABOVE = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function post(message: WorkerMessage): void {
  self.postMessage(message);
}

self.onmessage = async function (e: MessageEvent<WorkerRequest>) {
  const { buffer, name } = e.data;

  try {
    post({ type: 'progress', percent: 5, processed: 0, total: 0 });

    const rows = readIncidentRows(buffer);
    const totalRows = rows.length;

    post({ type: 'progress', percent: 15, processed: 0, total: totalRows });

    const trimRawFields = totalRows > TRIM_RAW_FIELDS_ABOVE;
    const incidents: EnrichedIncident[] = [];
    const scores: IncidentScore[] = [];

    for (let i = 0; i < totalRows; i++) {
      const incident = enrichRow(rows[i]);
      scores.push(scoreIncident(incident));

      if (trimRawFields) {
        // `allNotes` duplicates `humanNotes`, and the raw strings are only ever
        // read through their cleaned counterparts.
        incident['Work notes'] = '';
        incident.Description = '';
        incident.allNotes = [];
      }

      incidents.push(incident);
      rows[i] = null;

      if ((i + 1) % CHUNK === 0) {
        post({
          type: 'progress',
          percent: Math.round(15 + ((i + 1) / totalRows) * 75),
          processed: i + 1,
          total: totalRows,
        });
        // Yield so the worker stays responsive and the collector can run.
        await sleep(0);
      }
    }

    post({ type: 'progress', percent: 92, processed: totalRows, total: totalRows });

    const payload: WorkerResult = {
      incidents,
      scores,
      overview: computeOverview(incidents, scores),
      dimStats: computeDimStats(scores),
      feedbackItems: computeFeedback(scores),
      agentStats: computeAgentStats(incidents, scores),
      groupStats: computeGroupStats(incidents, scores),
      fileName: name,
    };

    post({ type: 'progress', percent: 97, processed: totalRows, total: totalRows });
    post({ type: 'result', payload });
  } catch (err) {
    post({ type: 'error', payload: err instanceof Error ? err.message : String(err) });
  }
};
