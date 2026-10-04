/**
 * Synthetic incidents for Weekly Review tests. Every value is generated —
 * nothing comes from a real export.
 */
import type { EnrichedIncident } from '../../lib/parser';
import type { IncidentScore } from '../../lib/scorer';

let seq = 0;

/** Monday of each ISO week used by the fixtures (2026-W10 … W15). */
export const WEEK_MONDAYS = ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30', '2026-04-06'];

export interface SyntheticIncidentSpec {
  /** Index into WEEK_MONDAYS. */
  week: number;
  /** Day offset within the week (0 = Monday). */
  day?: number;
  short?: string;
  service?: string;
  offering?: string;
  group?: string;
  madeSla?: boolean | null;
  state?: string;
}

export function syntheticIncident(spec: SyntheticIncidentSpec): EnrichedIncident {
  const date = new Date(`${WEEK_MONDAYS[spec.week]}T09:00:00Z`);
  date.setUTCDate(date.getUTCDate() + (spec.day ?? 0));
  const opened = date.toISOString().slice(0, 19).replace('T', ' ');
  const short = spec.short ?? 'Synthetic alert on test node';
  const extraFields: Record<string, string> = {};
  if (spec.service !== undefined) extraFields.Service = spec.service;
  if (spec.offering !== undefined) extraFields['Service offering'] = spec.offering;
  return {
    Number: `SYNW${String(++seq).padStart(6, '0')}`,
    'Task type': 'Incident',
    Priority: '3 - Moderate',
    State: spec.state ?? 'Closed',
    'Short description': short,
    Description: '',
    'Work notes': '',
    'Assignment group': spec.group ?? 'AG-001',
    'Assigned to': 'Person-1',
    Opened: opened,
    Closed: opened,
    Channel: 'Channel-Alpha',
    'Made SLA': spec.madeSla === undefined ? true : spec.madeSla,
    shortDescClean: short,
    descClean: '',
    allNotes: [],
    humanNotes: [],
    isAutoDesc: false,
    extraFields,
  } as EnrichedIncident;
}

/** n copies of a spec. */
export const many = (n: number, spec: SyntheticIncidentSpec): SyntheticIncidentSpec[] => Array.from({ length: n }, () => ({ ...spec }));

export function syntheticScore(number: string): IncidentScore {
  return {
    number, totalScore: 60, label: 'Good', color: '',
    dimScores: { description_quality: 60, root_cause: 100, steps_documented: 100, spelling_grammar: 95, professionalism: 80 },
    feedback: [], noiseRatio: 0, noteCount: 0, noteChars: 0,
  };
}
