import { useCallback, useMemo } from 'react';
import { useAppContext } from '@/context/AppContext';
import { candidateOrigenContext, membersByCluster, type CandidateOrigenContext } from '@/lib/serviceDimension';

/**
 * Service context for problem candidates, shared by every surface that shows a
 * candidate (action cards, problem rows, modal) so they all compute it the same way.
 *
 * Visible members come from the incidents under the current filters; the total
 * is the candidate's full membership, which no filter changes.
 */
export function useCandidateOrigen(): (clusterId: string) => CandidateOrigenContext {
  const { filteredIncidents, candidateTotals, dimensionAvailability } = useAppContext();
  const members = useMemo(() => membersByCluster(filteredIncidents), [filteredIncidents]);
  return useCallback(
    (clusterId: string) => candidateOrigenContext(members.get(clusterId) ?? [], candidateTotals.get(clusterId) ?? 0, dimensionAvailability),
    [members, candidateTotals, dimensionAvailability],
  );
}
