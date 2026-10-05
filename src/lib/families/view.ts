/**
 * Descriptive aggregations for the experimental Incident Families view.
 *
 * Families are fixed over the full loaded dataset (see `families.ts`). Filters
 * only change which of their incidents are shown, so every count here is over
 * the displayed population while family identity, size and display ID come
 * from the full dataset. Nothing here interprets a family beyond counting it.
 */
import { FAMILIES_DISPLAY } from '../../config/familiesDisplay';
import type { AnnotatedIncident } from '../problems';
import { baselineWeeksFor } from '../weekly';
import { dimensionValue } from '../serviceDimension';
import { familyMembers, numbersAreUnique, sha256Hex } from './hash';

type Incident = Pick<AnnotatedIncident, 'Number' | 'Opened' | 'week' | 'extraFields' | 'Assignment group' | 'clusterId' | 'shortDescClean' | 'descClean'>;

/** Threshold explorer row: full-dataset structure at one registered threshold. */
export interface ThresholdRow {
  threshold: number;
  familiesGe2: number;
  familiesGe5: number;
  /** Largest family's share of all incidents, 0–1. */
  largestShare: number;
  /** Share of incidents that are singletons, 0–1. */
  singletonShare: number;
}

export function thresholdRow(threshold: number, labels: Int32Array): ThresholdRow {
  const fams = familyMembers(labels);
  const n = labels.length;
  const singletons = labels.reduce((s, l) => s + (l < 0 ? 1 : 0), 0);
  return {
    threshold,
    familiesGe2: fams.length,
    familiesGe5: fams.filter(m => m.length >= 5).length,
    largestShare: n ? Math.max(0, ...fams.map(m => m.length)) / n : 0,
    singletonShare: n ? singletons / n : 0,
  };
}

/**
 * Display order of families: size descending, then an internal content key
 * ascending. The key hashes the family's members (trimmed incident numbers
 * when they identify incidents, otherwise each member's text plus Opened) in
 * sorted order, so it does not depend on row order. Never shown.
 */
export interface FamilyIdentity {
  /** Full-dataset family index (canonical label) → "F001"… */
  displayIds: Map<number, string>;
  /** False when incident numbers are missing or repeated in this file. */
  numbersUnique: boolean;
}

