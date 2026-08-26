import { cn } from '@/lib/utils';
import { AlertTriangle, TrendingUp, TrendingDown, Lightbulb } from 'lucide-react';

interface KPICardProps {
  label: string;
  value: string | number;
  sub?: string;
  colorClass?: string;
}

export function KPICard({ label, value, sub, colorClass }: KPICardProps) {
  return (
    <div className="v1-card p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-card-foreground/50 mb-1.5">{label}</div>
      <div className={cn("font-mono text-[26px] font-bold leading-none", colorClass || "text-card-foreground")}>
        {value}
      </div>
      {sub && <div className="text-[12px] text-card-foreground/50 mt-1.5">{sub}</div>}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4 mt-8 first:mt-0">
      <span className="font-mono text-[11px] font-bold tracking-[0.14em] uppercase text-muted-foreground whitespace-nowrap">
        {children}
      </span>
      <span className="flex-1 h-px bg-border" />
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="v1-card p-12 text-center text-[13px] text-card-foreground/50">
      {message}
    </div>
  );
}

export function ScoreBadge({ label, score }: { label: string; score: number }) {
  const colorMap: Record<string, string> = {
    Excellent: 'bg-score-excellent/15 text-score-excellent',
    Good: 'bg-score-good/15 text-score-good',
    Poor: 'bg-score-poor/15 text-score-poor',
    Critical: 'bg-score-critical/15 text-score-critical',
  };
  return (
    <span className={cn("font-mono text-[11px] font-bold px-2.5 py-1 rounded-md", colorMap[label] || 'text-muted-foreground')}>
      {label} · {score}
    </span>
  );
}

export function MiniBar({ value, max = 100, colorClass }: { value: number; max?: number; colorClass?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="w-[60px] h-1.5 bg-card-foreground/10 rounded-full overflow-hidden">
      <div className={cn("h-full rounded-full", colorClass || "bg-primary")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function DimensionBar({ buckets, total }: { buckets: [number, number, number, number]; total: number }) {
  const colors = ['bg-score-critical', 'bg-score-poor', 'bg-score-good', 'bg-score-excellent'];
  return (
    <div className="w-full h-2.5 rounded-full overflow-hidden flex bg-card-foreground/10">
      {buckets.map((b, i) => {
        const pct = total > 0 ? (b / total) * 100 : 0;
        return pct > 0 ? (
          <div key={i} className={cn("h-full", colors[i])} style={{ width: `${pct}%` }} />
        ) : null;
      })}
    </div>
  );
}

export function getScoreColor(score: number): string {
  if (score >= 80) return 'text-score-excellent';
  if (score >= 55) return 'text-score-good';
  if (score >= 30) return 'text-score-poor';
  return 'text-score-critical';
}

export function getScoreBarColor(score: number): string {
  if (score >= 80) return 'hsl(145,70%,38%)';
  if (score >= 55) return 'hsl(43,90%,48%)';
  if (score >= 30) return 'hsl(14,90%,55%)';
  return 'hsl(0,80%,55%)';
}

export function getNoiseColor(noise: number): string {
  if (noise < 0.2) return 'bg-score-excellent';
  if (noise < 0.5) return 'bg-score-good';
  if (noise < 0.8) return 'bg-score-poor';
  return 'bg-score-critical';
}

interface InsightItem {
  type: 'risk' | 'finding' | 'action';
  text: string;
  metric?: string;
}

export function ExecutiveInsightBanner({ insights }: { insights: InsightItem[] }) {
  const iconMap = {
    risk: <AlertTriangle className="w-4 h-4 text-score-critical shrink-0" />,
    finding: <TrendingDown className="w-4 h-4 text-score-poor shrink-0" />,
    action: <Lightbulb className="w-4 h-4 text-score-excellent shrink-0" />,
  };
  const labelMap = {
    risk: 'Risk',
    finding: 'Finding',
    action: 'Recommended',
  };

  return (
    <div className="v1-card p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-5 h-5 text-card-foreground/70" />
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-wider text-card-foreground">
          Executive Summary
        </h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {insights.map((item, i) => (
          <div key={i} className="flex items-start gap-3 bg-card-foreground/5 rounded-lg p-3.5 border border-card-foreground/10">
            {iconMap[item.type]}
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-card-foreground/50 mb-1">
                {labelMap[item.type]}
              </div>
              <div className="text-[13px] text-card-foreground leading-snug">{item.text}</div>
              {item.metric && (
                <div className="font-mono text-[18px] font-bold text-card-foreground mt-1">{item.metric}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
