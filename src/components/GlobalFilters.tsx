import { useMemo } from 'react';
import { useAppContext } from '@/context/AppContext';
import MonthFilter from '@/components/MonthFilter';
import DimensionFilter from '@/components/DimensionFilter';
import { dimensionOptions, facetCounts } from '@/lib/serviceDimension';

/**
 * The global filters shown above every filtered view: month, plus Service and
 * Service offering when the loaded file has those columns. All three narrow the
 * same visible population, as an intersection.
 */
export default function GlobalFilters() {
  const {
    incidents, filteredIncidents, globalFilters, dimensionAvailability,
    serviceSelection, offeringSelection, setServiceSelection, setOfferingSelection,
    isDimensionFilterActive, clearDimensionFilters,
  } = useAppContext();

  // Options come from the whole file and never change with the filters.
  const serviceOptions = useMemo(() => dimensionOptions(incidents, 'service'), [incidents]);
  const offeringOptions = useMemo(() => dimensionOptions(incidents, 'serviceOffering'), [incidents]);
  const serviceCounts = useMemo(() => facetCounts(incidents, globalFilters, 'service'), [incidents, globalFilters]);
  const offeringCounts = useMemo(() => facetCounts(incidents, globalFilters, 'serviceOffering'), [incidents, globalFilters]);

  const showService = dimensionAvailability.service;
  const showOffering = dimensionAvailability.serviceOffering;

  return (
    <>
      <MonthFilter />
      {(showService || showOffering) && (
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground mr-1">
              Filter by Origen
            </span>
            {showService && (
              <DimensionFilter
                label="Service"
                allLabel="All Services"
                missingLabel="No Service"
                options={serviceOptions}
                counts={serviceCounts}
                selection={serviceSelection}
                onChange={setServiceSelection}
              />
            )}
            {showOffering && (
              <DimensionFilter
                label="Offering"
                allLabel="All Offerings"
                missingLabel="No Offering"
                options={offeringOptions}
                counts={offeringCounts}
                selection={offeringSelection}
                onChange={setOfferingSelection}
              />
            )}
            {isDimensionFilterActive && (
              <button
                type="button"
                onClick={clearDimensionFilters}
                className="font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear Origen filters
              </button>
            )}
          </div>
          {isDimensionFilterActive && filteredIncidents.length === 0 && (
            <div className="mt-2 text-[12px] text-muted-foreground">
              No results for the current filters.{' '}
              <button type="button" onClick={clearDimensionFilters} className="underline hover:text-foreground">
                Clear Service / Offering filters
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
