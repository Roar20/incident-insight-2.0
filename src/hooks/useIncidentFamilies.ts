import { useEffect, useState } from 'react';
import { FAMILIES_DISPLAY, familiesEnabled } from '@/config/families';
import type { AnnotatedIncident } from '@/lib/problems';
import type { FamilyPartitions } from '@/lib/families/families';
import { openTimeText, type TextVariant } from '@/lib/families/variants';
import type { FamiliesWorkerMessage, FamiliesWorkerRequest } from '@/workers/scoringWorker';

export type FamiliesState =
  | { status: 'disabled' }
  | { status: 'too-large'; rows: number }
  | { status: 'computing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; partitions: FamilyPartitions; elapsedMs: number };

type Cached = { partitions: FamilyPartitions; elapsedMs: number };

/** Results per loaded dataset (the incidents array) and variant/tau, so revisiting the page does not recompute. */
const cache = new WeakMap<AnnotatedIncident[], Map<string, Cached>>();

function startWorker(): Worker {
  return new Worker(new URL('../workers/scoringWorker.ts', import.meta.url), { type: 'module' });
}

/**
 * M1 families over the full loaded dataset, computed in the worker only while
 * the experimental page is mounted and the flag is on. Filters never reach
 * here: callers pass the full dataset, never a filtered view.
 */
export function useIncidentFamilies(incidents: AnnotatedIncident[], variant: TextVariant, tau: number): FamiliesState {
  const enabled = familiesEnabled();
  const tooLarge = incidents.length > FAMILIES_DISPLAY.maxRows;
  const key = variant === 'R0' ? 'R0' : `${variant}|${tau}`;
  const cached = enabled && !tooLarge ? cache.get(incidents)?.get(key) : undefined;
  const [state, setState] = useState<FamiliesState>({ status: 'computing' });

  useEffect(() => {
    if (!enabled || tooLarge || cached) return;
    setState({ status: 'computing' });
    const worker = startWorker();
    worker.onmessage = (e: MessageEvent<FamiliesWorkerMessage>) => {
      const msg = e.data;
      if (msg.type === 'families') {
        const { elapsedMs, ...partitions } = msg.payload;
        const entry = { partitions, elapsedMs };
        if (!cache.has(incidents)) cache.set(incidents, new Map());
        cache.get(incidents)!.set(key, entry);
        setState({ status: 'ready', ...entry });
        worker.terminate();
      } else if (msg.type === 'families-error') {
        setState({ status: 'error', message: msg.payload });
        worker.terminate();
      }
    };
    worker.onerror = err => {
      setState({ status: 'error', message: err.message });
      worker.terminate();
    };
    const request: FamiliesWorkerRequest = {
      kind: 'families',
      texts: incidents.map(i => openTimeText(i.shortDescClean, i.descClean)),
      variant,
      tau: variant === 'R0' ? undefined : tau,
    };
    worker.postMessage(request);
    return () => worker.terminate();
  }, [enabled, tooLarge, cached, incidents, key, variant, tau]);

  if (!enabled) return { status: 'disabled' };
  if (tooLarge) return { status: 'too-large', rows: incidents.length };
  if (cached) return { status: 'ready', ...cached };
  return state.status === 'ready' && (state.partitions.variant !== variant || (variant !== 'R0' && state.partitions.tau !== tau))
    ? { status: 'computing' }
    : state;
}
