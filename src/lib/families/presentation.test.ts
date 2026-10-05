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
import { dataThrough } from '../weeklyComposition';
import {
  calendarWeeks, concentration, concentrationLead, displayText, factLine, groupCards, groupIdentity, groupName, groupTexts,
  isWeekComparable, shortDate, sparklineHeights, topShare, utcDateKey, weekEndDate, weekMonthLabel, weekOptionText, weekRangeText, weekSummary,
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
  const throughDate = utcDateKey(dataThrough(incidents)!);
  const base = { incidents, view: incidents, labels, identity, texts: gtexts, weeksWithData: weeks, dataThroughDate: throughDate };
  const canonical = (a: { label: number }, b: { label: number }) => identity.rank.get(a.label)! < identity.rank.get(b.label)!;

  it('IDs are G01… by total size', () => {
    const sizes = new Map<number, number>();
    labels.forEach(l => { if (l >= 0) sizes.set(l, (sizes.get(l) ?? 0) + 1); });
    const byId = [...identity.ids].sort((a, b) => a[1].localeCompare(b[1]));
    expect(byId[0][1]).toBe('G01');
    for (let i = 1; i < byId.length; i++) expect(sizes.get(byId[i - 1][0])!).toBeGreaterThanOrEqual(sizes.get(byId[i][0])!);
  });

  it('"Largest overall" (default) orders by filtered total, then canonical order; every group in view is listed', () => {
    const cards = groupCards({ ...base, selectedWeek: weeks[weeks.length - 5] });
    const groupsInView = new Set(Array.from(labels).filter(l => l >= 0));
    expect(cards).toHaveLength(groupsInView.size);
    for (let i = 1; i < cards.length; i++) {
      const [a, b] = [cards[i - 1], cards[i]];
      expect(a.total > b.total || (a.total === b.total && canonical(a, b))).toBe(true);
    }
    for (const c of cards) expect(c.total).toBe(c.sparkline.reduce((x, y) => x + y, 0));
  });

  it('"Most incidents in selected week" orders by week count, then total, then canonical order', () => {
    for (const week of weeks.slice(5, 30)) {
      const cards = groupCards({ ...base, selectedWeek: week, sort: 'selectedWeek' });
      for (let i = 1; i < cards.length; i++) {
        const [a, b] = [cards[i - 1], cards[i]];
        expect(a.count > b.count || (a.count === b.count && (a.total > b.total || (a.total === b.total && canonical(a, b))))).toBe(true);
      }
    }
  });

  it('ordering follows the filtered population', () => {
    const months = [...new Set(incidents.map(i => i.Opened.slice(0, 7)))].sort().slice(0, 6);
    const view = filterIncidents(incidents, { months, services: ALL_VALUES, serviceOfferings: ALL_VALUES });
    const cards = groupCards({ ...base, view, selectedWeek: weeks[weeks.length - 1] });
    for (const c of cards) expect(c.total).toBe(view.filter(i => labels[incidents.indexOf(i)] === c.label).length);
    for (let i = 1; i < cards.length; i++) expect(cards[i - 1].total).toBeGreaterThanOrEqual(cards[i].total);
  });

  it('a fully covered week keeps typical, delta, percentage and "New this period"; sparkline spans every calendar week', () => {
    let checkedNew = false;
    let checkedDelta = false;
    for (const week of weeks.slice(5, -1)) {
      expect(isWeekComparable(week, throughDate)).toBe(true);
      for (const c of groupCards({ ...base, selectedWeek: week })) {
        expect(c.comparable).toBe(true);
        expect(c.sparkline).toHaveLength(calendar.length);
        expect(c.sparkline[calendar.indexOf(week)]).toBe(c.count);
        if (c.typical === 0 && c.count > 0) {
          expect(c.newThisPeriod).toBe(true);
          expect(factLine(c, throughDate)).toBe(`${c.count} this week · New this period`);
          checkedNew = true;
        }
        if (c.typical !== null && c.typical > 0) {
          expect(c.pct).toBe(Math.round(((c.count - c.typical) / c.typical) * 100));
          expect(factLine(c, throughDate)).toMatch(/· typical [\d.]+ · [+−±]/);
          checkedDelta = true;
        }
      }
    }
    expect(checkedNew && checkedDelta).toBe(true);
  });

  it('the Data-through week, when not fully covered, shows only the count — never a comparison', () => {
    const last = weeks[weeks.length - 1];
    expect(throughDate < weekEndDate(last)).toBe(true);
    const cards = groupCards({ ...base, selectedWeek: last, sort: 'selectedWeek' });
    for (const c of cards) {
      expect(c.comparable).toBe(false);
      expect(c.typical).toBeNull();
      expect(c.change).toBeNull();
      expect(c.pct).toBeNull();
      expect(c.newThisPeriod).toBe(false);
      const line = factLine(c, throughDate);
      expect(line).toBe(`${c.count} ${c.count === 1 ? 'incident' : 'incidents'} through ${shortDate(throughDate)}`);
      expect(line).not.toMatch(/typical|New this period|[+−±]/);
    }
  });

  it('sparklines include empty weeks as zeros', () => {
    expect(calendar.length).toBeGreaterThan(weeks.length - 1);
    const cards = groupCards({ ...base, selectedWeek: weeks[weeks.length - 1] });
    expect(cards.some(c => c.sparkline.includes(0))).toBe(true);
  });

  it('fact line: typical with one decimal only when needed, neutral delta', () => {
    const f = (count: number, typical: number) => factLine({ count, typical, change: count - typical, newThisPeriod: false, comparable: true });
    expect(f(14, 9)).toBe('14 this week · typical 9 · +5');
    expect(f(2, 2.4)).toBe('2 this week · typical 2.4 · −0.4');
    expect(f(3, 3)).toBe('3 this week · typical 3 · ±0');
  });
});

