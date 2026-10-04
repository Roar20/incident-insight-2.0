import { describe, it, expect } from 'vitest';
import {
  headline, lookDimension, medianResolutionHours, patternBreadth, periodSpan, topShare,
} from './executiveSummary';
import { slaSignal } from './slaSignal';
import { dimensionTable } from './serviceDimension';

const inc = (over: { ag?: string; s?: string; o?: string; cluster?: string; opened?: string } = {}) => ({
  Opened: over.opened ?? '2026-01-10 09:00:00',
  'Assignment group': over.ag ?? 'AG-1',
  clusterId: over.cluster ?? 'p-0',
  extraFields: { ...(over.s !== undefined ? { Service: over.s } : {}), ...(over.o !== undefined ? { 'Service offering': over.o } : {}) },
});
const none = new Set<string>();

describe('slaSignal', () => {
  const closed = (made: boolean | null) => ({ isClosed: true, 'Made SLA': made });
  it('is not available when the file has no SLA column', () => {
    expect(slaSignal([closed(true)], false)).toEqual({ state: 'not-available' });
  });
  it('is not available when no closed incident records the flag', () => {
    expect(slaSignal([closed(null), { isClosed: false, 'Made SLA': false }], true)).toEqual({ state: 'not-available' });
  });
  it('carries no signal when every tracked value is the same (all true or all false)', () => {
    expect(slaSignal([closed(true), closed(true), closed(null)], true)).toEqual({ state: 'no-signal', tracked: 2 });
    expect(slaSignal([closed(false), closed(false)], true)).toEqual({ state: 'no-signal', tracked: 2 });
  });
  it('reports the breach share of tracked closed incidents, as Overview does', () => {
    expect(slaSignal([closed(true), closed(false), closed(true), closed(true), { isClosed: false, 'Made SLA': false }], true))
      .toEqual({ state: 'available', tracked: 4, breachPct: 25 });
  });
});

describe('patternBreadth', () => {
  it('counts distinct known values among the pattern members only; blanks are never values', () => {
    const rows = [
      inc({ s: 'S-1', o: 'O-1', ag: 'AG-1' }),
      inc({ s: 'S-2', o: '', ag: 'AG-1' }),
      inc({ s: '', o: 'O-2', ag: ' ' }),
      inc({ s: 'S-9', o: 'O-9', ag: 'AG-9', cluster: 'p-1' }),
    ];
    expect(patternBreadth(rows, 'p-0')).toEqual({ incidents: 3, services: 2, serviceOfferings: 2, assignmentGroups: 1 });
  });
  it('is zero for a pattern with no visible members', () => {
    expect(patternBreadth([inc()], 'p-7')).toEqual({ incidents: 0, services: 0, serviceOfferings: 0, assignmentGroups: 0 });
  });
});

describe('topShare and lookDimension', () => {
  const rows = [
    ...Array(5).fill(0).map(() => inc({ ag: 'AG-1', s: 'S-1' })),
    ...Array(3).fill(0).map(() => inc({ ag: 'AG-2', s: 'S-2' })),
    inc({ ag: 'AG-3', s: 'S-3' }),
    inc({ ag: '', s: '' }),
  ];
  it('shares are over all visible incidents, the no-value row included', () => {
    const ag = dimensionTable(rows, 'assignmentGroup', none);
    expect(topShare(ag, 2)).toEqual({ named: 2, distinct: 3, incidents: 8, share: 0.8 });
    expect(ag.missing?.incidents).toBe(1);
  });
  it('uses Handling Group when it has two or more values', () => {
    expect(lookDimension({ assignmentGroup: dimensionTable(rows, 'assignmentGroup', none), service: dimensionTable(rows, 'service', none) })).toBe('assignmentGroup');
  });
  it('falls back to Service when one Handling Group handles everything, or the column is absent', () => {
    const single = rows.map(r => ({ ...r, 'Assignment group': 'AG-1' }));
    expect(lookDimension({ assignmentGroup: dimensionTable(single, 'assignmentGroup', none), service: dimensionTable(single, 'service', none) })).toBe('service');
    expect(lookDimension({ assignmentGroup: null, service: dimensionTable(rows, 'service', none) })).toBe('service');
    expect(lookDimension({ assignmentGroup: null, service: null, serviceOffering: null })).toBeNull();
  });
});

describe('periodSpan and medianResolutionHours', () => {
  it('spans the distinct Opened months', () => {
    expect(periodSpan([inc({ opened: '2026-03-02 10:00:00' }), inc({ opened: '2026-01-05 10:00:00' }), inc({ opened: '2026-03-09 10:00:00' }), inc({ opened: '' })]))
      .toEqual({ months: 2, first: '2026-01', last: '2026-03' });
  });
  it('takes the median of known durations (mean of the middle two when even), null when none', () => {
    expect(medianResolutionHours([{ resolutionHours: 4 }, { resolutionHours: null }, { resolutionHours: 1 }, { resolutionHours: 10 }])).toBe(4);
    expect(medianResolutionHours([{ resolutionHours: 1 }, { resolutionHours: 3 }])).toBe(2);
    expect(medianResolutionHours([{ resolutionHours: null }])).toBeNull();
  });
});

describe('headline', () => {
  const top = { named: 3, distinct: 10, incidents: 83, share: 0.83 };
  it('is a neutral factual sentence for Handling Groups', () => {
    expect(headline({ look: { dimension: 'assignmentGroup', top }, goodOrExcellent: 0.32, withoutDiagnosis: 0.76 }))
      .toBe('83% of incidents in view are handled by 3 of 10 Handling Groups; 32% of incidents are rated Good or Excellent for documentation and 76% have no documented diagnosis.');
  });
  it('says "associated with" on the Service fallback and uses no qualitative wording', () => {
    const text = headline({ look: { dimension: 'service', top: { ...top, distinct: 25 } }, goodOrExcellent: 0.58, withoutDiagnosis: 0.77 });
    expect(text.startsWith('83% of incidents in view are associated with 3 of 25 Services;')).toBe(true);
    expect(text).not.toMatch(/concentrated|small number|major|caused|root cause|owner|responsible|poor performing/i);
  });
  it('keeps only the documentation sentence when no dimension is available', () => {
    expect(headline({ look: null, goodOrExcellent: 0.5, withoutDiagnosis: 0.4 }))
      .toBe('50% of incidents are rated Good or Excellent for documentation and 40% have no documented diagnosis.');
  });
});
