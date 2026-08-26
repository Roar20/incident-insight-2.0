import { useAppContext } from '@/context/AppContext';
import { KPICard, SectionTitle, DimensionBar, EmptyState, getScoreColor, getScoreBarColor, ExecutiveInsightBanner } from '@/components/ui/dashboard-primitives';
import { computeStateDist } from '@/lib/analytics';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import MonthFilter from '@/components/MonthFilter';

const LABEL_COLORS = {
  Excellent: 'hsl(145,70%,38%)',
  Good: 'hsl(43,90%,48%)',
  Poor: 'hsl(14,90%,55%)',
  Critical: 'hsl(0,80%,55%)',
};

function getStateColor(state: string): string {
  const s = state.toLowerCase();
  if (s.includes('closed')) return 'hsl(145, 70%, 38%)';
  if (s.includes('resolved')) return 'hsl(145, 60%, 34%)';
  if (s.includes('progress')) return 'hsl(43, 90%, 48%)';
  if (s.includes('pending')) return 'hsl(28, 80%, 52%)';
  if (s.includes('new')) return 'hsl(209, 96%, 40%)';
  if (s.includes('assigned')) return 'hsl(209, 80%, 55%)';
  return 'hsl(210, 15%, 55%)';
}

const tooltipStyle = { background: 'hsl(210,20%,20%)', border: '1px solid hsl(210,15%,30%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(0,0%,95%)', padding: '8px 12px' };
const tickStyle = { fontSize: 11, fill: 'hsl(215,12%,50%)' };

