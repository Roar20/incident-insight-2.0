import { useMemo } from 'react';
import { useAppContext } from '@/context/AppContext';
import {
  KPICard, SectionTitle, EmptyState, ScoreBadge, getScoreColor,
} from '@/components/ui/dashboard-primitives';
import { computeWeeklyDigest } from '@/lib/weekly';
import { formatDuration, weekLabel } from '@/lib/periods';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import {
  ArrowDownRight, ArrowUpRight, Calendar, ChevronLeft, ChevronRight, Sparkles, Repeat,
} from 'lucide-react';

const tooltipStyle = {
  background: 'hsl(210,20%,20%)', border: '1px solid hsl(210,15%,30%)',
  borderRadius: '8px', fontSize: '12px', color: 'hsl(0,0%,95%)', padding: '8px 12px',
};
const tickStyle = { fontSize: 11, fill: 'hsl(215,12%,50%)' };

/** How many weeks of history to plot behind the selected week. */
const CHART_WEEKS = 12;

function DeltaChip({ value, invert = false, suffix = '%' }: { value: number; invert?: boolean; suffix?: string }) {
  if (value === 0) {
    return <span className="font-mono text-[11px] text-muted-foreground">no change</span>;
  }
  const isGood = invert ? value < 0 : value > 0;
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 font-mono text-[11px] ${isGood ? 'text-score-excellent' : 'text-score-critical'}`}>
      <Icon className="w-3 h-3" />
      {value > 0 ? '+' : ''}{value}{suffix}
    </span>
  );
}

function ProblemRow({
  title, category, count, weeksActive, rcaCoverage, rootCause,
}: {
  title: string; category: string; count: number;
  weeksActive?: number; rcaCoverage: number; rootCause?: string;
}) {
  return (
    <div className="py-2.5 border-t border-card-foreground/10 first:border-t-0">
      <div className="flex items-start gap-3">
        <div className="font-mono text-[13px] font-bold text-card-foreground w-8 shrink-0 text-right">{count}×</div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-card-foreground leading-snug">{title}</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-card-foreground/40">{category}</span>
            {weeksActive !== undefined && weeksActive > 1 && (
              <span className="font-mono text-[10px] text-card-foreground/40">{weeksActive} weeks active</span>
            )}
            <span className={`font-mono text-[10px] ${rcaCoverage >= 50 ? 'text-score-good' : 'text-score-critical'}`}>
              {rcaCoverage}% root cause documented
            </span>
          </div>
          {rootCause && (
            <div className="mt-1.5 text-[12px] text-card-foreground/60 leading-snug border-l-2 border-card-foreground/15 pl-2.5">
              {rootCause}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WeeklyPage() {
  const {
    incidents, scores, weeklyTrends,
    availableWeeks: weeks, selectedWeek, setSelectedWeek,
  } = useAppContext();

  const digest = useMemo(
    () => (selectedWeek ? computeWeeklyDigest(incidents, scores, selectedWeek) : null),
    [incidents, scores, selectedWeek],
  );

  const chartData = useMemo(() => {
    const index = weeklyTrends.findIndex(t => t.key === selectedWeek);
    const end = index >= 0 ? index + 1 : weeklyTrends.length;
    return weeklyTrends.slice(Math.max(0, end - CHART_WEEKS), end);
  }, [weeklyTrends, selectedWeek]);

  if (weeks.length === 0) {
    return <EmptyState message="No incidents carry an Opened date, so weekly grouping is unavailable." />;
  }

  const position = weeks.indexOf(selectedWeek);

  const weekPicker = (
    <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-muted-foreground" />
        <span className="font-mono text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground">
          Week of
        </span>
        <select
          value={selectedWeek}
          onChange={e => setSelectedWeek(e.target.value)}
          className="bg-secondary border border-border rounded-md px-3 py-1.5 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {[...weeks].reverse().map(w => (
            <option key={w} value={w}>{weekLabel(w)}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={() => position > 0 && setSelectedWeek(weeks[position - 1])}
          disabled={position <= 0}
          className="flex items-center gap-1 font-mono text-[11px] px-2.5 py-1.5 rounded-md border border-border bg-secondary text-secondary-foreground disabled:opacity-40 hover:border-primary/50 transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Previous
        </button>
        <button
          onClick={() => position < weeks.length - 1 && setSelectedWeek(weeks[position + 1])}
          disabled={position >= weeks.length - 1}
          className="flex items-center gap-1 font-mono text-[11px] px-2.5 py-1.5 rounded-md border border-border bg-secondary text-secondary-foreground disabled:opacity-40 hover:border-primary/50 transition-colors"
        >
          Next <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  if (!digest) {
    return (
      <div className="animate-fade-in">
        {weekPicker}
        <EmptyState message="No incidents were opened in this week." />
      </div>
    );
  }

  const { current, previous } = digest;
  const scoreDelta = previous ? Math.round((current.avgScore - previous.avgScore) * 10) / 10 : 0;
  const slaDelta = previous && previous.slaBreachPct !== null && current.slaBreachPct !== null
    ? current.slaBreachPct - previous.slaBreachPct
    : 0;

  return (
    <div className="animate-fade-in">
      {weekPicker}

      <SectionTitle>Week in Review — {digest.rangeLabel}</SectionTitle>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 mb-6">
        <KPICard
          label="Incidents"
          value={current.count}
          sub={digest.baselineCount > 0 ? `${digest.baselineCount} avg over prior weeks` : 'no prior weeks'}
        />
        <KPICard
          label="vs Baseline"
          value={`${digest.volumeDeltaPct > 0 ? '+' : ''}${digest.volumeDeltaPct}%`}
          colorClass={digest.volumeDeltaPct > 20 ? 'text-score-critical' : digest.volumeDeltaPct < -20 ? 'text-score-excellent' : undefined}
          sub="volume change"
        />
        <KPICard
          label="Avg Quality"
          value={current.avgScore}
          colorClass={getScoreColor(current.avgScore)}
          sub={previous ? `${scoreDelta > 0 ? '+' : ''}${scoreDelta} vs last week` : 'no prior week'}
        />
        <KPICard
          label="Median Time to Resolve"
          value={formatDuration(current.medianResolutionHours)}
          sub={`${current.openCount} still open`}
        />
        <KPICard
          label="SLA Breached"
          value={current.slaBreachPct === null ? '—' : `${current.slaBreachPct}%`}
          colorClass={current.slaBreachPct !== null && current.slaBreachPct > 10 ? 'text-score-critical' : 'text-score-excellent'}
          sub={previous && slaDelta !== 0 ? `${slaDelta > 0 ? '+' : ''}${slaDelta}pp vs last week` : 'of closed incidents'}
        />
        <KPICard
          label="Root Cause Logged"
          value={`${current.rcaCoveragePct}%`}
          colorClass={current.rcaCoveragePct >= 50 ? 'text-score-good' : 'text-score-critical'}
          sub="of incidents this week"
        />
      </div>

      {digest.categoryMovements.length > 0 && (
        <>
          <SectionTitle>What Moved This Week</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            {digest.categoryMovements.map(m => (
              <div key={m.name} className="v1-card p-4">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="text-[13px] text-card-foreground font-medium leading-snug">{m.name}</div>
                  <DeltaChip value={m.deltaPct} invert />
                </div>
                <div className="font-mono text-[24px] font-bold text-card-foreground leading-none">{m.count}</div>
                <div className="text-[11px] text-card-foreground/50 mt-1.5">
                  vs {m.baseline} typical per week
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <SectionTitle>Volume & Quality Trend</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="v1-card p-5">
          <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-4">
            Incidents per Week
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(210,15%,85%)" />
              <XAxis dataKey="label" tick={tickStyle} />
              <YAxis tick={tickStyle} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" name="Incidents" fill="hsl(209,96%,35%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="v1-card p-5">
          <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-4">
            Quality & Root Cause Coverage
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(210,15%,85%)" />
              <XAxis dataKey="label" tick={tickStyle} />
              <YAxis domain={[0, 100]} tick={tickStyle} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="avgScore" name="Avg Score" stroke="hsl(209,96%,35%)" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="rcaCoveragePct" name="Root Cause %" stroke="hsl(270,40%,55%)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div>
          <SectionTitle>New This Week</SectionTitle>
          <div className="v1-card p-5">
            {digest.newProblems.length === 0 ? (
              <div className="text-[13px] text-card-foreground/50 py-4 text-center">
                No new recurring problems — everything this week was already known.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2 text-[11px] text-card-foreground/50">
                  <Sparkles className="w-3.5 h-3.5" />
                  Problems that did not appear in the previous weeks
                </div>
                {digest.newProblems.map(p => (
                  <ProblemRow
                    key={p.id}
                    title={p.title}
                    category={p.category}
                    count={p.count}
                    rcaCoverage={p.rcaCoverage}
                    rootCause={p.rootCauses[0]?.text}
                  />
                ))}
              </>
            )}
          </div>
        </div>

        <div>
          <SectionTitle>Recurring This Week</SectionTitle>
          <div className="v1-card p-5">
            {digest.recurringProblems.length === 0 ? (
              <div className="text-[13px] text-card-foreground/50 py-4 text-center">
                Nothing this week repeats a problem from the previous weeks.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2 text-[11px] text-card-foreground/50">
                  <Repeat className="w-3.5 h-3.5" />
                  Already seen in the preceding weeks
                </div>
                {digest.recurringProblems.map(p => (
                  <ProblemRow
                    key={p.id}
                    title={p.title}
                    category={p.category}
                    count={p.count}
                    weeksActive={p.weeksActive}
                    rcaCoverage={p.rcaCoverage}
                    rootCause={p.rootCauses[0]?.text}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {digest.actions.length > 0 && (
        <>
          <SectionTitle>Recommended Actions</SectionTitle>
          <div className="v1-card p-5 mb-6">
            {digest.actions.map((a, i) => (
              <div key={`${a.cluster.id}-${i}`} className="flex items-start gap-3 py-2.5 border-t border-card-foreground/10 first:border-t-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-primary">{a.title}</span>
                    <ScoreBadge label={a.cluster.avgScore >= 80 ? 'Excellent' : a.cluster.avgScore >= 55 ? 'Good' : a.cluster.avgScore >= 30 ? 'Poor' : 'Critical'} score={a.cluster.avgScore} />
                  </div>
                  <div className="text-[13px] text-card-foreground leading-snug">{a.cluster.title}</div>
                  <div className="text-[12px] text-card-foreground/55 mt-0.5 leading-snug">{a.reason}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
