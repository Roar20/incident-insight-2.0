import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Info } from 'lucide-react';
import { useAppContext } from '@/context/AppContext';
import GlobalFilters from '@/components/GlobalFilters';
import { EmptyState } from '@/components/ui/dashboard-primitives';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NotAvailable, Section } from '@/components/origen/shared';
import {
  EXECUTIVE_CAVEATS, EXECUTIVE_SUMMARY_DISPLAY, INTERPRETATION_NOTES, OPERATIONAL_METRICS, discoveryPromptsEnabled,
} from '@/config/executiveSummary';
import { monthLabel } from '@/lib/analytics';
import { canonicalSourceHeader } from '@/lib/dimensions';
import { formatDuration } from '@/lib/periods';
import { dimensionTable, fraction, type DimensionTable, type OrigenDimension } from '@/lib/serviceDimension';
import {
  dimensionPlural, dimensionSingular, headline, lookDimension, medianResolutionHours, patternBreadth,
  pctText, periodSpan, topShare,
} from '@/lib/executiveSummary';
import { slaSignal } from '@/lib/slaSignal';

const EXECUTIVE_TOOLTIP =
  'A decision view of the incidents visible under the current filters. Directional figures are for discussion, not conclusions; '
  + 'repeat patterns are candidates for review, and Service / Offering show association, not cause.';

// ---------------------------------------------------------------------------
// Small building blocks, in the app's existing visual language
// ---------------------------------------------------------------------------

type Status = 'Validated' | 'Directional' | 'Needs data' | 'Needs definition' | 'Not available';

const STATUS_TONE: Record<Status, string> = {
  Validated: 'bg-score-excellent/15 text-score-excellent',
  Directional: 'bg-score-good/15 text-score-good',
  'Needs data': 'bg-score-poor/15 text-score-poor',
  'Needs definition': 'bg-auto-tag/15 text-auto-tag',
  'Not available': 'bg-card-foreground/10 text-card-foreground/60',
};

