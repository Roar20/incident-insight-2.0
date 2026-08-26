import { useAppContext } from '@/context/AppContext';
import { KPICard, SectionTitle, DimensionBar, getScoreColor, getScoreBarColor } from '@/components/ui/dashboard-primitives';
import {
  computeNoteLengthBuckets, computeShortDescBuckets, computeNoiseBuckets,
  computeAvgNoteLengthByLabel,
} from '@/lib/analytics';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import MonthFilter from '@/components/MonthFilter';

const NOISE_COLORS = ['hsl(145,70%,38%)', 'hsl(43,90%,48%)', 'hsl(14,90%,55%)', 'hsl(0,80%,55%)'];
const tooltipStyle = { background: 'hsl(210,20%,20%)', border: '1px solid hsl(210,15%,30%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(0,0%,95%)', padding: '8px 12px' };
const tickStyle = { fontSize: 11, fill: 'hsl(215,12%,50%)' };

export default function TextQualityPage() {
  const { filteredOverview: overview, filteredScores: scores, filteredIncidents: incidents, filteredDimStats: dimStats, filteredGroupStats: groupStats } = useAppContext();
  if (!overview) return null;

  const noteBuckets = computeNoteLengthBuckets(scores);
  const sdBuckets = computeShortDescBuckets(incidents);
  const noiseBuckets = computeNoiseBuckets(scores);
  const avgByLabel = computeAvgNoteLengthByLabel(scores);
  const rootCauseByGroup = groupStats
    .filter(g => g.count >= 3)
    .sort((a, b) => b.avgRootCause - a.avgRootCause)
    .slice(0, 15)
    .map(g => ({
      name: g.name.length > 30 ? g.name.substring(0, 30) + '…' : g.name,
      score: g.avgRootCause,
    }));

  return (
    <div className="animate-fade-in">
      <MonthFilter />
      <SectionTitle>Work Note Length Analysis</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-6">
        <KPICard label="Avg Characters" value={overview.avgNoteLength} />
        <KPICard label="Median Characters" value={overview.medianNoteLength} />
        <KPICard label="Empty Notes" value={overview.emptyNotes} sub={`${Math.round(overview.emptyNotes / overview.total * 100)}% of total`} />
        <KPICard label="Avg Note Count" value={overview.avgNoteCount} sub="notes per incident" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="v1-card p-5">
          <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-4">Note Length Distribution</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={noteBuckets}>
              <XAxis dataKey="label" tick={tickStyle} />
              <YAxis tick={tickStyle} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill="hsl(209,96%,35%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="v1-card p-5">
          <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-4">Short Description Quality</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={sdBuckets}>
              <XAxis dataKey="label" tick={tickStyle} />
              <YAxis tick={tickStyle} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill="hsl(209,96%,35%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <SectionTitle>Noise & Boilerplate Analysis</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="v1-card p-5">
          <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-4">Noise Level Distribution</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={noiseBuckets}>
              <XAxis dataKey="label" tick={tickStyle} />
              <YAxis tick={tickStyle} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {noiseBuckets.map((_, i) => <Cell key={i} fill={NOISE_COLORS[i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="v1-card p-5">
          <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-card-foreground/50 mb-4">Avg Note Length by Quality</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={avgByLabel}>
              <XAxis dataKey="label" tick={tickStyle} />
              <YAxis tick={tickStyle} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                {avgByLabel.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <SectionTitle>Dimension Deep-Dive</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {dimStats.map(d => (
          <div key={d.name} className="v1-card p-4">
            <div className="text-[12px] text-card-foreground/70 font-medium mb-1">{d.label}</div>
            <div className={`font-mono text-[32px] font-bold mb-2 ${getScoreColor(d.avg)}`}>{d.avg}</div>
            <DimensionBar buckets={d.buckets} total={d.buckets.reduce((a, b) => a + b, 0)} />
            <div className="text-[11px] text-card-foreground/50 mt-2">
              Scored 0: {d.scored0Pct}% · Scored 100: {d.scored100Pct}%
            </div>
          </div>
        ))}
      </div>

      <SectionTitle>Root Cause Documentation by Group</SectionTitle>
      <div className="v1-card p-5">
        <ResponsiveContainer width="100%" height={Math.max(220, rootCauseByGroup.length * 26)}>
          <BarChart data={rootCauseByGroup} layout="vertical" margin={{ left: 140, right: 20, top: 4, bottom: 4 }}>
            <XAxis type="number" domain={[0, 100]} tick={tickStyle} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'hsl(215,12%,50%)' }} width={130} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="score" radius={[0, 4, 4, 0]}>
              {rootCauseByGroup.map((g, i) => (
                <Cell key={i} fill={getScoreBarColor(g.score)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
