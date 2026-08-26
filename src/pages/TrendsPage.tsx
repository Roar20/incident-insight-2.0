import { useAppContext } from '@/context/AppContext';
import { SectionTitle, KPICard, getScoreColor } from '@/components/ui/dashboard-primitives';
import { computeTrends } from '@/lib/analytics';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, Legend, ReferenceLine, CartesianGrid,
} from 'recharts';

const DIM_COLORS: Record<string, string> = {
  avgDescQuality: 'hsl(209, 96%, 35%)',
  avgRootCause: 'hsl(270, 40%, 55%)',
  avgSteps: 'hsl(43, 90%, 48%)',
  avgSpelling: 'hsl(145, 70%, 38%)',
  avgProfessionalism: 'hsl(14, 90%, 55%)',
};

const DIM_LABELS: Record<string, string> = {
  avgDescQuality: 'Description',
  avgRootCause: 'Root Cause',
  avgSteps: 'Steps',
  avgSpelling: 'Spelling',
  avgProfessionalism: 'Professionalism',
};

const LABEL_COLORS = {
  excellent: 'hsl(145,70%,38%)',
  good: 'hsl(43,90%,48%)',
  poor: 'hsl(14,90%,55%)',
  critical: 'hsl(0,80%,55%)',
};

const tooltipStyle = { background: 'hsl(210,20%,20%)', border: '1px solid hsl(210,15%,30%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(0,0%,95%)', padding: '8px 12px' };
const tickStyle = { fontSize: 11, fill: 'hsl(215,12%,50%)' };

