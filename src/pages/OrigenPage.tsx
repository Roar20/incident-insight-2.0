import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { useAppContext } from '@/context/AppContext';
import GlobalFilters from '@/components/GlobalFilters';
import { EmptyState, KPICard } from '@/components/ui/dashboard-primitives';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import DimensionTableView from '@/components/origen/DimensionTableView';
import ServiceAgMatrix from '@/components/origen/ServiceAgMatrix';
import ServiceOfferingTable from '@/components/origen/ServiceOfferingTable';
import OrigenMonthly from '@/components/origen/OrigenMonthly';
import ServiceRankingChart from '@/components/origen/ServiceRankingChart';
import { NotAvailable, Section } from '@/components/origen/shared';
import { crossTab, dimensionTable, monthlySeries, pairTable } from '@/lib/serviceDimension';

/** The approved meaning of Origen, in the app's language. */
const ORIGEN_TOOLTIP =
  'Origen describes the Service / Service Offering context associated with the incident population. '
  + "On its own it does not establish technical causality, ownership or a ticket's reassignment path.";

const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);

/** Origen — Explore all: Service and Service offering context of the visible incidents. */
export default function OrigenPage() {
  const { filteredIncidents, filteredProblems, dimensionAvailability, selectedMonths, availableMonths, serviceSelection, setServiceSelection } = useAppContext();
  const [monthlyBy, setMonthlyBy] = useState<'service' | 'serviceOffering'>('service');
  const { service: hasService, serviceOffering: hasOffering } = dimensionAvailability;

  const candidateIds = useMemo(() => new Set(filteredProblems.map(p => p.id)), [filteredProblems]);
  const services = useMemo(() => dimensionTable(filteredIncidents, 'service', candidateIds), [filteredIncidents, candidateIds]);
  const offerings = useMemo(() => dimensionTable(filteredIncidents, 'serviceOffering', candidateIds), [filteredIncidents, candidateIds]);
  const serviceByGroup = useMemo(() => crossTab(filteredIncidents, 'service', 'assignmentGroup'), [filteredIncidents]);
  const pairs = useMemo(() => pairTable(filteredIncidents, 'service', 'serviceOffering', candidateIds), [filteredIncidents, candidateIds]);
  // The month axis follows the global month filter; otherwise every month of the file.
  const months = useMemo(
    () => (selectedMonths.length ? [...selectedMonths].sort() : availableMonths.map(m => m.key)),
    [selectedMonths, availableMonths],
  );
  const effectiveMonthlyBy = hasService ? monthlyBy : 'serviceOffering';
  const monthly = useMemo(() => monthlySeries(filteredIncidents, effectiveMonthlyBy, months), [filteredIncidents, effectiveMonthlyBy, months]);
  const assignmentGroups = useMemo(() => new Set(filteredIncidents.map(i => i['Assignment group'].trim()).filter(Boolean)).size, [filteredIncidents]);

  const heading = (
    <div className="flex items-center gap-2 mb-5">
      <h2 className="text-[18px] font-semibold text-foreground">Origen</h2>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label="What Origen means" className="text-muted-foreground hover:text-foreground">
            <Info className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm text-[12px] leading-snug">{ORIGEN_TOOLTIP}</TooltipContent>
      </Tooltip>
      <span className="text-[12px] text-muted-foreground">Explore all</span>
    </div>
  );

  if (!hasService && !hasOffering) {
    return (
      <div className="animate-fade-in">
        {heading}
        <NotAvailable message="This file has no Service or Service offering column, so Origen is not available. Expected headers: “Service”, “Service offering”." />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {heading}
      <GlobalFilters />

      {filteredIncidents.length === 0 ? (
        <EmptyState message="No results for the current filters." />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-6">
            <KPICard label="Services" value={hasService ? services.rows.length : '—'} sub={hasService ? 'with incidents in view' : 'not in this file'} />
            <KPICard label="Service coverage" value={hasService ? pct(services.coverage) : '—'} sub={hasService ? `${services.visible - services.withValue} with no Service` : 'not in this file'} />
            <KPICard label="Offerings" value={hasOffering ? offerings.rows.length : '—'} sub={hasOffering ? 'with incidents in view' : 'not in this file'} />
            <KPICard label="Offering coverage" value={hasOffering ? pct(offerings.coverage) : '—'} sub={hasOffering ? `${offerings.visible - offerings.withValue} with no Offering` : 'not in this file'} />
            <KPICard label="Assignment groups" value={assignmentGroups} sub="handling these incidents" />
          </div>

          <Section title="Where is the noise?" hint="Visible incident volume associated with each Service">
            <ServiceRankingChart
              table={services}
              available={hasService}
              selection={serviceSelection}
              onSelectionChange={setServiceSelection}
            />
          </Section>

          <Section title="By Service" hint="Expand a Service to see the Offerings observed with it.">
            {hasService ? (
              <DimensionTableView
                table={services}
                incidents={filteredIncidents}
                dimension="service"
                expandTo={hasOffering ? 'serviceOffering' : null}
                labels={{ singular: 'Service', missing: 'No Service', expandMissing: 'No Offering' }}
              />
            ) : <NotAvailable message="This file has no Service column. Expected header: “Service”." />}
          </Section>

          <Section title="By Service offering" hint="Expand an Offering to see the Services observed with it.">
            {hasOffering ? (
              <DimensionTableView
                table={offerings}
                incidents={filteredIncidents}
                dimension="serviceOffering"
                expandTo={hasService ? 'service' : null}
                labels={{ singular: 'Offering', missing: 'No Offering', expandMissing: 'No Service' }}
              />
            ) : <NotAvailable message="This file has no Service offering column. Expected header: “Service offering”." />}
          </Section>

          {hasService && dimensionAvailability.assignmentGroup && (
            <Section title="Service × Assignment group" hint="Observed handling — not ownership or a reassignment path.">
              <ServiceAgMatrix tab={serviceByGroup} />
            </Section>
          )}

          {hasService && hasOffering && (
            <Section title="Service × Service offering" hint="Observed pairs.">
              <ServiceOfferingTable pairs={pairs.pairs} partial={pairs.partial} />
            </Section>
          )}

          <Section title="Monthly" hint="Follows the month filter.">
            {hasService && hasOffering && (
              <div className="flex gap-2 mb-2">
                {(['service', 'serviceOffering'] as const).map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setMonthlyBy(d)}
                    className={`font-mono text-[11px] px-2.5 py-1 rounded-md border ${monthlyBy === d ? 'bg-sidebar-primary text-sidebar-primary-foreground border-sidebar-primary' : 'bg-secondary border-border text-secondary-foreground'}`}
                  >
                    By {d === 'service' ? 'Service' : 'Offering'}
                  </button>
                ))}
              </div>
            )}
            <OrigenMonthly
              series={monthly}
              noun={effectiveMonthlyBy === 'service' ? 'Service' : 'Offering'}
              missingLabel={effectiveMonthlyBy === 'service' ? 'No Service' : 'No Offering'}
            />
          </Section>
        </>
      )}
    </div>
  );
}
