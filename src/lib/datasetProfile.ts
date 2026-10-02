/**
 * Dataset profile: what data is present in the loaded file.
 *
 * Deterministic discovery only. The profile reports which fields a file has,
 * how complete they are, which values occur and how dimensions co-occur. It
 * does not say what any of that means: no Channel value is called automated or
 * human, no Service is called dominant or noisy, no pair is called unusual, and
 * co-occurrence of a Service and an Assignment group is not ownership or
 * reassignment. Interpretation belongs to later, separately approved features.
 *
 * A field the file does not have is ABSENT — never a field with zero values.
 */
import { SCHEMA_CONFIG_VERSION, type DimensionField } from '../config/schema';
import { dimensionSourceHeader, getDimension } from './dimensions';
import { SOURCE_COLUMNS, type EnrichedIncident, type SourceColumn } from './parser';
import { parseTimestamp } from './periods';

export const DATASET_PROFILE_VERSION = '1.0.0';

/** Fields the profile reports on, canonical first, then optional dimensions. */
export type ProfiledField =
  | 'assignmentGroup' | 'assignedTo' | 'channel' | 'opened' | 'closed' | 'workNotes'
  | DimensionField;

/** The categorical fields whose values are discovered. */
export type DiscoveredField = 'assignmentGroup' | 'channel' | DimensionField;

const CANONICAL: Record<Exclude<ProfiledField, DimensionField>, keyof typeof SOURCE_COLUMNS> = {
  assignmentGroup: 'Assignment group',
  assignedTo: 'Assigned to',
  channel: 'Channel',
  opened: 'Opened',
  closed: 'Closed',
  workNotes: 'Work notes',
};

export type FieldPresence =
  | { status: 'ABSENT' }
  | {
      status: 'PRESENT';
      /** The source header the value was read from. */
      sourceHeader: string;
      /** Incidents with a non-blank value. */
      nonEmpty: number;
      /** Incidents with a blank value. */
      empty: number;
      /** nonEmpty / rowCount, or null for a file with no rows. */
      coverage: number | null;
    };

export interface ValueCount {
  value: string;
  count: number;
}

export interface DiscoveredValues {
  /** Distinct non-blank values, most frequent first (ties by value). Empty for an ABSENT field. */
  values: ValueCount[];
  /** Distinct non-blank values, or null when the field is ABSENT. */
  distinct: number | null;
}

/** How two dimensions co-occur in the incidents that carry both. */
export interface CoOccurrence {
  /** Incidents with a value for both dimensions. */
  incidents: number;
  /** Distinct (left, right) pairs. */
  pairs: number;
  /** Left values seen with more than one right value, and the most right values any left value has. */
  leftWithMultipleRight: number;
  maxRightPerLeft: number;
  /** Right values seen with more than one left value, and the most left values any right value has. */
  rightWithMultipleLeft: number;
  maxLeftPerRight: number;
}

export interface DateCoverage {
  /** Earliest and latest parseable timestamp, as stored ("YYYY-MM-DD HH:MM:SS"). */
  first: string | null;
  last: string | null;
  dated: number;
  /** Incidents whose value is blank or not a parseable date. */
  undated: number;
}

export interface DatasetProfile {
  profileVersion: string;
  schemaConfigVersion: string;
  rowCount: number;
  fields: Record<ProfiledField, FieldPresence>;
  values: Record<DiscoveredField, DiscoveredValues>;
  /** Null when either dimension is ABSENT. */
  coOccurrence: {
    serviceAssignmentGroup: CoOccurrence | null;
    serviceServiceOffering: CoOccurrence | null;
  };
  /** Null when the column is ABSENT. */
  dates: { opened: DateCoverage | null; closed: DateCoverage | null };
}

function canonicalHeader(field: keyof typeof SOURCE_COLUMNS, names: Set<string>): string | null {
  return SOURCE_COLUMNS[field].find(alias => names.has(alias)) ?? null;
}

/** The value an incident holds for a profiled field, or null when blank. */
function valueOf(incident: EnrichedIncident, field: ProfiledField): string | null {
  if (field === 'service' || field === 'serviceOffering' || field === 'resolutionCode') {
    return getDimension(incident, field);
  }
  const value = incident[CANONICAL[field]];
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? null : text;
}

