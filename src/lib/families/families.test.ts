/** FAM-01 experimental Incident Families — library tests on synthetic data only. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { enrichRow, inferDateOrder, readIncidentTable } from '../parser';
import { annotateIncidents, type AnnotatedIncident } from '../problems';
import { availableWeeks } from '../weekly';
import { filterIncidents, ALL_VALUES } from '../problemView';
import { FAMILIES_RESEARCH } from '../../config/familiesResearch';
import { computeFamilyPartitions } from './families';
import { canonicalLabels } from './m1';
import {
  canonicalPartitionHash, familyMembers, numbersAreUnique, researchPartitionHash, researchRowKey, sha256Hex,
} from './hash';
import { buildVariant, identifierType, openTimeText } from './variants';
import { familyIdentity, familyRows, thresholdRow, weeklyReconciliation } from './view';

const FIXTURES = path.resolve(__dirname, '../../test/fixtures/families');

function load(file: string): AnnotatedIncident[] {
  const bytes = readFileSync(path.join(FIXTURES, file));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { rows } = readIncidentTable(buffer);
  const order = inferDateOrder(rows);
  return annotateIncidents(rows.map(r => enrichRow(r, { dateOrder: order })));
}

const pbna = load('syn_pbna.csv');
const pbnaTexts = pbna.map(i => openTimeText(i.shortDescClean, i.descClean));

function permute<T>(xs: T[], seed: number): { out: T[]; order: number[] } {
  const order = xs.map((_, i) => i);
  let s = seed;
  for (let i = order.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { out: order.map(i => xs[i]), order };
}

describe('sha256', () => {
  it('matches known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const text of ['é€', 'x'.repeat(55), 'y'.repeat(64), 'Ω😀\n', 'a'.repeat(1000)]) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });
});

describe('M1 partitions', () => {
  it('are identical under row permutation (canonical hash)', () => {
    const numbers = pbna.map(i => i.Number);
    for (const [variant, tau] of [['R0', undefined], ['R2', 0.05]] as const) {
      const base = computeFamilyPartitions({ texts: pbnaTexts, variant, tau });
      const { out, order } = permute(pbnaTexts, 7);
      const perm = computeFamilyPartitions({ texts: out, variant, tau });
      base.thresholds.forEach((_, t) => {
        expect(researchPartitionHash('SYN', order.map(i => numbers[i]), perm.labels[t]))
          .toBe(researchPartitionHash('SYN', numbers, base.labels[t]));
      });
    }
  });

  it('offers only registered thresholds, variants and taus', () => {
    const p = computeFamilyPartitions({ texts: pbnaTexts, variant: 'R1', tau: 0.02 });
    expect(p.thresholds).toEqual([...FAMILIES_RESEARCH.thresholds]);
    expect(() => computeFamilyPartitions({ texts: pbnaTexts, variant: 'R1', tau: 0.03 })).toThrow(/Unregistered tau/);
    expect(() => computeFamilyPartitions({ texts: pbnaTexts, variant: 'R3' as never })).toThrow(/Unregistered variant/);
  });

  it('nests: a higher threshold never merges what a lower one keeps apart', () => {
    const p = computeFamilyPartitions({ texts: pbnaTexts, variant: 'R0' });
    for (let t = 1; t < p.thresholds.length; t++) {
      const lower = p.labels[t - 1];
      for (const members of familyMembers(p.labels[t])) {
        expect(new Set(members.map(i => lower[i])).size).toBe(1);
        expect(lower[members[0]]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('joins identical texts at every threshold and never texts with no shared term', () => {
    const texts = ['disk full on volume alpha', 'disk full on volume alpha', 'printer jammed again today'];
    const p = computeFamilyPartitions({ texts, variant: 'R0' });
    for (const labels of p.labels) {
      expect(labels[0]).toBe(labels[1]);
      expect(labels[0]).toBeGreaterThanOrEqual(0);
      expect(labels[2]).toBe(-1);
    }
  });
});

describe('families vs singletons', () => {
  it('size ≥ 2 is a family, size 1 a singleton', () => {
    expect(Array.from(canonicalLabels([5, 5, 7, 9, 9, 9]))).toEqual([0, 0, -1, 1, 1, 1]);
  });
});

describe('identity', () => {
  it('checks Number presence and uniqueness after trimming', () => {
    expect(numbersAreUnique(['A1', 'A2'])).toBe(true);
    expect(numbersAreUnique(['A1', ' A1 '])).toBe(false);
    expect(numbersAreUnique(['A1', '  '])).toBe(false);
    expect(researchRowKey('SAP', ' A1 ')).toBe(researchRowKey('SAP', 'A1'));
  });

  it('blocks research hashing when identity is invalid', () => {
    expect(() => researchPartitionHash('SYN', ['A1', 'A1'], [0, 0])).toThrow(/blocked/);
    expect(() => researchPartitionHash('SYN', ['A1', ''], [0, 0])).toThrow(/blocked/);
  });

  it('orders display IDs independently of row order, also without unique numbers', () => {
    const base = computeFamilyPartitions({ texts: pbnaTexts, variant: 'R0' }).labels[1];
    for (const dupNumbers of [false, true]) {
      const incs = pbna.map(i => (dupNumbers ? { ...i, Number: 'SAME' } : i));
      const id = familyIdentity(incs, base);
      expect(id.numbersUnique).toBe(!dupNumbers);
      const { out, order } = permute(incs, 11);
      // Singletons (−1) get unique component ids before re-canonicalizing.
      const permLabels = Int32Array.from(order.map((i, k) => (base[i] >= 0 ? base[i] : base.length + k)));
      const permId = familyIdentity(out, canonicalLabels(permLabels));
      // The same members carry the same display ID.
      const byMember = (ids: typeof id, labels: Int32Array, rows: number[]) =>
        new Map(rows.map((r, k) => [r, labels[k] >= 0 ? ids.displayIds.get(labels[k]) : null]));
      const a = byMember(id, base, pbna.map((_, i) => i));
      const b = byMember(permId, canonicalLabels(permLabels), order);
      for (const [row, display] of a) expect(b.get(row)).toBe(display);
    }
  });
});

describe('R2 as executed', () => {
  it('maps whole tokens to HEX, ID or NUM only', () => {
    expect(identifierType('deadbeef01')).toBe('hex');
    expect(identifierType('srv01')).toBe('id');
    expect(identifierType('12345')).toBe('num');
    expect(identifierType('abc')).toBeNull();
    expect(buildVariant(['Host srv01.corp.example.com at 10.1.2.3 job 12345', 'x y z'], { variant: 'R2', tau: 0.9 })[0])
      .toBe('host tokid corp example com at toknum toknum toknum toknum job toknum');
  });
});

describe('view aggregations', () => {
  const incidents = pbna;
  const labels = computeFamilyPartitions({ texts: pbnaTexts, variant: 'R0' }).labels[2];
  const identity = familyIdentity(incidents, labels);
  const weeks = availableWeeks(incidents);

  it('threshold explorer reports full-dataset structure', () => {
    const row = thresholdRow(0.7, labels);
    const fams = familyMembers(labels);
    expect(row.familiesGe2).toBe(fams.length);
    expect(row.familiesGe5).toBe(fams.filter(m => m.length >= 5).length);
    expect(row.singletonShare).toBeCloseTo(labels.filter(l => l < 0).length / labels.length, 12);
  });

  it('reconciles every week, with and without filters', () => {
    const months = [...new Set(incidents.map(i => i.Opened.slice(0, 7)))].sort().slice(0, 5);
    const services = [...new Set(incidents.map(i => String(i.extraFields?.Service ?? '')))].filter(Boolean).slice(0, 3);
    const views = [
      incidents,
      filterIncidents(incidents, { months, services: ALL_VALUES, serviceOfferings: ALL_VALUES }),
      filterIncidents(incidents, { months: [], services: { values: services, includeMissing: false }, serviceOfferings: ALL_VALUES }),
    ];
    for (const view of views) {
      for (const r of weeklyReconciliation(incidents, view, labels, weeks)) {
        expect(r.inFamilies + r.singletons).toBe(r.incidents);
        expect(r.incidents).toBe(view.filter(i => i.week === r.week).length);
      }
    }
  });

  it('filters never change family identity or classification', () => {
    const fams = familyMembers(labels);
    const fam = fams.find(m => m.length >= 3)!;
    const view = [incidents[fam[0]]];
    const rows = familyRows(incidents, view, labels, identity, weeks, weeks[weeks.length - 1]);
    expect(rows).toHaveLength(1);
    expect(rows[0].size).toBe(fam.length);
    expect(rows[0].inView).toBe(1);
    expect(rows[0].displayId).toBe(identity.displayIds.get(labels[fam[0]]));
    const rec = weeklyReconciliation(incidents, view, labels, weeks).find(r => r.incidents === 1)!;
    expect(rec.inFamilies).toBe(1);
    expect(rec.singletons).toBe(0);
  });

  it('typical = 0 with incidents this week reads "New this period"', () => {
    // A family member in a week that has baseline weeks; hide the family's earlier incidents.
    const fam = familyMembers(labels).find(m => m.some(i => weeks.indexOf(incidents[i].week) > 0))!;
    const member = fam.find(i => weeks.indexOf(incidents[i].week) > 0)!;
    const week = incidents[member].week;
    const famSet = new Set(fam);
    const view = incidents.filter((inc, i) => !famSet.has(i) || inc.week === week);
    const row = familyRows(incidents, view, labels, identity, weeks, week).find(r => r.label === labels[member])!;
    expect(row.week.count).toBeGreaterThan(0);
    expect(row.week.typical).toBe(0);
    expect(row.week.newThisPeriod).toBe(true);
    expect(row.week.pct).toBeNull();
  });

  it('change vs typical uses the Weekly Review baseline (up to 4 prior weeks with data)', () => {
    const fams = familyMembers(labels);
    const pick = fams
      .map(m => ({ m, week: [...new Set(m.map(i => incidents[i].week))].filter(w => weeks.indexOf(w) >= 4).sort().pop() }))
      .find(x => x.week)!;
    expect(pick).toBeDefined();
    const { m: fam, week } = pick;
    const pos = weeks.indexOf(week!);
    const row = familyRows(incidents, incidents, labels, identity, weeks, week!).find(r => r.label === labels[fam[0]])!;
    const base = weeks.slice(pos - 4, pos);
    const count = (w: string) => fam.filter(i => incidents[i].week === w).length;
    const typical = base.reduce((sum, w) => sum + count(w), 0) / base.length;
    expect(row.week.count).toBe(count(week!));
    expect(row.week.typical).toBeCloseTo(typical, 12);
    expect(row.week.change).toBeCloseTo(count(week!) - typical, 12);
  });

  it('canonical hash matches the contract on a toy partition', () => {
    const keys = ['b', 'a', 'c', 'd'];
    expect(canonicalPartitionHash([0, 0, -1, 1], keys)).toBe(sha256Hex('[["a","b"]]'));
    expect(canonicalPartitionHash([1, 1, 0, 0], keys)).toBe(sha256Hex('[["a","b"],["c","d"]]'));
  });
});