/** ScoreBadge treatment for an evidence status. */
function StatusTag({ status, onLight = false }: { status: Status; onLight?: boolean }) {
  const tone = onLight && status === 'Directional' ? 'bg-score-good/20 text-[hsl(43,90%,30%)]' : STATUS_TONE[status];
  return <span className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap normal-case tracking-normal ${tone}`}>{status}</span>;
}

/** KPICard anatomy, with an optional status tag beside the label. */
function SnapshotCard({ label, value, sub, status }: { label: string; value: string; sub: ReactNode; status?: Status }) {
  return (
    <div className="v1-card p-4 min-w-0">
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-card-foreground/50 mb-1.5">
        <span>{label}</span>
        {status && <StatusTag status={status} />}
      </div>
      <div className="font-mono text-[26px] font-bold leading-none text-card-foreground">{value}</div>
      <div className="text-[12px] text-card-foreground/50 mt-1.5">{sub}</div>
    </div>
  );
}

/** The hatched "Others" fill of ServiceRankingChart, as CSS. */
const HATCH = 'repeating-linear-gradient(45deg, hsl(var(--card-foreground) / 0.55) 0 2px, hsl(var(--card-foreground) / 0.12) 2px 6px)';

interface BarItem { key: string; label: string; incidents: number; kind: 'value' | 'others' | 'missing' }

/**
 * "Where is the noise?" bar language, simplified: amber bars on the dark card,
 * mono "share · count" labels, hatched italic "Others", dashed "No …" row.
 * Bars scale to the largest named value.
 */
function BarList({ items, visible, testId }: { items: BarItem[]; visible: number; testId?: string }) {
  const max = Math.max(1, ...items.filter(i => i.kind === 'value').map(i => i.incidents));
  return (
    <div className="flex flex-col gap-1.5 max-w-[860px]" data-testid={testId}>
      {items.map(item => {
        const width = Math.min(100, (item.incidents / max) * 100);
        const fill = item.kind === 'value'
          ? 'bg-sidebar-primary'
          : item.kind === 'others'
            ? 'border border-card-foreground/60'
            : 'border border-dashed border-card-foreground/60';
        return (
          <div key={item.key} data-kind={item.kind} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(72px,150px)_minmax(0,1fr)_96px] items-center gap-x-2.5 gap-y-0.5 text-[11px] hover:bg-card-foreground/5"
            title={`${item.label}: ${item.incidents} ${item.incidents === 1 ? 'incident' : 'incidents'} · ${pctText(fraction(item.incidents, visible))} of visible`}>
            <span className={`truncate col-span-2 sm:col-span-1 sm:text-right ${item.kind === 'value' ? 'text-card-foreground' : 'italic text-card-foreground/75'}`}>{item.label}</span>
            <span className="h-[18px] min-w-0 border-l border-card-foreground/60 flex items-center">
              <span className={`block h-[18px] rounded-r-[3px] ${fill}`} style={{ width: `${Math.max(width, 1.5)}%`, ...(item.kind === 'others' ? { background: HATCH } : {}) }} />
            </span>
            <span className="font-mono text-card-foreground whitespace-nowrap">{pctText(fraction(item.incidents, visible))}<span className="text-card-foreground/60"> · {item.incidents}</span></span>
          </div>
        );
      })}
    </div>
  );
}

const MISSING_LABEL: Record<OrigenDimension, string> = { assignmentGroup: 'No Handling Group', service: 'No Service', serviceOffering: 'No Offering' };

/** Top `k` known values, one labelled "Others" row, and the no-value row when it has incidents. */
function barsFromTable(table: DimensionTable, dimension: OrigenDimension, k: number): BarItem[] {
  const top = table.rows.slice(0, k);
  const rest = table.rows.slice(k);
  const items: BarItem[] = top.map(row => ({ key: `v:${row.value}`, label: row.value as string, incidents: row.incidents, kind: 'value' }));
  if (rest.length) items.push({ key: 'others', label: `Others (${rest.length})`, incidents: rest.reduce((s, r) => s + r.incidents, 0), kind: 'others' });
  if (table.missing && table.missing.incidents > 0) items.push({ key: 'missing', label: MISSING_LABEL[dimension], incidents: table.missing.incidents, kind: 'missing' });
  return items;
}

/** Progressive disclosure: caveats and lineage stay behind this control. */
function Evidence({ items }: { items: ReactNode[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="text-[12px]">
      <CollapsibleTrigger className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground py-2 transition-colors">
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} /> Evidence
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="v1-card list-disc pl-8 pr-4 py-3 space-y-1 text-card-foreground/80 max-w-[860px]">
          {items.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Headline insight → visual → why it matters, in a card; drill-down and Evidence below it. */
function ExecutiveSection({ title, status, children, action, evidence }: {
  title: string; status?: Status; children: ReactNode; action: ReactNode; evidence: ReactNode[];
}) {
  return (
    <section className="mt-8">
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-foreground/75">{title}</h3>
        {status && <StatusTag status={status} onLight />}
      </div>
      <div className="v1-card p-5 min-w-0">{children}</div>
      <div className="flex flex-wrap items-start gap-4 mt-2.5">
        {action}
        <Evidence items={evidence} />
      </div>
    </section>
  );
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-md px-3 py-2 text-[13px] font-medium hover:opacity-90 transition-opacity">
      {label} →
    </button>
  );
}

const Insight = ({ children }: { children: ReactNode }) => <p className="m-0 mb-3.5 text-[15px] font-semibold leading-snug text-card-foreground">{children}</p>;
const Big = ({ children }: { children: ReactNode }) => <span className="font-mono text-[22px] font-bold text-sidebar-primary">{children}</span>;
const SubHeading = ({ children }: { children: ReactNode }) => <h4 className="mt-4 mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-card-foreground/50">{children}</h4>;
const Note = ({ children }: { children: ReactNode }) => <p className="mt-3.5 mb-0 text-[12px] text-card-foreground/75 max-w-[860px]">{children}</p>;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * Every Executive Summary figure, from the incidents visible under the global
 * filters. The main sections and "Evidence behind this summary" both read this
 * one object, so they always reconcile.
 */
function useExecutiveMetrics() {
  const { filteredIncidents: incidents, filteredOverview: overview, filteredProblems: problems, dimensionAvailability, sourceColumns } = useAppContext();
  return useMemo(() => {
    const visible = incidents.length;
    const candidateIds = new Set(problems.map(p => p.id));
    const tables: Record<OrigenDimension, DimensionTable | null> = {
      assignmentGroup: dimensionAvailability.assignmentGroup ? dimensionTable(incidents, 'assignmentGroup', candidateIds) : null,
      service: dimensionAvailability.service ? dimensionTable(incidents, 'service', candidateIds) : null,
      serviceOffering: dimensionAvailability.serviceOffering ? dimensionTable(incidents, 'serviceOffering', candidateIds) : null,
    };
    const lookDim = lookDimension(tables);
    const look = lookDim ? { dimension: lookDim, table: tables[lookDim]!, top: topShare(tables[lookDim]!, EXECUTIVE_SUMMARY_DISPLAY.concentrationTop) } : null;
    const originDim: OrigenDimension | null = tables.service && tables.service.rows.length ? 'service' : tables.serviceOffering && tables.serviceOffering.rows.length ? 'serviceOffering' : null;
    const originTop = originDim ? topShare(tables[originDim]!, EXECUTIVE_SUMMARY_DISPLAY.originTop) : null;
    const largest = problems[0] ?? null;
    const repeatVolume = problems.reduce((sum, p) => sum + p.count, 0);
    const goodOrExcellent = overview && visible ? (overview.excellent + overview.good) / visible : null;
    const withoutDiagnosis = overview && visible ? overview.noRootCause / visible : null;
    return {
      visible, tables, look, originDim, originTop, largest,
      breadth: largest ? patternBreadth(incidents, largest.id) : null,
      largestShare: largest ? fraction(largest.count, visible) : null,
      recurring: fraction(repeatVolume, visible),
      period: periodSpan(incidents),
      sla: slaSignal(incidents, canonicalSourceHeader('Made SLA', sourceColumns) !== null),
      medianHours: medianResolutionHours(incidents),
      goodOrExcellent, withoutDiagnosis,
      documentation: overview && visible ? { goodOrExcellent: overview.excellent + overview.good, withoutDiagnosis: overview.noRootCause } : null,
      singleGroup: tables.assignmentGroup !== null && tables.assignmentGroup.rows.length < 2,
    };
  }, [incidents, problems, overview, dimensionAvailability, sourceColumns]);
}

/** Executive Summary — a decision view over the incidents visible under the global filters. */
export default function ExecutiveSummaryPage() {
  const { filteredProblems: problems, setCurrentPage } = useAppContext();

  const m = useExecutiveMetrics();

  const heading = (
    <div className="flex flex-wrap items-center gap-2 mb-5">
      <h2 className="text-[18px] font-semibold text-foreground">Executive Summary</h2>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label="What Executive Summary means" className="text-muted-foreground hover:text-foreground">
            <Info className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm text-[12px] leading-snug">{EXECUTIVE_TOOLTIP}</TooltipContent>
      </Tooltip>
      <span className="text-[12px] text-muted-foreground">Decision view</span>
    </div>
  );

  if (m.visible === 0) {
    return (
      <div className="animate-fade-in">
        {heading}
        <GlobalFilters />
        <EmptyState message="No results for the current filters." />
      </div>
    );
  }

  const periodText = m.period.first
    ? `${m.period.months} ${m.period.months === 1 ? 'month' : 'months'} · ${monthLabel(m.period.first)}${m.period.last !== m.period.first ? ` – ${monthLabel(m.period.last!)}` : ''}`
    : 'Period not available';
  const lookNoun = m.look ? dimensionPlural(m.look.dimension) : '';
  const perf = m.sla.state === 'available'
    ? { value: `${m.sla.breachPct}%`, sub: <>SLA breached of closed incidents</>, status: undefined }
    : m.sla.state === 'no-signal'
      ? { value: '—', sub: <>SLA flag carries no signal</>, status: 'Needs data' as Status }
      : { value: '—', sub: <>No SLA flag in this file</>, status: 'Not available' as Status };

  const originStatus: Status = m.singleGroup ? 'Directional' : 'Validated';
  const fallbackLine = m.look && m.look.dimension !== 'assignmentGroup'
    ? (m.singleGroup ? `One Handling Group handles every incident in view, so this view uses ${m.look.dimension === 'service' ? 'Service' : 'Service Offering'} instead.`
      : `This file has no Handling Group values, so this view uses ${m.look.dimension === 'service' ? 'Service' : 'Service Offering'} instead.`)
    : null;

  return (
    <div className="animate-fade-in" data-testid="executive-summary">
      {heading}
      <GlobalFilters />

      {/* Executive headline — ExecutiveInsightBanner treatment */}
      <div className="v1-card p-5 mb-6">
        <div className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-card-foreground/55 mb-2.5">
          Operational Executive Summary · {periodText}
        </div>
        <p className="m-0 text-[17px] leading-relaxed font-medium text-card-foreground max-w-[980px]" data-testid="executive-headline">
          {headline({ look: m.look ? { dimension: m.look.dimension, top: m.look.top } : null, goodOrExcellent: m.goodOrExcellent, withoutDiagnosis: m.withoutDiagnosis })}
        </p>
      </div>

      {/* Operational Snapshot */}
      <div className="grid grid-cols-1 min-[440px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5" data-testid="executive-snapshot">
        <SnapshotCard label="Incidents" value={m.visible.toLocaleString('en-US')} sub={periodText} />
        <SnapshotCard label="Documentation / AI readiness" status="Directional" value={pctText(m.goodOrExcellent)}
          sub={<>good or excellent · <b className="text-card-foreground/85">{pctText(m.withoutDiagnosis)}</b> without diagnosis</>} />
        <SnapshotCard label="Concentration" value={m.look ? pctText(m.look.top.share) : '—'} status={m.look ? undefined : 'Not available'}
          sub={m.look ? <>{m.look.dimension === 'assignmentGroup' ? 'handled by' : 'associated with'} {m.look.top.named} of {m.look.top.distinct} {lookNoun}{m.singleGroup && ' (one group handles all)'}</> : 'No Handling Group, Service or Offering values'} />
        <SnapshotCard label="Largest pattern" status="Directional" value={pctText(m.largestShare)}
          sub={m.largest ? 'largest repeat pattern of incidents in view' : 'no repeat pattern in view'} />
        <SnapshotCard label="Service performance" value={perf.value} status={perf.status} sub={perf.sub} />
      </div>
      <Evidence items={[EXECUTIVE_CAVEATS.documentation, EXECUTIVE_CAVEATS.servicePerformance, EXECUTIVE_CAVEATS.sla]} />

      {/* Where should we look? */}
      <ExecutiveSection
        title="Where should we look?"
        action={<ActionButton label="Investigate" onClick={() => setCurrentPage('origen')} />}
        evidence={[
          EXECUTIVE_CAVEATS.concentration,
          ...(m.look && m.look.dimension !== 'assignmentGroup' ? [EXECUTIVE_CAVEATS.fallback] : []),
          'Source: Assignment group / Service fields; drill-down: Origen view.',
        ]}
      >
        {m.look ? (
          <>
            <Insight><Big>{pctText(m.look.top.share)}</Big> of incidents in view are {m.look.dimension === 'assignmentGroup' ? 'handled by' : 'associated with'} {m.look.top.named} of {m.look.top.distinct} {lookNoun}</Insight>
            {fallbackLine && <p className="-mt-1.5 mb-3 text-[12px] text-card-foreground/75">{fallbackLine}</p>}
            <BarList items={barsFromTable(m.look.table, m.look.dimension, EXECUTIVE_SUMMARY_DISPLAY.concentrationTop)} visible={m.visible} testId="look-bars" />
            <Note>
              <b className="text-card-foreground">Why it matters</b> — Any noise-reduction or documentation effort focused on these {lookNoun} reaches {pctText(m.look.top.share)} of
              the incidents in view. These are areas worth investigating, not a judgment of the {lookNoun}.
            </Note>
          </>
        ) : <NotAvailable message="No Handling Group, Service or Offering values in view." />}
      </ExecutiveSection>

      {/* What keeps coming back? */}
      <ExecutiveSection
        title="What keeps coming back?"
        status="Directional"
        action={<ActionButton label="Review patterns" onClick={() => setCurrentPage('problems')} />}
        evidence={[
          EXECUTIVE_CAVEATS.recurrence,
          EXECUTIVE_CAVEATS.candidates,
          EXECUTIVE_CAVEATS.breadth,
          `Secondary, directional: ${pctText(m.recurring)} of incidents in view fall in some repeat pattern (${problems.length} candidates).`,
          EXECUTIVE_CAVEATS.applicationContext,
          'Drill-down: Problems & RCA and Weekly Review views.',
        ]}
      >
        {m.largest && m.breadth ? (
          <>
            <Insight>The largest repeat pattern accounts for <Big>{pctText(m.largestShare)}</Big> of incidents in view.</Insight>
            <p className="-mt-1.5 mb-3 text-[12px] text-card-foreground/75" data-testid="pattern-breadth">
              It spans {m.breadth.services} {m.breadth.services === 1 ? 'Service' : 'Services'}, {m.breadth.serviceOfferings} {m.breadth.serviceOfferings === 1 ? 'Offering' : 'Offerings'} and {m.breadth.assignmentGroups} {m.breadth.assignmentGroups === 1 ? 'Handling Group' : 'Handling Groups'}.
            </p>
            <SubHeading>Largest repeat patterns</SubHeading>
            <BarList visible={m.visible} testId="pattern-bars"
              items={problems.slice(0, EXECUTIVE_SUMMARY_DISPLAY.patternsTop).map(p => ({ key: p.id, label: p.title, incidents: p.count, kind: 'value' as const }))} />
            <SubHeading>Composition by application context</SubHeading>
            <div className="rounded-md border border-card-foreground/15 px-4 py-3 text-[12px] text-card-foreground/70">Not available — no approved extractor.</div>
          </>
        ) : <NotAvailable message="No repeat pattern in view." />}
      </ExecutiveSection>

      {/* Where is demand coming from? */}
      <ExecutiveSection
        title="Where is demand coming from?"
        action={<ActionButton label="Open Origen" onClick={() => setCurrentPage('origen')} />}
        evidence={[
          EXECUTIVE_CAVEATS.origin,
          `Coverage: Service present on ${m.tables.service ? pctText(m.tables.service.coverage) : '—'} of incidents in view; Offering on ${m.tables.serviceOffering ? pctText(m.tables.serviceOffering.coverage) : '—'}.`,
          EXECUTIVE_CAVEATS.ciFields,
          'Drill-down: Origen view (Service × Handling Group, Service × Offering).',
        ]}
      >
        {m.originDim && m.originTop ? (
          <>
            <Insight><Big>{pctText(m.originTop.share)}</Big> of incidents in view are associated with {m.originTop.named} of {m.originTop.distinct} {dimensionPlural(m.originDim)}</Insight>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-6" data-testid="origin-bars">
              {!m.singleGroup && m.tables.assignmentGroup && m.tables.assignmentGroup.rows.length > 0 && (
                <div className="min-w-0"><SubHeading>Handling Group</SubHeading>
                  <BarList items={barsFromTable(m.tables.assignmentGroup, 'assignmentGroup', EXECUTIVE_SUMMARY_DISPLAY.originTop)} visible={m.visible} /></div>
              )}
              {m.tables.service && m.tables.service.rows.length > 0 && (
                <div className="min-w-0"><SubHeading>Service</SubHeading>
                  <BarList items={barsFromTable(m.tables.service, 'service', EXECUTIVE_SUMMARY_DISPLAY.originTop)} visible={m.visible} /></div>
              )}
              {m.tables.serviceOffering && m.tables.serviceOffering.rows.length > 0 && (
                <div className="min-w-0"><SubHeading>Service Offering</SubHeading>
                  <BarList items={barsFromTable(m.tables.serviceOffering, 'serviceOffering', EXECUTIVE_SUMMARY_DISPLAY.originTop)} visible={m.visible} /></div>
              )}
            </div>
          </>
        ) : <NotAvailable message="This file has no Service or Service offering values, so origin is not available." />}
      </ExecutiveSection>

      <EvidenceBehindSummary m={m} />

      <Methodology slaState={m.sla.state} originStatus={originStatus} />

      {discoveryPromptsEnabled() && <DiscoveryPrompts originStatus={originStatus} slaState={m.sla.state} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence behind this summary — supporting values, not a second dashboard
// ---------------------------------------------------------------------------

type Metrics = ReturnType<typeof useExecutiveMetrics>;

function EvidenceCard({ title, status, children, caveat }: { title: string; status?: Status; children: ReactNode; caveat?: string }) {
  return (
    <div className="v1-card p-4 min-w-0 flex flex-col gap-1.5" data-testid={`evidence-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-card-foreground/50">
        <span>{title}</span>
        {status && <StatusTag status={status} />}
      </div>
      <div className="font-mono text-[12px] leading-relaxed text-card-foreground space-y-0.5">{children}</div>
      {caveat && <div className="text-[11px] text-card-foreground/55 leading-snug mt-auto pt-1">{caveat}</div>}
    </div>
  );
}

