import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useAppContext } from '@/context/AppContext';
import type { ProblemCluster } from '@/lib/problems';
import type { ProblemListFilters } from '@/lib/problemView';

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * Export problems from the current month-filtered universe to XLSX.
 *
 * Shared by the Problems view and the problem modal, so both entry points
 * produce the same workbook. The export module (and SheetJS) is loaded on first
 * use to keep it out of the initial bundle.
 */
export function useProblemExport() {
  const { filteredIncidents, filteredScores, sourceColumns, fileName, selectedMonths, rawTextTrimmed } = useAppContext();
  const [exporting, setExporting] = useState(false);

  const exportProblems = useCallback(async (
    scope: 'view' | 'problem',
    problems: ProblemCluster[],
    listFilters: ProblemListFilters,
  ) => {
    setExporting(true);
    try {
      const { downloadProblemsWorkbook } = await import('@/lib/exportProblems');
      const result = downloadProblemsWorkbook({
        scope,
        problems,
        incidents: filteredIncidents,
        scores: filteredScores,
        sourceColumns,
        fileName,
        exportedAt: new Date(),
        selectedMonths,
        listFilters,
        rawTextTrimmed,
      });
      toast.success('Export ready', {
        description: `${plural(result.problemCount, 'problem')} · ${plural(result.incidentCount, 'incident')}`
          + (result.truncatedCells ? ` · ${result.truncatedCells} cells truncated to Excel's limit` : ''),
      });
    } catch (err) {
      console.error('Export failed:', err);
      toast.error('Export failed', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setExporting(false);
    }
  }, [filteredIncidents, filteredScores, sourceColumns, fileName, selectedMonths, rawTextTrimmed]);

  return { exportProblems, exporting };
}
