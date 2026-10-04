import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AnnotatedIncident } from '@/lib/problems';
import type { IncidentScore } from '@/lib/scorer';
import type { DimensionAvailability } from '@/lib/dimensions';
import { WEEKLY_COPY, WEEKLY_DISPLAY } from '@/config/weekly';
import {
  bridgeInsight, chooseCompositionDimension, colorsForValues, formatChange, weeklyComposition,
  type CompositionSeries, type CompositionWeek,
} from '@/lib/weeklyComposition';
import type { OrigenDimension } from '@/lib/serviceDimension';

const tickStyle = { fontSize: 11, fill: 'hsl(215,12%,50%)' };
/** The card surface, used as the 1px gap between stacked segments. */
const GAP = 'hsl(210,20%,20%)';
const HATCH_ID = 'weekly-composition-others-hatch';
const OUTLINE = 'hsl(0 0% 95% / 0.6)';

const DIMENSION_LABEL: Record<OrigenDimension, string> = {
  service: 'Service',
  serviceOffering: 'Service Offering',
  assignmentGroup: 'Handling Group',
};

function seriesFill(s: CompositionSeries, colors: Map<string, string>): string {
  if (s.kind === 'others') return `url(#${HATCH_ID})`;
  if (s.kind === 'missing') return 'transparent';
  return colors.get(s.value as string) ?? '#3987e5';
}

function Swatch({ s, colors }: { s: CompositionSeries; colors: Map<string, string> }) {
  if (s.kind === 'missing') return <span className="w-2.5 h-2.5 rounded-sm border border-dashed border-card-foreground/60 shrink-0" />;
  if (s.kind === 'others') {
    return <span className="w-2.5 h-2.5 rounded-sm shrink-0 border border-card-foreground/60"
      style={{ background: 'repeating-linear-gradient(45deg, hsl(0 0% 95% / 0.55) 0 2px, hsl(0 0% 95% / 0.12) 2px 4px)' }} />;
  }
  return <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: colors.get(s.value as string) }} />;
}