const n = (value: number) => value.toLocaleString('en-US');
const plural = (count: number, one: string, many: string) => `${n(count)} ${count === 1 ? one : many}`;

function EvidenceBehindSummary({ m }: { m: Metrics }) {
  const service = m.tables.service;
  const offering = m.tables.serviceOffering;
  return (
    <section className="mt-8" data-testid="evidence-behind-summary">
      <div className="flex items-center gap-3 mb-3">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-foreground/75">Evidence behind this summary</h3>
        <span className="text-[11px] text-foreground/70">Values from the loaded file, under the current filters</span>
      </div>
      <div className="grid grid-cols-1 min-[440px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5">
        <EvidenceCard title="Operational concentration" caveat={EXECUTIVE_CAVEATS.concentration}>
          {m.look ? (
            <>
              <div data-testid="evidence-concentration-value">{m.look.top.named} of {plural(m.look.top.distinct, dimensionSingular(m.look.dimension), dimensionPlural(m.look.dimension))}</div>
              <div>{n(m.look.top.incidents)} of {plural(m.visible, 'incident', 'incidents')}</div>
              {m.look.table.missing && m.look.table.missing.incidents > 0 && <div className="text-card-foreground/70">{n(m.look.table.missing.incidents)} {MISSING_LABEL[m.look.dimension].replace(/^No /, 'without ')}</div>}
            </>
          ) : <div>Not available</div>}
        </EvidenceCard>
        <EvidenceCard title="Recurring patterns" status="Directional" caveat={EXECUTIVE_CAVEATS.recurrence}>
          {m.largest && m.breadth ? (
            <>
              <div data-testid="evidence-recurring-value">Largest pattern: {plural(m.largest.count, 'incident', 'incidents')}</div>
              <div>spans {m.breadth.services} Services / {m.breadth.serviceOfferings} Offerings / {m.breadth.assignmentGroups} Handling Groups</div>
            </>
          ) : <div>No repeat pattern in view</div>}
        </EvidenceCard>
        <EvidenceCard title="Operational origin" caveat={EXECUTIVE_CAVEATS.origin}>
          <div data-testid="evidence-origin-value">
            {service ? plural(service.rows.length, 'Service', 'Services') : 'Service: not available'} · {offering ? plural(offering.rows.length, 'Offering', 'Offerings') : 'Offering: not available'}
          </div>
          {service?.missing && service.missing.incidents > 0 && <div className="text-card-foreground/70">{n(service.missing.incidents)} without Service</div>}
          {offering?.missing && offering.missing.incidents > 0 && <div className="text-card-foreground/70">{n(offering.missing.incidents)} without Offering</div>}
        </EvidenceCard>
        <EvidenceCard title="Documentation readiness" status="Directional" caveat={EXECUTIVE_CAVEATS.documentation}>
          {m.documentation ? (
            <>
              <div data-testid="evidence-documentation-value">{n(m.documentation.goodOrExcellent)} Good or Excellent <span className="text-card-foreground/60">({pctText(m.goodOrExcellent)})</span></div>
              <div>{n(m.documentation.withoutDiagnosis)} without documented diagnosis <span className="text-card-foreground/60">({pctText(m.withoutDiagnosis)})</span></div>
            </>
          ) : <div>Not available</div>}
        </EvidenceCard>
        <EvidenceCard title="Service performance" caveat={EXECUTIVE_CAVEATS.servicePerformance}>
          <div data-testid="evidence-median-value">Median open → close: {formatDuration(m.medianHours)}</div>
          <div data-testid="evidence-sla-value">
            {m.sla.state === 'not-available' && 'SLA: Not available'}
            {m.sla.state === 'no-signal' && <>SLA: 1 distinct value · no signal <StatusTag status="Needs data" /></>}
            {m.sla.state === 'available' && `SLA breached: ${m.sla.breachPct}% of ${plural(m.sla.tracked, 'tracked closed incident', 'tracked closed incidents')}`}
          </div>
        </EvidenceCard>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Methodology & limitations — collapsed, secondary
// ---------------------------------------------------------------------------

const thClass = 'px-3 py-2.5 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-card-foreground/50 whitespace-nowrap';
const tdClass = 'px-3 py-2 text-[12px] text-card-foreground/80 align-top border-t border-card-foreground/10';
const h4Class = 'mt-4 mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-card-foreground/50';
type SlaState = 'available' | 'no-signal' | 'not-available';

function Methodology({ slaState, originStatus }: { slaState: SlaState; originStatus: Status }) {
  const [open, setOpen] = useState(false);
  const slaStatus: Status = slaState === 'available' ? 'Directional' : slaState === 'no-signal' ? 'Needs data' : 'Not available';
  const lineage: [string, string, string, Status, string, string][] = [
    ['Documentation readiness', 'Quality tiers; documented diagnosis', 'Short description, Description, Work notes, State', 'Directional', EXECUTIVE_CAVEATS.documentation, 'Overview · Text Quality'],
    ['Service performance', 'Median open → close; SLA', 'Opened, Closed, Made SLA', slaStatus, EXECUTIVE_CAVEATS.servicePerformance, 'Overview · Trends'],
    ['Operational concentration', 'Top-3 share', 'Assignment group (fallback Service)', 'Validated', EXECUTIVE_CAVEATS.concentration, 'Origen'],
    ['Recurring patterns', 'Largest pattern share; breadth', 'Short description, Description, Opened', 'Directional', EXECUTIVE_CAVEATS.recurrence, 'Problems & RCA · Weekly Review'],
    ['Operational origin', 'Top-5 share per dimension', 'Service, Service offering, Assignment group', originStatus, EXECUTIVE_CAVEATS.origin, 'Origen'],
  ];
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-3 mb-6" data-testid="methodology">
      <CollapsibleTrigger className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground py-2 transition-colors">
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} /> View methodology &amp; limitations
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="v1-card px-4 pb-4">
          <h4 className={h4Class}>Operational metrics</h4>
          <div className="overflow-x-auto">
            <table className="w-full" data-testid="operational-metrics">
              <thead><tr className="bg-card-foreground/5"><th className={thClass}>Metric</th><th className={thClass}>Current measurement</th><th className={thClass}>Interpretation</th></tr></thead>
              <tbody>{OPERATIONAL_METRICS.map(r => (
                <tr key={r.metric}><td className={tdClass}>{r.metric}</td><td className={tdClass}>{r.measurement}</td><td className={tdClass}>{r.interpretation}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <h4 className={h4Class}>Insight lineage</h4>
          <div className="overflow-x-auto">
            <table className="w-full" data-testid="insight-lineage">
              <thead><tr className="bg-card-foreground/5">{['Statement', 'Metric', 'Fields', 'Status', 'Limitation', 'Drill-down'].map(h => <th key={h} className={thClass}>{h}</th>)}</tr></thead>
              <tbody>{lineage.map(([a, b, c, st, e, f]) => (
                <tr key={a} data-statement={a}><td className={tdClass}>{a}</td><td className={tdClass}>{b}</td><td className={tdClass}>{c}</td><td className={tdClass}><StatusTag status={st} /></td><td className={tdClass}>{e}</td><td className={tdClass}>{f}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <h4 className={h4Class}>Interpretation notes</h4>
          <dl className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-x-4 gap-y-1.5 text-[12px] text-card-foreground/80" data-testid="interpretation-notes">
            {INTERPRETATION_NOTES.map(note => (
              <div key={note.topic} className="contents"><dt className="font-medium text-card-foreground">{note.topic}</dt><dd className="m-0">{note.note}</dd></div>
            ))}
          </dl>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Discovery prompts — only with VITE_EXEC_DISCOVERY_PROMPTS=on
// ---------------------------------------------------------------------------

function DiscoveryPrompts({ originStatus, slaState }: { originStatus: Status; slaState: SlaState }) {
  const matrix: [string, Status, string][] = [
    ['1 · Quality of service', slaState === 'available' ? 'Directional' : 'Needs data', `Documentation quality is measured; ${EXECUTIVE_CAVEATS.servicePerformance}`],
    ['2 · Groups with opportunities', 'Needs definition', 'Volume per group is available (one group → Service). “Opportunity” needs a definition.'],
    ['3 · Resources with opportunities', 'Needs definition', 'Teams, technology or support capacity?'],
    ['4 · Recurrence', 'Directional', EXECUTIVE_CAVEATS.recurrence],
    ['5 · Biggest per period', 'Directional', 'Month and week views exist; which period matters is undecided.'],
    ['6 · Origin (Group / Service / Offering)', originStatus, originStatus === 'Validated' ? 'Origen view.' : 'One Handling Group does not tell incidents apart, so Service is used; CI is not currently used.'],
    ['7 · How problems relate', 'Needs definition', 'Depends on the decision behind the sponsor’s question; nothing is computed yet.'],
  ];
  return (
    <Section title="Questions to unlock">
      <div className="grid grid-cols-1 min-[440px]:grid-cols-2 xl:grid-cols-4 gap-2.5" data-testid="discovery-questions">
        {[
          ['Service quality', 'What does it mean to you?'],
          ['Resources', 'Teams, technology or support capacity?'],
          ['Correlation', 'What decision are you trying to make?'],
          ['Period', 'Which period matters, for which decision?'],
        ].map(([title, question]) => (
          <div key={title} className="v1-card px-4 py-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-card-foreground/50 mb-1">{title}</div>
            <div className={`text-[13px] text-card-foreground ${title === 'Correlation' ? 'italic' : ''}`}>{question}</div>
          </div>
        ))}
      </div>
      <div className="v1-card px-4 pb-4 mt-2.5">
        <h4 className={h4Class}>What the product can answer today — by sponsor question</h4>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="bg-card-foreground/5"><th className={thClass}>Question</th><th className={thClass}>This file</th><th className={thClass}>Note</th></tr></thead>
            <tbody>{matrix.map(([q, st, note]) => (
              <tr key={q} data-question={q.split(' ')[0]}><td className={tdClass}>{q}</td><td className={tdClass}><StatusTag status={st} /></td><td className={tdClass}>{note}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-4 text-[12px] text-card-foreground/80">
          <div>
            <h4 className={h4Class}>“Resources” — three readings</h4>
            <ul className="list-disc pl-5 space-y-1">
              <li><b>Teams</b> — Handling Groups, never individuals.</li>
              <li><b>Technology</b> — configuration items or hosts.</li>
              <li><b>Support capacity</b> — workload and reassignment.</li>
            </ul>
          </div>
          <div>
            <h4 className={h4Class}>What appears connected — two hypotheses</h4>
            <ul className="list-disc pl-5 space-y-1">
              <li><b>They share context</b> — same Service, Offering or Handling Group.</li>
              <li><b>They happen together</b> — same time window.</li>
            </ul>
            <p className="mt-2 italic">When you say correlation between problems, what decision are you trying to make?</p>
          </div>
        </div>
      </div>
    </Section>
  );
}
