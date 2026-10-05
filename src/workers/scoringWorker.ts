/**
 * Off-main-thread parsing and scoring of a ServiceNow incident export.
 *
 * All parsing, scoring and aggregation logic lives in `src/lib` and is imported
 * here — this file only owns the chunking, progress reporting and the memory
 * trimming that keeps very large exports transferable back to the main thread.
 */
import { checkIncidentTable, enrichRow, inferDateOrder, readIncidentTable, type EnrichedIncident, type SourceColumn } from '../lib/parser';
import { scoreIncident, type IncidentScore } from '../lib/scorer';
import {
  computeOverview, computeDimStats, computeFeedback,
  computeAgentStats, computeGroupStats,
  type OverviewStats, type DimStats, type FeedbackItem, type AgentStat, type GroupStat,
} from '../lib/analytics';
import { annotateIncidents, type AnnotatedIncident } from '../lib/problems';
import { computeFamilyPartitions, type FamilyRequest } from '../lib/families/families';

export interface WorkerRequest {
  buffer: ArrayBuffer;
  name: string;
}

export interface WorkerResult {
  incidents: AnnotatedIncident[];
  scores: IncidentScore[];
  overview: OverviewStats;
  dimStats: DimStats[];
  feedbackItems: FeedbackItem[];
  agentStats: AgentStat[];
  groupStats: GroupStat[];
  fileName: string;
  /** Source columns in their original order, so exports can rebuild them. */
  sourceColumns: SourceColumn[];
  /** True when raw Description and Work notes were dropped to save memory. */
  rawTextTrimmed: boolean;
  /** Signs of damaged file structure that did not stop the load. */
  warnings: string[];
}

/**
 * Experimental Incident Families (FAM-01): a separate request kind, sent only
 * by the flag-gated Incident Families page. It never touches ingestion.
 */
export interface FamiliesWorkerRequest extends FamilyRequest {
  kind: 'families';
}

export type FamiliesWorkerMessage =
  | { type: 'families'; payload: { variant: FamilyRequest['variant']; tau: number | null; thresholds: number[]; labels: Int32Array[]; elapsedMs: number } }
  | { type: 'families-error'; payload: string };

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

function runFamilies(request: FamiliesWorkerRequest): void {
  try {
    const started = performance.now();
    const result = computeFamilyPartitions(request);
    const message: FamiliesWorkerMessage = { type: 'families', payload: { ...result, elapsedMs: performance.now() - started } };
    self.postMessage(message, { transfer: result.labels.map(l => l.buffer) });
  } catch (err) {
    const message: FamiliesWorkerMessage = { type: 'families-error', payload: err instanceof Error ? err.message : String(err) };
    self.postMessage(message);
  }
}

self.onmessage = async function (e: MessageEvent<WorkerRequest | FamiliesWorkerRequest>) {
  if ('kind' in e.data && e.data.kind === 'families') {
    runFamilies(e.data);
    return;
  }
  const { buffer, name } = e.data as WorkerRequest;

  try {
    post({ type: 'progress', percent: 5, processed: 0, total: 0 });

    const table = readIncidentTable(buffer);
    const { errors, warnings } = checkIncidentTable(buffer, table);
    if (errors.length) {
      post({ type: 'error', payload: errors.join(' ') });
      return;
    }
    const { rows, columns: sourceColumns } = table;
    const totalRows = rows.length;

    post({ type: 'progress', percent: 15, processed: 0, total: totalRows });

    const trimRawFields = totalRows > TRIM_RAW_FIELDS_ABOVE;
    // Day/month order is a property of the file, so it is decided once up front.
    const dateOrder = inferDateOrder(rows);
    const incidents: EnrichedIncident[] = [];
    const scores: IncidentScore[] = [];

    for (let i = 0; i < totalRows; i++) {
      const incident = enrichRow(rows[i], { dateOrder });
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

    post({ type: 'progress', percent: 90, processed: totalRows, total: totalRows });

    // Clustering is corpus-level, so it runs once here rather than on every
    // filter change on the main thread.
    const annotated = annotateIncidents(incidents);

    post({ type: 'progress', percent: 94, processed: totalRows, total: totalRows });

    const payload: WorkerResult = {
      incidents: annotated,
      scores,
      overview: computeOverview(annotated, scores),
      dimStats: computeDimStats(scores),
      feedbackItems: computeFeedback(scores),
      agentStats: computeAgentStats(annotated, scores),
      groupStats: computeGroupStats(annotated, scores),
      fileName: name,
      sourceColumns,
      rawTextTrimmed: trimRawFields,
      warnings,
    };

    post({ type: 'progress', percent: 97, processed: totalRows, total: totalRows });
    post({ type: 'result', payload });
  } catch (err) {
    post({ type: 'error', payload: err instanceof Error ? err.message : String(err) });
  }
};