function CompositionTooltip({ active, payload, series }: {
  active?: boolean; payload?: { dataKey: string; payload: CompositionWeek }[]; series: CompositionSeries[];
}) {
  if (!active || !payload?.length) return null;
  const week = payload[0].payload;
  const byKey = new Map(series.map(s => [s.key, s]));
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-[12px] text-popover-foreground shadow-md max-w-[320px]">
      <div className="font-semibold mb-1">{week.label} · {week.total} {week.total === 1 ? 'incident' : 'incidents'}</div>
      {[...payload].reverse().filter(p => (week[p.dataKey] as number) > 0).map(p => {
        const s = byKey.get(p.dataKey)!;
        const n = week[p.dataKey] as number;
        return (
          <div key={p.dataKey} className={`flex justify-between gap-4 ${s.kind === 'value' ? '' : 'italic'}`}>
            <span className="truncate">{s.label}</span>
            <span className="font-mono whitespace-nowrap">{n} · {Math.round((n / week.total) * 100)}%</span>
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  /** The population "Incidents per week" counts (Weekly Review has no filters: the loaded incidents). */
  incidents: AnnotatedIncident[];
  scores: IncidentScore[];
  /** The weeks drawn by "Incidents per week", oldest first. */
  weeks: { key: string; label: string }[];
  selectedWeek: string;
  /** The baseline weeks Weekly Review already uses for the selected week. */
  baselineWeeks: string[];
  availability: DimensionAvailability;
}

/** "Where did this week's demand come from?" — the second half of the volume story. */
export default function WeeklyComposition({ incidents, scores, weeks, selectedWeek, baselineWeeks, availability }: Props) {
  const view = useMemo(() => {
    // Count exactly what "Incidents per week" counts: incidents that carry a score.
    const scored = new Set(scores.map(s => s.number));
    const counted = (i: Pick<AnnotatedIncident, 'Number'>) => scored.has(i.Number);
    const choice = chooseCompositionDimension(incidents, availability);
    if (!choice.dimension) return { choice, composition: null, colors: new Map<string, string>(), bridge: null };
    const composition = weeklyComposition(incidents, counted, weeks, choice.dimension, WEEKLY_DISPLAY.compositionTopN);
    const colors = colorsForValues(composition.series.filter(s => s.kind === 'value').map(s => s.value as string));
    const bridge = bridgeInsight(incidents, counted, choice.dimension, selectedWeek, baselineWeeks);
    return { choice, composition, colors, bridge };
  }, [incidents, scores, weeks, selectedWeek, baselineWeeks, availability]);

  const { choice, composition, colors, bridge } = view;
  const single = choice.singleService;
  const singleLine = single
    ? (single.missing > 0 ? WEEKLY_COPY.singleServiceWithMissing(single.value, single.missing) : WEEKLY_COPY.singleService(single.value))
    : null;
  const fallbackLine = choice.case === 'B' && choice.dimension === 'serviceOffering' ? WEEKLY_COPY.serviceDoesNotVary
    : choice.case === 'C' ? WEEKLY_COPY.serviceUnavailable
      : choice.case === 'D' ? WEEKLY_COPY.showingHandlingGroup
        : null;

  return (
    <div className="mt-6 pt-5 border-t border-card-foreground/10" data-testid="weekly-composition" data-case={choice.case}>
      <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50">{WEEKLY_COPY.compositionTitle}</div>
      {composition && (
        <div className="text-[12px] text-card-foreground/60 mt-0.5">{WEEKLY_COPY.compositionSubtitle(DIMENSION_LABEL[composition.dimension])}</div>
      )}
      {singleLine && <p className="mt-2 mb-0 text-[12px] text-card-foreground/80" data-testid="composition-single-service">{singleLine}</p>}
      {fallbackLine && <p className="mt-1 mb-0 text-[12px] text-card-foreground/70" data-testid="composition-fallback">{fallbackLine}</p>}

      {!composition ? (
        !single && <p className="mt-2 mb-0 text-[12px] text-card-foreground/70" data-testid="composition-empty">{WEEKLY_COPY.noInformativeDimension}</p>
      ) : (
        <>
          <div className="mt-3">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={composition.weeks}>
                <defs>
                  <pattern id={HATCH_ID} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill="hsl(0 0% 95% / 0.12)" />
                    <line x1="0" y1="0" x2="0" y2="6" stroke="hsl(0 0% 95% / 0.55)" strokeWidth="2" />
                  </pattern>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(210,15%,85%)" />
                <XAxis dataKey="label" tick={tickStyle} />
                <YAxis tick={tickStyle} allowDecimals={false} />
                <Tooltip cursor={{ fill: 'hsl(0 0% 95% / 0.06)' }} content={<CompositionTooltip series={composition.series} />} />
                {composition.series.map(s => (
                  <Bar key={s.key} dataKey={s.key} name={s.label} stackId="composition" isAnimationActive={false}
                    fill={seriesFill(s, colors)}
                    stroke={s.kind === 'missing' ? OUTLINE : s.kind === 'others' ? OUTLINE : GAP}
                    strokeWidth={1}
                    strokeDasharray={s.kind === 'missing' ? '3 2' : undefined} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 text-[11px] text-card-foreground/80 list-none p-0" data-testid="composition-legend">
            {composition.series.map(s => (
              <li key={s.key} className={`flex items-center gap-1.5 min-w-0 max-w-full ${s.kind === 'value' ? '' : 'italic text-card-foreground/70'}`} data-kind={s.kind}>
                <Swatch s={s} colors={colors} />
                <span className="truncate">{s.label}</span>
              </li>
            ))}
          </ul>
          {bridge && (
            <p className="mt-3 mb-0 text-[12px] text-card-foreground" data-testid="composition-bridge">
              Largest change vs typical this week: {bridge.value} ({formatChange(bridge.change)} incidents)
            </p>
          )}
        </>
      )}
    </div>
  );
}
