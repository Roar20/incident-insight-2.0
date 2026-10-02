import * as XLSX from 'xlsx';
import { describe, it, expect } from 'vitest';
import { computeDatasetProfile, DATASET_PROFILE_VERSION } from './datasetProfile';
import { enrichRow, inferDateOrder, readIncidentTable } from './parser';

/** Parse rows through the real xlsx ingestion path, as the worker does. */
function load(rows: Record<string, unknown>[]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Page 1');
  const { rows: parsed, columns } = readIncidentTable(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  const dateOrder = inferDateOrder(parsed);
  return { incidents: parsed.map(r => enrichRow(r, { dateOrder })), columns };
}

describe('computeDatasetProfile', () => {
  const { incidents, columns } = load([
    { Number: 'INC1', 'Assignment group': 'AG-1', Channel: 'Channel-X', Opened: '2026-01-05 09:00:00', Closed: '2026-01-05 10:00:00', Service: 'Service-A', 'Service offering': 'Offering-1', 'Resolution code': 'Code-1' },
    { Number: 'INC2', 'Assignment group': 'AG-2', Channel: 'Channel-X', Opened: '2026-02-10 09:00:00', Closed: '', Service: 'Service-A', 'Service offering': 'Offering-2', 'Resolution code': '' },
    { Number: 'INC3', 'Assignment group': 'AG-2', Channel: 'Channel-Y', Opened: 'not a date', Closed: '2026-02-11 08:00:00', Service: 'Service-B', 'Service offering': 'Offering-2', 'Resolution code': 'Code-2' },
    { Number: 'INC4', 'Assignment group': '', Channel: '', Opened: '2025-12-31 23:59:59', Closed: '', Service: '', 'Service offering': 'Offering-1', 'Resolution code': 'Code-1' },
  ]);
  const profile = computeDatasetProfile(incidents, columns);

  it('reports presence and coverage per field, with the header it was read from', () => {
    expect(profile.profileVersion).toBe(DATASET_PROFILE_VERSION);
    expect(profile.rowCount).toBe(4);
    expect(profile.fields.service).toEqual({ status: 'PRESENT', sourceHeader: 'Service', nonEmpty: 3, empty: 1, coverage: 0.75 });
    expect(profile.fields.assignmentGroup).toEqual({ status: 'PRESENT', sourceHeader: 'Assignment group', nonEmpty: 3, empty: 1, coverage: 0.75 });
    expect(profile.fields.resolutionCode).toMatchObject({ status: 'PRESENT', nonEmpty: 3, empty: 1 });
    expect(profile.fields.assignedTo).toEqual({ status: 'ABSENT' });
    expect(profile.fields.workNotes).toEqual({ status: 'ABSENT' });
  });

  it('discovers values with counts, without a bucket for blanks', () => {
    expect(profile.values.service).toEqual({ values: [{ value: 'Service-A', count: 2 }, { value: 'Service-B', count: 1 }], distinct: 2 });
    expect(profile.values.serviceOffering.values).toEqual([{ value: 'Offering-1', count: 2 }, { value: 'Offering-2', count: 2 }]);
    expect(profile.values.assignmentGroup.values.map(v => v.value)).toEqual(['AG-2', 'AG-1']);
    // Channel values are listed as found — nothing says what they mean.
    expect(profile.values.channel).toEqual({ values: [{ value: 'Channel-X', count: 2 }, { value: 'Channel-Y', count: 1 }], distinct: 2 });
  });

  it('measures co-occurrence only over incidents carrying both values', () => {
    expect(profile.coOccurrence.serviceAssignmentGroup).toEqual({
      incidents: 3, pairs: 3, leftWithMultipleRight: 1, maxRightPerLeft: 2, rightWithMultipleLeft: 1, maxLeftPerRight: 2,
    });
    expect(profile.coOccurrence.serviceServiceOffering).toEqual({
      incidents: 3, pairs: 3, leftWithMultipleRight: 1, maxRightPerLeft: 2, rightWithMultipleLeft: 1, maxLeftPerRight: 2,
    });
  });

  it('reports date coverage from parseable timestamps only', () => {
    expect(profile.dates.opened).toEqual({ first: '2025-12-31 23:59:59', last: '2026-02-10 09:00:00', dated: 3, undated: 1 });
    expect(profile.dates.closed).toEqual({ first: '2026-01-05 10:00:00', last: '2026-02-11 08:00:00', dated: 2, undated: 2 });
  });

  it('marks absent dimensions ABSENT with no values, distinct null and no co-occurrence', () => {
    const { incidents: incs, columns: cols } = load([{ Number: 'INC1', 'Assignment group': 'AG-1' }]);
    const p = computeDatasetProfile(incs, cols);
    for (const f of ['service', 'serviceOffering', 'resolutionCode', 'channel'] as const) {
      expect(p.fields[f], f).toEqual({ status: 'ABSENT' });
    }
    expect(p.values.service).toEqual({ values: [], distinct: null });
    expect(p.coOccurrence).toEqual({ serviceAssignmentGroup: null, serviceServiceOffering: null });
    expect(p.dates).toEqual({ opened: null, closed: null });
  });

  it('tells a present-but-blank column apart from an absent one', () => {
    const { incidents: incs, columns: cols } = load([{ Number: 'INC1', Service: '' }, { Number: 'INC2', Service: '  ' }]);
    const p = computeDatasetProfile(incs, cols);
    expect(p.fields.service).toEqual({ status: 'PRESENT', sourceHeader: 'Service', nonEmpty: 0, empty: 2, coverage: 0 });
    expect(p.values.service).toEqual({ values: [], distinct: 0 });
  });

  it('reads snake_case canonical headers through the existing aliases', () => {
    const { incidents: incs, columns: cols } = load([{ number: 'INC1', assignment_group: 'AG-1', contact_type: 'Channel-Z', opened_at: '2026-03-01 00:00:00' }]);
    const p = computeDatasetProfile(incs, cols);
    expect(p.fields.assignmentGroup).toMatchObject({ status: 'PRESENT', sourceHeader: 'assignment_group' });
    expect(p.fields.channel).toMatchObject({ status: 'PRESENT', sourceHeader: 'contact_type' });
    expect(p.values.channel.values).toEqual([{ value: 'Channel-Z', count: 1 }]);
  });

  it('profiles an empty file without dividing by zero', () => {
    const p = computeDatasetProfile([], [{ name: 'Service' }, { name: 'Number' }]);
    expect(p.rowCount).toBe(0);
    expect(p.fields.service).toEqual({ status: 'PRESENT', sourceHeader: 'Service', nonEmpty: 0, empty: 0, coverage: null });
  });

  it('does not mutate the incidents', () => {
    const before = structuredClone(incidents);
    computeDatasetProfile(incidents, columns);
    expect(incidents).toEqual(before);
  });
});
