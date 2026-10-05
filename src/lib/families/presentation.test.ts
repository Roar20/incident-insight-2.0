/** FAM-01.1 presentation layer — synthetic data only. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { enrichRow, inferDateOrder, readIncidentTable } from '../parser';
import { annotateIncidents, type AnnotatedIncident } from '../problems';
import { availableWeeks } from '../weekly';
import { ALL_VALUES, filterIncidents } from '../problemView';
import { FAMILIES_RESEARCH } from '../../config/familiesResearch';
import { FAMILIES_DISPLAY } from '../../config/familiesDisplay';
import { computeFamilyPartitions } from './families';
import { canonicalLabels } from './m1';
import { buildVariant, openTimeText } from './variants';
import {
  calendarWeeks, factLine, groupCards, groupIdentity, groupName, groupTexts, topShare, weekRangeText, weekSummary,
} from './presentation';

function load(file: string): AnnotatedIncident[] {
  const bytes = readFileSync(path.resolve(__dirname, '../../test/fixtures/families', file));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { rows } = readIncidentTable(buffer);
  const order = inferDateOrder(rows);
  return annotateIncidents(rows.map(r => enrichRow(r, { dateOrder: order })));
}

function permute<T>(xs: T[], seed: number): number[] {
  const order = xs.map((_, i) => i);
  let s = seed;
  for (let i = order.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

const incidents = load('syn_pbna.csv');
const texts = incidents.map(i => openTimeText(i.shortDescClean, i.descClean));
const variant = 'R2' as const;
const tau = 0.05;
const balanced = FAMILIES_DISPLAY.strictness.balanced;
const parts = computeFamilyPartitions({ texts, variant, tau });
const labels = parts.labels[parts.thresholds.indexOf(balanced)];
const docs = buildVariant(texts, { variant, tau });
const weeks = availableWeeks(incidents);

describe('representative incident (group name)', () => {
  it('is deterministic and does not depend on row order', () => {
    const a = groupTexts(incidents, docs, labels);
    expect(groupTexts(incidents, docs, labels)).toEqual(a);
    const order = permute(incidents, 5);
    const pIncidents = order.map(i => incidents[i]);
    const pTexts = order.map(i => texts[i]);
    const pParts = computeFamilyPartitions({ texts: pTexts, variant, tau });
    const pLabels = pParts.labels[pParts.thresholds.indexOf(balanced)];
    const b = groupTexts(pIncidents, buildVariant(pTexts, { variant, tau }), pLabels);
    // Same group (by member numbers) → same representative incident and words.
    const key = (incs: AnnotatedIncident[], ls: Int32Array, label: number) =>
      incs.filter((_, i) => ls[i] === label).map(m => m.Number).sort().join('|');
    const byKey = new Map([...a].map(([label, t]) => [key(incidents, labels, label), { rep: incidents[t.representative].Number, words: t.commonWords }]));
    expect(b.size).toBe(a.size);
    for (const [label, t] of b) {
      expect(byKey.get(key(pIncidents, pLabels, label))).toEqual({ rep: pIncidents[t.representative].Number, words: t.commonWords });
    }
  });

  it('picks the most typical member; ties go to the earliest Opened', () => {
    const toy = ['disk full on volume', 'disk full on volume', 'disk full on volume today', 'printer jam'];
    const toyInc = toy.map((t, i) => ({ ...incidents[i], shortDescClean: t, descClean: '', Opened: `2026-01-0${4 - i} 10:00:00` }));
    const toyLabels = canonicalLabels([0, 0, 0, 1]);
    const t = groupTexts(toyInc, toy, toyLabels).get(0)!;
    // Rows 0 and 1 are identical and equally typical; row 1 opened earlier.
    expect(t.representative).toBe(1);
  });

  it('falls back to the description, then to "Group without text"', () => {
    expect(groupName({ shortDescClean: 'Batch step failed', descClean: 'x' }).short).toBe('Example: Batch step failed');
    const long = 'a'.repeat(100);
    expect(groupName({ shortDescClean: long, descClean: '' }).short).toBe(`Example: ${'a'.repeat(FAMILIES_DISPLAY.nameMaxChars)}…`);
    expect(groupName({ shortDescClean: long, descClean: '' }).full).toBe(`Example: ${long}`);
    expect(groupName({ shortDescClean: '  ', descClean: 'Only the body\nhas text' }).short).toBe('Example: Only the body has text');
    expect(groupName({ shortDescClean: '', descClean: '   ' }).short).toBe('Group without text');
  });
});

describe('week summary', () => {
  const months = [...new Set(incidents.map(i => i.Opened.slice(0, 7)))].sort().slice(2, 9);
  const service = String(incidents[0].extraFields?.Service ?? '');
  const views = [
    incidents,
    filterIncidents(incidents, { months, services: ALL_VALUES, serviceOfferings: ALL_VALUES }),
    filterIncidents(incidents, { months: [], services: { values: [service], includeMissing: false }, serviceOfferings: ALL_VALUES }),
  ];
  it('grouped + one-off = total, with and without filters, for several weeks', () => {
    for (const view of views) {
      for (const week of [weeks[0], weeks[10], weeks[40], weeks[weeks.length - 1]]) {
        const s = weekSummary(incidents, view, labels, week);
        expect(s.grouped + s.oneOff).toBe(s.total);
        expect(s.total).toBe(view.filter(i => i.week === week).length);
        const present = new Set(view.filter(i => i.week === week).map(i => labels[incidents.indexOf(i)]).filter(l => l >= 0));
        expect(s.groups).toBe(present.size);
      }
    }
  });
});

describe('group cards', () => {
  const identity = groupIdentity(incidents, labels);
  const gtexts = groupTexts(incidents, docs, labels);
  const calendar = calendarWeeks(weeks);

  it('IDs are G01… by total size', () => {
    const sizes = new Map<number, number>();
    labels.forEach(l => { if (l >= 0) sizes.set(l, (sizes.get(l) ?? 0) + 1); });
    const byId = [...identity.ids].sort((a, b) => a[1].localeCompare(b[1]));
    expect(byId[0][1]).toBe('G01');
    for (let i = 1; i < byId.length; i++) expect(sizes.get(byId[i - 1][0])!).toBeGreaterThanOrEqual(sizes.get(byId[i][0])!);
  });

  it('lists groups active in the week by count, then size, then canonical order; sparkline spans every calendar week', () => {
    let checkedNew = false;
    for (const week of weeks.slice(5)) {
      const cards = groupCards({ incidents, view: incidents, labels, identity, texts: gtexts, weeksWithData: weeks, selectedWeek: week });
      for (let i = 1; i < cards.length; i++) {
        const [a, b] = [cards[i - 1], cards[i]];
        expect(a.count > b.count || (a.count === b.count && (a.size > b.size || (a.size === b.size && identity.rank.get(a.label)! < identity.rank.get(b.label)!)))).toBe(true);
      }
      for (const c of cards) {
        expect(c.count).toBeGreaterThanOrEqual(1);
        expect(c.sparkline).toHaveLength(calendar.length);
        expect(c.sparkline[calendar.indexOf(week)]).toBe(c.count);
        expect(c.totalWeeks).toBe(calendar.length);
        if (c.typical === 0) {
          expect(c.newThisPeriod).toBe(true);
          expect(factLine(c)).toBe(`${c.count} this week · New this period`);
          expect(c.pct).toBeNull();
          checkedNew = true;
        }
      }
    }
    expect(checkedNew).toBe(true);
  });

  it('sparklines include empty weeks as zeros', () => {
    expect(calendar.length).toBeGreaterThan(weeks.length - 1);
    const cards = weeks.flatMap(week => groupCards({ incidents, view: incidents, labels, identity, texts: gtexts, weeksWithData: weeks, selectedWeek: week }));
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.some(c => c.sparkline.includes(0))).toBe(true);
  });

  it('fact line: typical with one decimal only when needed, neutral delta', () => {
    expect(factLine({ count: 14, typical: 9, change: 5, newThisPeriod: false })).toBe('14 this week · typical 9 · +5');
    expect(factLine({ count: 2, typical: 2.4, change: -0.4, newThisPeriod: false })).toBe('2 this week · typical 2.4 · −0.4');
    expect(factLine({ count: 3, typical: 3, change: 0, newThisPeriod: false })).toBe('3 this week · typical 3 · ±0');
  });
});

describe('top share', () => {
  it('reports the top value over all members and flags "mixed" under 50%', () => {
    expect(topShare(['A', 'A', 'B'])).toEqual({ value: 'A', pct: 67, mixed: false });
    expect(topShare(['A', 'B', 'C'])).toEqual({ value: 'A', pct: 33, mixed: true });
    expect(topShare([null, null, 'A'])).toEqual({ value: 'A', pct: 33, mixed: true });
    expect(topShare(['A', 'A', 'B', 'B'])).toEqual({ value: 'A', pct: 50, mixed: false });
    expect(topShare([null, null])).toEqual({ value: null, pct: 0, mixed: false });
  });
});

describe('strictness mapping', () => {
  it('uses only registered thresholds, Balanced = the exploratory default, the others adjacent', () => {
    const grid = [...FAMILIES_RESEARCH.thresholds] as number[];
    const { broader, balanced: b, stricter } = FAMILIES_DISPLAY.strictness;
    for (const v of [broader, b, stricter]) expect(grid).toContain(v);
    expect(b).toBe(FAMILIES_DISPLAY.defaultThreshold);
    expect(grid.indexOf(broader)).toBe(grid.indexOf(b) - 1);
    expect(grid.indexOf(stricter)).toBe(grid.indexOf(b) + 1);
  });
});

describe('weeks', () => {
  it('labels the ISO week range and fills calendar gaps across a year boundary', () => {
    expect(weekRangeText('2026-W40')).toBe('Sep 28 – Oct 4');
    expect(calendarWeeks(['2025-W51', '2026-W02'])).toEqual(['2025-W51', '2025-W52', '2026-W01', '2026-W02']);
  });
});