export function familyIdentity(incidents: Incident[], labels: Int32Array): FamilyIdentity {
  const numbersUnique = numbersAreUnique(incidents.map(i => i.Number));
  const memberKey = (i: number) => numbersUnique
    ? sha256Hex(`FAM-01|${incidents[i].Number.trim()}`)
    : sha256Hex(`${incidents[i].shortDescClean}\n${incidents[i].descClean}\u0000${incidents[i].Opened}`);
  const fams: { label: number; size: number; key: string }[] = [];
  const members = new Map<number, number[]>();
  labels.forEach((l, i) => {
    if (l < 0) return;
    const list = members.get(l);
    if (list) list.push(i);
    else members.set(l, [i]);
  });
  for (const [label, rows] of members) {
    fams.push({ label, size: rows.length, key: sha256Hex(JSON.stringify(rows.map(memberKey).sort())) });
  }
  fams.sort((a, b) => b.size - a.size || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const displayIds = new Map<number, string>();
  fams.forEach((f, idx) => displayIds.set(f.label, `F${String(idx + 1).padStart(3, '0')}`));
  return { displayIds, numbersUnique };
}

export interface WeekChange {
  count: number;
  /** null when the week has no baseline weeks (the first week with data). */
  typical: number | null;
  change: number | null;
  /** Percent change, only when typical > 0. */
  pct: number | null;
  /** Typical is 0 and the family has incidents this week. */
  newThisPeriod: boolean;
}

export interface FamilyRow {
  label: number;
  displayId: string;
  /** Full-dataset size (defines the family). */
  size: number;
  /** Incidents of the family in the displayed population. */
  inView: number;
  services: number;
  offerings: number;
  handledBy: number;
  /** Share of in-view incidents with no Service, 0–1. */
  noServiceShare: number;
  weeksPresent: number;
  recurring: boolean;
  week: WeekChange;
}

function weekChange(counts: Map<string, number>, week: string, baseline: string[]): WeekChange {
  const count = counts.get(week) ?? 0;
  if (baseline.length === 0) return { count, typical: null, change: null, pct: null, newThisPeriod: false };
  const typical = baseline.reduce((s, w) => s + (counts.get(w) ?? 0), 0) / baseline.length;
  const change = count - typical;
  return {
    count, typical, change,
    pct: typical > 0 ? Math.round((change / typical) * 100) : null,
    newThisPeriod: typical === 0 && count > 0,
  };
}

/**
 * One row per family with at least one incident in view. `view` is the
 * displayed population (a subset of `incidents`, same objects); `weeks` is
 * every week with data in the full file, as Weekly Review uses.
 */
export function familyRows(
  incidents: Incident[],
  view: Incident[],
  labels: Int32Array,
  identity: FamilyIdentity,
  weeks: string[],
  selectedWeek: string,
): FamilyRow[] {
  const rowOf = new Map<Incident, number>();
  incidents.forEach((inc, i) => rowOf.set(inc, i));
  const size = new Map<number, number>();
  labels.forEach(l => { if (l >= 0) size.set(l, (size.get(l) ?? 0) + 1); });
  const groups = new Map<number, Incident[]>();
  for (const inc of view) {
    const l = labels[rowOf.get(inc)!];
    if (l < 0) continue;
    const list = groups.get(l);
    if (list) list.push(inc);
    else groups.set(l, [inc]);
  }
  const baseline = baselineWeeksFor(weeks, selectedWeek);
  const rows: FamilyRow[] = [];
  for (const [label, members] of groups) {
    const svc = new Set<string>();
    const off = new Set<string>();
    const hg = new Set<string>();
    const weekCounts = new Map<string, number>();
    let noService = 0;
    for (const inc of members) {
      const s = dimensionValue(inc, 'service');
      if (s === null) noService++;
      else svc.add(s);
      const o = dimensionValue(inc, 'serviceOffering');
      if (o !== null) off.add(o);
      const g = dimensionValue(inc, 'assignmentGroup');
      if (g !== null) hg.add(g);
      if (inc.week) weekCounts.set(inc.week, (weekCounts.get(inc.week) ?? 0) + 1);
    }
    rows.push({
      label,
      displayId: identity.displayIds.get(label)!,
      size: size.get(label)!,
      inView: members.length,
      services: svc.size,
      offerings: off.size,
      handledBy: hg.size,
      noServiceShare: noService / members.length,
      weeksPresent: weekCounts.size,
      recurring: weekCounts.size >= FAMILIES_DISPLAY.recurringMinWeeks,
      week: weekChange(weekCounts, selectedWeek, baseline),
    });
  }
  return rows.sort((a, b) => b.size - a.size || (a.displayId < b.displayId ? -1 : 1));
}

export interface WeekReconciliation {
  week: string;
  /** Incidents in view that week. */
  incidents: number;
  inFamilies: number;
  singletons: number;
}

/**
 * Per week of the displayed population: incidents in families plus singleton
 * incidents equals incidents that week. Classification uses full-dataset
 * family size, so a family with one visible incident still counts as a family.
 */
export function weeklyReconciliation(incidents: Incident[], view: Incident[], labels: Int32Array, weeks: string[]): WeekReconciliation[] {
  const rowOf = new Map<Incident, number>();
  incidents.forEach((inc, i) => rowOf.set(inc, i));
  const byWeek = new Map(weeks.map(w => [w, { week: w, incidents: 0, inFamilies: 0, singletons: 0 }]));
  for (const inc of view) {
    const r = byWeek.get(inc.week);
    if (!r) continue;
    r.incidents++;
    if (labels[rowOf.get(inc)!] >= 0) r.inFamilies++;
    else r.singletons++;
  }
  return weeks.map(w => byWeek.get(w)!);
}

/** Members of one family in the displayed population, oldest first. */
export function familyMembersInView<T extends Incident>(incidents: T[], view: T[], labels: Int32Array, label: number): T[] {
  const rowOf = new Map<T, number>();
  incidents.forEach((inc, i) => rowOf.set(inc, i));
  return view.filter(inc => labels[rowOf.get(inc)!] === label).sort((a, b) => a.Opened.localeCompare(b.Opened));
}
