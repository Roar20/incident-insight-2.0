import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ORIGEN_DISPLAY } from '@/config/display';
import type { DimensionSelection } from '@/lib/problemView';
import type { DimensionTable } from '@/lib/serviceDimension';
import { NotAvailable } from './shared';
import { selectionAfterBarClick, serviceRanking, type RankingBar } from './serviceRanking';

const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);

// Theme tokens only. The chart sits on a dark card, so text uses card-foreground.
const TEXT = 'hsl(var(--card-foreground))';
const TEXT_SOFT = 'hsl(var(--card-foreground) / 0.75)';
const SERVICE_FILL = 'hsl(var(--sidebar-primary))';
const OUTLINE = 'hsl(var(--card-foreground) / 0.6)';
const HATCH_ID = 'service-ranking-others-hatch';

const ROW_HEIGHT = 30;
/** Below this width the chart scrolls sideways, as the tables do, instead of squeezing the names. */
const MIN_CHART_WIDTH = 320;

function barLabel(bar: RankingBar): string {
  if (bar.kind === 'others') return `Others (${bar.entries} Services)`;
  if (bar.kind === 'missing') return 'No Service';
  return bar.service as string;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function RankingTooltip({ active, payload }: { active?: boolean; payload?: { payload: RankingBar }[] }) {
  const bar = active ? payload?.[0]?.payload : undefined;
  if (!bar) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-[12px] text-popover-foreground shadow-md max-w-[320px]">
      <div className={`font-semibold break-words ${bar.kind === 'service' ? '' : 'italic'}`}>{barLabel(bar)}</div>
      <div>{bar.incidents} {bar.incidents === 1 ? 'incident' : 'incidents'}</div>
      <div>{pct(bar.shareOfVisible)} of visible</div>
      {bar.kind === 'others' && <div className="mt-1 text-popover-foreground/75">Display grouping of the remaining Services — not a Service.</div>}
      {bar.kind === 'missing' && <div className="mt-1 text-popover-foreground/75">Incidents with no Service recorded (missing value) — not a Service.</div>}
    </div>
  );
}

interface Props {
  /** The By Service table of the visible incidents — the chart draws exactly these rows. */
  table: DimensionTable;
  /** Whether the file has a Service column. */
  available: boolean;
  /** The global Service filter; a click toggles a bar in it, as the Service dropdown does. */
  selection: DimensionSelection;
  onSelectionChange: (selection: DimensionSelection) => void;
}

/** "Where is the noise?": visible incidents per Service as a horizontal ranking. */
export default function ServiceRankingChart({ table, available, selection, onSelectionChange }: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = wrapper.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // One wrapper in every state, so the width observer always watches the mounted element.
  let content;
  if (!available) {
    content = <NotAvailable message="This file has no Service column, so the Service ranking is not available. Expected header: “Service”." />;
  } else if (table.visible === 0) {
    content = <NotAvailable message="No results for the current filters." />;
  } else {
    content = <RankingChart table={table} width={width} selection={selection} onSelectionChange={onSelectionChange} />;
  }
  return <div ref={wrapper}>{content}</div>;
}

function RankingChart({ table, width, selection, onSelectionChange }: Omit<Props, 'available'> & { width: number }) {
  const { bars } = serviceRanking(table, ORIGEN_DISPLAY.rankingChartServices);
  // Narrow screens give the names less room; long names are cut and shown whole in the tooltip.
  const axisWidth = Math.round(Math.min(240, Math.max(96, Math.max(width, MIN_CHART_WIDTH) * 0.34)));
  const maxChars = Math.max(8, Math.floor(axisWidth / 6.6));
  const byKey = new Map(bars.map(b => [b.key, b]));

  const click = (bar: RankingBar) => {
    const next = selectionAfterBarClick(bar, selection);
    if (next) onSelectionChange(next);
  };

  return (
    <div className="v1-card p-4" data-testid="service-ranking-chart">
      <div className="overflow-x-auto">
      <div style={{ minWidth: MIN_CHART_WIDTH }}>
      <ResponsiveContainer width="100%" height={bars.length * ROW_HEIGHT + 28}>
        <BarChart data={bars} layout="vertical" margin={{ left: 4, right: 92, top: 4, bottom: 4 }} barCategoryGap={6}>
          <defs>
            <pattern id={HATCH_ID} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="hsl(var(--card-foreground) / 0.12)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="hsl(var(--card-foreground) / 0.55)" strokeWidth="2" />
            </pattern>
          </defs>
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: TEXT_SOFT }} stroke={OUTLINE} />
          <YAxis
            type="category"
            dataKey="key"
            width={axisWidth}
            interval={0}
            stroke={OUTLINE}
            tick={({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => {
              const bar = byKey.get(payload.value);
              if (!bar) return <g />;
              const label = barLabel(bar);
              return (
                <text x={x - 6} y={y} dy={4} textAnchor="end" fontSize={11} fill={bar.kind === 'service' ? TEXT : TEXT_SOFT} fontStyle={bar.kind === 'service' ? 'normal' : 'italic'} data-kind={bar.kind}>
                  <title>{label}</title>
                  {truncate(label, maxChars)}
                </text>
              );
            }}
          />
          <Tooltip cursor={{ fill: 'hsl(var(--card-foreground) / 0.06)' }} content={<RankingTooltip />} />
          <Bar dataKey="incidents" radius={[0, 3, 3, 0]} isAnimationActive={false} onClick={(data: { payload?: RankingBar }) => data.payload && click(data.payload)}>
            {bars.map(bar => (
              <Cell
                key={bar.key}
                data-kind={bar.kind}
                fill={bar.kind === 'service' ? SERVICE_FILL : bar.kind === 'others' ? `url(#${HATCH_ID})` : 'transparent'}
                stroke={bar.kind === 'service' ? undefined : OUTLINE}
                strokeDasharray={bar.kind === 'missing' ? '4 3' : undefined}
                cursor={bar.kind === 'others' ? 'default' : 'pointer'}
              />
            ))}
            <LabelList
              dataKey="key"
              position="right"
              content={({ x, y, width: w, height: h, value }: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: number | string }) => {
                const bar = byKey.get(String(value));
                if (!bar) return null;
                return (
                  <text x={Number(x) + Number(w) + 6} y={Number(y) + Number(h) / 2} dy={4} fontSize={11} fill={TEXT} className="font-mono">
                    {bar.incidents} · {pct(bar.shareOfVisible)}
                  </text>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-card-foreground/75">
        <span>Click a Service to apply it to the Service filter; click it again to remove it.</span>
        {bars.some(b => b.kind === 'others') && <span className="italic">Others: display grouping, not selectable.</span>}
        {bars.some(b => b.kind === 'missing') && <span className="italic">No Service: incidents with no Service recorded (missing value).</span>}
      </div>
    </div>
  );
}