export default function TrendsPage() {
  const { incidents, scores } = useAppContext();
  const trends = computeTrends(incidents, scores);

  if (trends.length < 2) {
    return (
      <div className="text-muted-foreground text-center py-20">
        Need at least 2 months of data to show trends.
      </div>
    );
  }

  const firstMonth = trends[0];
  const lastMonth = trends[trends.length - 1];
  const scoreDelta = Math.round((lastMonth.avgScore - firstMonth.avgScore) * 10) / 10;
  const rcDelta = Math.round((lastMonth.avgRootCause - firstMonth.avgRootCause) * 10) / 10;
  const noiseDelta = lastMonth.highNoisePct - firstMonth.highNoisePct;

  const deltaLabel = (v: number, invert = false) => {
    const positive = invert ? v < 0 : v > 0;
    const sign = v > 0 ? '+' : '';
    return { text: `${sign}${v}`, colorClass: positive ? 'text-score-excellent' : v === 0 ? 'text-muted-foreground' : 'text-score-critical' };
  };

  const scoreDeltaFmt = deltaLabel(scoreDelta);
  const rcDeltaFmt = deltaLabel(rcDelta);
  const noiseDeltaFmt = deltaLabel(noiseDelta, true);

  return (
    <div className="space-y-2 animate-fade-in">
      <SectionTitle>Trend Summary — {firstMonth.label} → {lastMonth.label}</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Latest Avg Score" value={lastMonth.avgScore} sub={`${scoreDeltaFmt.text} vs first month`} colorClass={getScoreColor(lastMonth.avgScore)} />
        <KPICard label="Total Months" value={trends.length} sub={`${trends.reduce((a, t) => a + t.count, 0)} incidents`} />
        <KPICard label="Root Cause Δ" value={rcDeltaFmt.text} sub="First → Last month" colorClass={rcDeltaFmt.colorClass} />
        <KPICard label="Noise Δ" value={`${noiseDeltaFmt.text}%`} sub="First → Last month" colorClass={noiseDeltaFmt.colorClass} />
      </div>

      <SectionTitle>Average Score Over Time</SectionTitle>
      <div className="v1-card p-5 mb-6">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={trends}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(210,15%,85%)" />
            <XAxis dataKey="label" tick={tickStyle} />
            <YAxis domain={[0, 100]} tick={tickStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            <ReferenceLine y={55} stroke="hsl(43,90%,48%)" strokeDasharray="4 4" label={{ value: 'Good', fill: 'hsl(43,90%,48%)', fontSize: 10 }} />
            <ReferenceLine y={80} stroke="hsl(145,70%,38%)" strokeDasharray="4 4" label={{ value: 'Excellent', fill: 'hsl(145,70%,38%)', fontSize: 10 }} />
            <Line type="monotone" dataKey="avgScore" stroke="hsl(209,96%,35%)" strokeWidth={2.5} dot={{ r: 4 }} name="Avg Score" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <SectionTitle>Dimension Scores Over Time</SectionTitle>
      <div className="v1-card p-5 mb-6">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={trends}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(210,15%,85%)" />
            <XAxis dataKey="label" tick={tickStyle} />
            <YAxis domain={[0, 100]} tick={tickStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {Object.keys(DIM_COLORS).map(key => (
              <Line key={key} type="monotone" dataKey={key} stroke={DIM_COLORS[key]} strokeWidth={2} dot={{ r: 3 }} name={DIM_LABELS[key]} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <SectionTitle>Quality Distribution Over Time</SectionTitle>
      <div className="v1-card p-5 mb-6">
        <div className="flex gap-4 mb-3 justify-center">
          {(['Excellent', 'Good', 'Poor', 'Critical'] as const).map((l, i) => (
            <div key={l} className="flex items-center gap-1.5 text-[11px] text-card-foreground/60">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: Object.values(LABEL_COLORS)[i] }} />
              {l}
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={trends}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(210,15%,85%)" />
            <XAxis dataKey="label" tick={tickStyle} />
            <YAxis tick={tickStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="excellent" stackId="a" fill={LABEL_COLORS.excellent} name="Excellent" />
            <Bar dataKey="good" stackId="a" fill={LABEL_COLORS.good} name="Good" />
            <Bar dataKey="poor" stackId="a" fill={LABEL_COLORS.poor} name="Poor" />
            <Bar dataKey="critical" stackId="a" fill={LABEL_COLORS.critical} name="Critical" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <SectionTitle>Risk Indicators Over Time</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="v1-card p-5">
          <p className="font-mono text-[11px] text-card-foreground/50 mb-3 uppercase tracking-wider">No Root Cause %</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={trends}>
              <XAxis dataKey="label" tick={tickStyle} />
              <YAxis tick={tickStyle} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}%`, 'No Root Cause']} />
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(210,15%,85%)" />
              <Bar dataKey="noRootCausePct" name="No Root Cause %">
                {trends.map((t, i) => (
                  <Cell key={i} fill={t.noRootCausePct > 50 ? 'hsl(0,80%,55%)' : t.noRootCausePct > 30 ? 'hsl(14,90%,55%)' : 'hsl(145,70%,38%)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="v1-card p-5">
          <p className="font-mono text-[11px] text-card-foreground/50 mb-3 uppercase tracking-wider">High Noise %</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={trends}>
              <XAxis dataKey="label" tick={tickStyle} />
              <YAxis tick={tickStyle} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}%`, 'High Noise']} />
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(210,15%,85%)" />
              <Bar dataKey="highNoisePct" name="High Noise %">
                {trends.map((t, i) => (
                  <Cell key={i} fill={t.highNoisePct > 30 ? 'hsl(0,80%,55%)' : t.highNoisePct > 15 ? 'hsl(14,90%,55%)' : 'hsl(145,70%,38%)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <SectionTitle>Monthly Detail</SectionTitle>
      <div className="v1-card overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-card-foreground/10 bg-card-foreground/5">
                <th className="text-left px-4 py-2.5 font-mono font-bold text-card-foreground/50 uppercase tracking-wider">Month</th>
                <th className="text-right px-4 py-2.5 font-mono font-bold text-card-foreground/50 uppercase tracking-wider">Incidents</th>
                <th className="text-right px-4 py-2.5 font-mono font-bold text-card-foreground/50 uppercase tracking-wider">Avg Score</th>
                <th className="text-right px-4 py-2.5 font-mono font-bold text-card-foreground/50 uppercase tracking-wider">Excellent%</th>
                <th className="text-right px-4 py-2.5 font-mono font-bold text-card-foreground/50 uppercase tracking-wider">Poor+Crit%</th>
                <th className="text-right px-4 py-2.5 font-mono font-bold text-card-foreground/50 uppercase tracking-wider">Root Cause</th>
                <th className="text-right px-4 py-2.5 font-mono font-bold text-card-foreground/50 uppercase tracking-wider">No RC%</th>
                <th className="text-right px-4 py-2.5 font-mono font-bold text-card-foreground/50 uppercase tracking-wider">High Noise%</th>
              </tr>
            </thead>
            <tbody>
              {trends.map((t, i) => {
                const prev = trends[i - 1];
                const delta = prev ? Math.round((t.avgScore - prev.avgScore) * 10) / 10 : null;
                return (
                  <tr key={t.month} className="border-b border-card-foreground/10 last:border-b-0 hover:bg-card-foreground/5 transition-colors">
                    <td className="px-4 py-2.5 font-mono font-medium text-card-foreground">{t.label}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-card-foreground/60">{t.count}</td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      <span className={getScoreColor(t.avgScore)}>{t.avgScore}</span>
                      {delta !== null && (
                        <span className={`ml-2 text-[10px] ${delta > 0 ? 'text-score-excellent' : delta < 0 ? 'text-score-critical' : 'text-muted-foreground'}`}>
                          {delta > 0 ? `▲${delta}` : delta < 0 ? `▼${Math.abs(delta)}` : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-card-foreground/60">{t.excellentPct}%</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${t.poorOrCriticalPct > 40 ? 'text-score-critical' : t.poorOrCriticalPct > 20 ? 'text-score-poor' : 'text-card-foreground/60'}`}>
                      {t.poorOrCriticalPct}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-card-foreground/60">{t.avgRootCause}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${t.noRootCausePct > 50 ? 'text-score-critical' : t.noRootCausePct > 30 ? 'text-score-poor' : 'text-card-foreground/60'}`}>
                      {t.noRootCausePct}%
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono ${t.highNoisePct > 30 ? 'text-score-critical' : t.highNoisePct > 15 ? 'text-score-poor' : 'text-card-foreground/60'}`}>
                      {t.highNoisePct}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