export default function OverviewPage() {
  const { filteredOverview: overview, filteredDimStats: dimStats, filteredFeedbackItems: feedbackItems, filteredIncidents: incidents, filteredScores: scores, filteredGroupStats: groupStats } = useAppContext();
  if (!overview) return null;

  if (overview.total === 0) {
    return (
      <div className="animate-fade-in">
        <MonthFilter />
        <EmptyState message="No incidents match the selected months." />
      </div>
    );
  }

  const noRootCausePct = Math.round(overview.noRootCause / overview.total * 100);
  const poorPct = Math.round((overview.poor + overview.critical) / overview.total * 100);
  const highNoisePct = Math.round(overview.highNoise / overview.total * 100);

  const insights: { type: 'risk' | 'finding' | 'action'; text: string; metric?: string }[] = [];
  if (noRootCausePct > 30) insights.push({ type: 'risk', text: `${noRootCausePct}% of incidents have no root cause documented`, metric: `${overview.noRootCause} of ${overview.total}` });
  if (poorPct > 20) insights.push({ type: 'finding', text: `${poorPct}% of incidents scored Poor or Critical`, metric: `${overview.poor + overview.critical} incidents` });
  if (highNoisePct > 15) insights.push({ type: 'finding', text: `${highNoisePct}% of incidents contain excessive noise`, metric: `${overview.highNoise} incidents` });

  const worstDim = [...dimStats].sort((a, b) => a.avg - b.avg)[0];
  if (worstDim) insights.push({ type: 'action', text: `Focus coaching on "${worstDim.label}" — lowest at ${worstDim.avg}/100` });
  if (overview.avgScore < 60) insights.push({ type: 'risk', text: `Average score ${overview.avgScore}/100 — below threshold`, metric: 'Target: 70+' });
  else if (overview.avgScore >= 75) insights.push({ type: 'action', text: `Score of ${overview.avgScore} is strong — maintain practices` });
  if (insights.length < 3) insights.push({ type: 'action', text: 'Review top feedback issues and address documentation gaps' });

  const qualityDist = [
    { name: 'Excellent', value: overview.excellent, color: LABEL_COLORS.Excellent },
    { name: 'Good', value: overview.good, color: LABEL_COLORS.Good },
    { name: 'Poor', value: overview.poor, color: LABEL_COLORS.Poor },
    { name: 'Critical', value: overview.critical, color: LABEL_COLORS.Critical },
  ];

  const stateDist = computeStateDist(incidents);
  const groupChart = groupStats.slice(0, 15).map(g => ({
    name: g.name.length > 30 ? g.name.substring(0, 30) + '…' : g.name,
    score: g.avgScore,
  }));

  return (
    <div className="animate-fade-in">
      <MonthFilter />
      <ExecutiveInsightBanner insights={insights.slice(0, 6)} />

      <SectionTitle>Key Metrics</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2.5 mb-6">
        <KPICard label="Total Incidents" value={overview.total} />
        <KPICard label="Average Score" value={overview.avgScore} colorClass={getScoreColor(overview.avgScore)} />
        <KPICard label="Excellent" value={overview.excellent} colorClass="text-score-excellent" sub={`${Math.round(overview.excellent / overview.total * 100)}%`} />
        <KPICard label="Good" value={overview.good} colorClass="text-score-good" sub={`${Math.round(overview.good / overview.total * 100)}%`} />
        <KPICard label="Poor" value={overview.poor} colorClass="text-score-poor" sub={`${Math.round(overview.poor / overview.total * 100)}%`} />
        <KPICard label="Critical" value={overview.critical} colorClass="text-score-critical" sub={`${Math.round(overview.critical / overview.total * 100)}%`} />
        <KPICard label="No Root Cause" value={overview.noRootCause} sub={`${noRootCausePct}%`} />
        <KPICard label="High Noise" value={overview.highNoise} sub={`${highNoisePct}%`} />
      </div>

      <SectionTitle>Top Documentation Issues</SectionTitle>
      <div className="v1-card p-5 mb-6">
        {feedbackItems.slice(0, 8).map((f, i) => (
          <div key={i} className="flex items-center gap-4 py-2">
            <div className="font-mono text-[12px] text-card-foreground/50 w-5 text-right">{i + 1}</div>
            <div className="flex-1 text-[13px] text-card-foreground leading-snug">{f.text}</div>
            <div className="w-[140px] h-2 bg-card-foreground/10 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${f.pct}%`,
                  backgroundColor: f.pct > 50 ? 'hsl(0,80%,55%)' : f.pct > 25 ? 'hsl(14,90%,55%)' : 'hsl(209,96%,40%)',
                }}
              />
            </div>
            <div className="font-mono text-[12px] text-card-foreground/50 w-20 text-right">{f.count} ({f.pct}%)</div>
          </div>
        ))}
      </div>

      <SectionTitle>Quality Distribution</SectionTitle>
      <div className="v1-card p-5 mb-6">
        <div className="flex items-center gap-4 mb-4">
          {qualityDist.map(d => (
            <div key={d.name} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: d.color }} />
              <span className="text-[12px] text-card-foreground/60">{d.name}</span>
              <span className="font-mono text-[14px] font-bold text-card-foreground">{d.value}</span>
              <span className="text-[11px] text-card-foreground/40">({Math.round(d.value / overview.total * 100)}%)</span>
            </div>
          ))}
        </div>
        <div className="w-full h-6 rounded-lg overflow-hidden flex">
          {qualityDist.map(d => {
            const pct = overview.total > 0 ? (d.value / overview.total) * 100 : 0;
            return pct > 0 ? (
              <div key={d.name} className="h-full flex items-center justify-center" style={{ width: `${pct}%`, backgroundColor: d.color }}>
                {pct > 8 && <span className="font-mono text-[11px] font-bold text-white drop-shadow-sm">{Math.round(pct)}%</span>}
              </div>
            ) : null;
          })}
        </div>
      </div>

      <SectionTitle>Dimension Scores</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {dimStats.map(d => (
          <div key={d.name} className="v1-card p-4">
            <div className="flex justify-between items-start mb-2">
              <div className="text-[12px] text-card-foreground/70 font-medium">{d.label}</div>
              <div className="font-mono text-[10px] text-card-foreground/40">{d.weight}%</div>
            </div>
            <div className={`font-mono text-[32px] font-bold mb-2 ${getScoreColor(d.avg)}`}>{d.avg}</div>
            <div className="text-[11px] text-card-foreground/50 mb-2">
              {d.scored0Pct}% scored 0 · {d.scored100Pct}% scored 100
            </div>
            <DimensionBar buckets={d.buckets} total={d.buckets.reduce((a, b) => a + b, 0)} />
          </div>
        ))}
      </div>

      <SectionTitle>Group Performance & Incident State</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="v1-card p-5">
          <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-4">Average Score by Group</div>
          <ResponsiveContainer width="100%" height={Math.max(220, groupChart.length * 26)}>
            <BarChart data={groupChart} layout="vertical" margin={{ left: 140, right: 20, top: 4, bottom: 4 }}>
              <XAxis type="number" domain={[0, 100]} tick={tickStyle} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'hsl(215,12%,50%)' }} width={130} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                {groupChart.map((g, i) => (
                  <Cell key={i} fill={getScoreBarColor(g.score)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="v1-card p-5">
          <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-4">Incidents by State</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stateDist} margin={{ left: 8, right: 16, top: 20, bottom: 4 }}>
              <XAxis dataKey="state" tick={{ fontSize: 12, fill: 'hsl(215,12%,50%)' }} />
              <YAxis tick={tickStyle} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {stateDist.map((d, i) => (
                  <Cell key={i} fill={getStateColor(d.state)} />
                ))}
                <LabelList dataKey="count" position="top" style={{ fontSize: 11, fontFamily: 'Space Mono', fill: 'hsl(210,40%,15%)' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