describe('week coverage', () => {
  it('boundary: Data-through date equal to the ISO Sunday allows comparison; earlier suppresses it', () => {
    expect(weekEndDate('2026-W40')).toBe('2026-10-04');
    expect(isWeekComparable('2026-W40', '2026-10-04')).toBe(true);
    expect(isWeekComparable('2026-W40', '2026-10-03')).toBe(false);
    expect(isWeekComparable('2026-W40', '2026-10-05')).toBe(true);
  });

  it('uses calendar dates regardless of time of day', () => {
    // Late on the Sunday and the first minute of the Sunday give the same date.
    expect(utcDateKey(new Date(Date.UTC(2026, 9, 4, 0, 0, 1)))).toBe('2026-10-04');
    expect(utcDateKey(new Date(Date.UTC(2026, 9, 4, 23, 59, 59)))).toBe('2026-10-04');
    expect(isWeekComparable('2026-W40', utcDateKey(new Date(Date.UTC(2026, 9, 4, 0, 0, 1))))).toBe(true);
  });

  it('labels the week option with the Data-through date only when the data ends inside it', () => {
    expect(weekOptionText('2026-W40', '2026-09-30')).toBe('Sep 28 – Oct 4 · data through Sep 30');
    expect(weekOptionText('2026-W39', '2026-09-30')).toBe('Sep 21 – Sep 27');
    expect(weekMonthLabel('2026-W01')).toBe('Jan 2026');
    expect(weekMonthLabel('2026-W40')).toBe('Oct 2026');
  });
});