function countValues(incidents: EnrichedIncident[], field: ProfiledField): ValueCount[] {
  const counts = new Map<string, number>();
  for (const inc of incidents) {
    const value = valueOf(inc, field);
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

function coOccurrence(incidents: EnrichedIncident[], left: ProfiledField, right: ProfiledField): CoOccurrence {
  const rightsByLeft = new Map<string, Set<string>>();
  const leftsByRight = new Map<string, Set<string>>();
  let both = 0;
  for (const inc of incidents) {
    const l = valueOf(inc, left);
    const r = valueOf(inc, right);
    if (l === null || r === null) continue;
    both++;
    let rights = rightsByLeft.get(l);
    if (!rights) rightsByLeft.set(l, (rights = new Set()));
    rights.add(r);
    let lefts = leftsByRight.get(r);
    if (!lefts) leftsByRight.set(r, (lefts = new Set()));
    lefts.add(l);
  }
  const sizes = (m: Map<string, Set<string>>) => [...m.values()].map(s => s.size);
  const rightSizes = sizes(rightsByLeft);
  const leftSizes = sizes(leftsByRight);
  return {
    incidents: both,
    pairs: rightSizes.reduce((a, b) => a + b, 0),
    leftWithMultipleRight: rightSizes.filter(n => n > 1).length,
    maxRightPerLeft: rightSizes.reduce((a, b) => Math.max(a, b), 0),
    rightWithMultipleLeft: leftSizes.filter(n => n > 1).length,
    maxLeftPerRight: leftSizes.reduce((a, b) => Math.max(a, b), 0),
  };
}

function dateCoverage(incidents: EnrichedIncident[], field: 'Opened' | 'Closed'): DateCoverage {
  let first: string | null = null;
  let last: string | null = null;
  let dated = 0;
  for (const inc of incidents) {
    const value = inc[field];
    if (!parseTimestamp(value)) continue;
    dated++;
    if (first === null || value < first) first = value;
    if (last === null || value > last) last = value;
  }
  return { first, last, dated, undated: incidents.length - dated };
}

/**
 * Profile the loaded file.
 *
 * `incidents` are the parsed incidents; `sourceColumns` is the column layout
 * from `readIncidentTable`, which is how a missing column is told apart from a
 * column whose cells are all blank.
 */
export function computeDatasetProfile(incidents: EnrichedIncident[], sourceColumns: readonly Pick<SourceColumn, 'name'>[]): DatasetProfile {
  const names = new Set(sourceColumns.map(c => c.name));
  const rowCount = incidents.length;

  const presence = (field: ProfiledField): FieldPresence => {
    const sourceHeader = field === 'service' || field === 'serviceOffering' || field === 'resolutionCode'
      ? dimensionSourceHeader(field, sourceColumns)
      : canonicalHeader(CANONICAL[field], names);
    if (sourceHeader === null) return { status: 'ABSENT' };
    let nonEmpty = 0;
    for (const inc of incidents) if (valueOf(inc, field) !== null) nonEmpty++;
    return {
      status: 'PRESENT',
      sourceHeader,
      nonEmpty,
      empty: rowCount - nonEmpty,
      coverage: rowCount > 0 ? nonEmpty / rowCount : null,
    };
  };

  const fieldList: ProfiledField[] = [
    'assignmentGroup', 'assignedTo', 'channel', 'opened', 'closed', 'workNotes',
    'service', 'serviceOffering', 'resolutionCode',
  ];
  const fields = Object.fromEntries(fieldList.map(f => [f, presence(f)])) as Record<ProfiledField, FieldPresence>;
  const present = (f: ProfiledField) => fields[f].status === 'PRESENT';

  const discovered: DiscoveredField[] = ['assignmentGroup', 'channel', 'service', 'serviceOffering', 'resolutionCode'];
  const values = Object.fromEntries(discovered.map(f => {
    if (!present(f)) return [f, { values: [], distinct: null }];
    const list = countValues(incidents, f);
    return [f, { values: list, distinct: list.length }];
  })) as Record<DiscoveredField, DiscoveredValues>;

  return {
    profileVersion: DATASET_PROFILE_VERSION,
    schemaConfigVersion: SCHEMA_CONFIG_VERSION,
    rowCount,
    fields,
    values,
    coOccurrence: {
      serviceAssignmentGroup: present('service') && present('assignmentGroup')
        ? coOccurrence(incidents, 'service', 'assignmentGroup') : null,
      serviceServiceOffering: present('service') && present('serviceOffering')
        ? coOccurrence(incidents, 'service', 'serviceOffering') : null,
    },
    dates: {
      opened: present('opened') ? dateCoverage(incidents, 'Opened') : null,
      closed: present('closed') ? dateCoverage(incidents, 'Closed') : null,
    },
  };
}