describe('concentration', () => {
  const identity = groupIdentity(incidents, labels);
  const gtexts = groupTexts(incidents, docs, labels);
  const throughDate = utcDateKey(dataThrough(incidents)!);
  const months = [...new Set(incidents.map(i => i.Opened.slice(0, 7)))].sort().slice(3, 8);
  const service = String(incidents[0].extraFields?.Service ?? '');
  const views = [
    incidents,
    filterIncidents(incidents, { months, services: ALL_VALUES, serviceOfferings: ALL_VALUES }),
    filterIncidents(incidents, { months: [], services: { values: [service], includeMissing: false }, serviceOfferings: ALL_VALUES }),
  ];

  it('top five groups of the active population over that same population', () => {
    for (const view of views) {
      const cards = groupCards({ incidents, view, labels, identity, texts: gtexts, weeksWithData: weeks, selectedWeek: weeks[weeks.length - 1], dataThroughDate: throughDate });
      const c = concentration(cards, view.length);
      const totals = new Map<number, number>();
      for (const inc of view) {
        const l = labels[incidents.indexOf(inc)];
        if (l >= 0) totals.set(l, (totals.get(l) ?? 0) + 1);
      }
      const top = [...totals.values()].sort((a, b) => b - a).slice(0, 5);
      expect(c.groups).toBe(top.length);
      expect(c.incidents).toBe(top.reduce((a, b) => a + b, 0));
      expect(c.population).toBe(view.length);
      expect(c.incidents).toBeLessThanOrEqual(c.population);
      expect(c.pct).toBe(Math.round((c.incidents / view.length) * 100));
    }
  });

  it('uses all groups when there are fewer than five', () => {
    const c = concentration([{ total: 4 }, { total: 2 }, { total: 1 }], 20);
    expect(c).toEqual({ groups: 3, incidents: 7, population: 20, pct: 35 });
    expect(concentrationLead(c)).toBe('The 3 repeating groups account for');
    expect(concentrationLead(concentration([{ total: 9 }, { total: 8 }, { total: 7 }, { total: 6 }, { total: 5 }, { total: 4 }], 50)))
      .toBe('The 5 largest repeating groups account for');
    expect(concentrationLead(concentration([{ total: 4 }], 10))).toBe('The only repeating group accounts for');
  });
});

describe('display cleanup', () => {
  it('tidies only the displayed name; the tooltip keeps the original text', () => {
    const inc = { shortDescClean: 'Host name.....node12  JOB_KILN_AMBER failed!!! ==== retry', descClean: '' };
    const before = JSON.stringify(inc);
    const name = groupName(inc);
    expect(name.short).toBe('Example: Host name…node12 JOB KILN AMBER failed! = retry');
    expect(name.full).toBe('Example: Host name.....node12  JOB_KILN_AMBER failed!!! ==== retry');
    expect(JSON.stringify(inc)).toBe(before);
    expect(displayText('a_b  c...d (x)')).toBe('a b c…d (x)');
  });

  it('never reaches the grouping input', () => {
    const t = ['JOB_KILN_AMBER failed.....now', 'x y z'];
    expect(buildVariant(t, { variant: 'R0' })[0]).toBe('job_kiln_amber failed.....now');
  });
});

describe('sparkline geometry', () => {
  it('keeps zero at zero, makes any non-zero week visible, and leaves the data untouched', () => {
    const series = [0, 1, 0, 40, 2];
    const copy = series.slice();
    const h = sparklineHeights(series, 28, 3);
    expect(h[0]).toBe(0);
    expect(h[2]).toBe(0);
    expect(h[1]).toBeGreaterThanOrEqual(3);
    expect(h[4]).toBeGreaterThanOrEqual(3);
    expect(h[3]).toBe(28);
    expect(series).toEqual(copy);
  });
});

describe('exploratory defaults', () => {
  it('opens with Remove repeated templates (R1, τ 0.05), a registered configuration', () => {
    expect(FAMILIES_DISPLAY.defaultVariant).toBe('R1');
    expect(FAMILIES_DISPLAY.defaultTau).toBe(0.05);
    expect(FAMILIES_RESEARCH.variants).toEqual(['R0', 'R1', 'R2']);
    expect([...FAMILIES_RESEARCH.taus]).toEqual([0.02, 0.05, 0.10]);
    expect([...FAMILIES_RESEARCH.thresholds]).toEqual([0.5, 0.6, 0.7, 0.8]);
    expect(FAMILIES_RESEARCH.taus).toContain(FAMILIES_DISPLAY.defaultTau);
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
