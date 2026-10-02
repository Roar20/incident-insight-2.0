import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { IncidentScore } from '@/lib/scorer';
import type { OverviewStats, DimStats, FeedbackItem, AgentStat, GroupStat } from '@/lib/analytics';
import {
  computeOverview, computeDimStats, computeFeedback,
  computeAgentStats, computeGroupStats, parseMonthKey, monthLabel,
} from '@/lib/analytics';
import type { AnnotatedIncident, ProblemCluster, CategoryStat, ProblemAction } from '@/lib/problems';
import { computeProblemClusters, computeCategoryStats, recommendActions } from '@/lib/problems';
import { computePeriodTrends, type PeriodTrend } from '@/lib/trends';
import { availableWeeks } from '@/lib/weekly';
import type { SourceColumn } from '@/lib/parser';
import { toast } from 'sonner';
import { ALL_VALUES, filterIncidents, isAnyFilterActive, isDimensionFiltered, type DimensionSelection, type GlobalFilters } from '@/lib/problemView';
import { dimensionAvailability as availabilityOf, type DimensionAvailability } from '@/lib/dimensions';
import { clusterSizes } from '@/lib/serviceDimension';
import type { WorkerMessage } from '@/workers/scoringWorker';

export interface MonthOption {
  key: string;
  label: string;
}

interface AppState {
  incidents: AnnotatedIncident[];
  scores: IncidentScore[];
  overview: OverviewStats | null;
  dimStats: DimStats[];
  feedbackItems: FeedbackItem[];
  agentStats: AgentStat[];
  groupStats: GroupStat[];
  currentPage: string;
  filterLabel: string;
  loaded: boolean;
  loading: boolean;
  loadingProgress: number;
  loadingMessage: string;
  fileName: string;
  /** Source columns in their original order, for exports. */
  sourceColumns: SourceColumn[];
  /** True when the worker dropped raw Description and Work notes to save memory. */
  rawTextTrimmed: boolean;
  availableMonths: MonthOption[];
  selectedMonths: string[];
  /** Global Service filter; empty means all Services, with or without a value. */
  serviceSelection: DimensionSelection;
  /** Global Service offering filter; empty means all Offerings, with or without a value. */
  offeringSelection: DimensionSelection;
  availableWeeks: string[];
  selectedWeek: string;
}

interface AppContextType extends AppState {
  loadFile: (file: File, name: string) => void;
  setCurrentPage: (page: string) => void;
  setFilterLabel: (label: string) => void;
  setSelectedMonths: (months: string[]) => void;
  setServiceSelection: (selection: DimensionSelection) => void;
  setOfferingSelection: (selection: DimensionSelection) => void;
  clearDimensionFilters: () => void;
  setSelectedWeek: (week: string) => void;
  /** Month ∩ Service ∩ Service offering, as applied to filteredIncidents. */
  globalFilters: GlobalFilters;
  /** True when a Service or Service offering filter is active (not the month filter). */
  isDimensionFilterActive: boolean;
  /** Which optional dimensions the loaded file has. */
  dimensionAvailability: DimensionAvailability;
  /** Incidents per clusterId over the whole dataset: each problem's full membership, ignoring filters. */
  candidateTotals: Map<string, number>;
  filteredIncidents: AnnotatedIncident[];
  filteredScores: IncidentScore[];
  filteredOverview: OverviewStats | null;
  filteredDimStats: DimStats[];
  filteredFeedbackItems: FeedbackItem[];
  filteredAgentStats: AgentStat[];
  filteredGroupStats: GroupStat[];
  filteredProblems: ProblemCluster[];
  filteredCategories: CategoryStat[];
  filteredActions: ProblemAction[];
  weeklyTrends: PeriodTrend[];
  monthlyTrends: PeriodTrend[];
}

/** One toast for ingestion warnings, replaced or cleared by the next load. */
const INGESTION_WARNING_TOAST = 'ingestion-warnings';

const AppContext = createContext<AppContextType | null>(null);

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>({
    incidents: [],
    scores: [],
    overview: null,
    dimStats: [],
    feedbackItems: [],
    agentStats: [],
    groupStats: [],
    currentPage: 'overview',
    filterLabel: 'all',
    loaded: false,
    loading: false,
    loadingProgress: 0,
    loadingMessage: '',
    fileName: '',
    sourceColumns: [],
    rawTextTrimmed: false,
    availableMonths: [],
    selectedMonths: [],
    serviceSelection: ALL_VALUES,
    offeringSelection: ALL_VALUES,
    availableWeeks: [],
    selectedWeek: '',
  });

  // Tracked so an in-flight parse can be torn down when a second file is
  // dropped, or when the provider unmounts.
  const workerRef = useRef<Worker | null>(null);

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => stopWorker, [stopWorker]);

  const loadFile = useCallback(async (file: File, name: string) => {
    stopWorker();
    // Warnings belong to the file they were raised for.
    toast.dismiss(INGESTION_WARNING_TOAST);
    setState(prev => ({
      ...prev,
      loading: true,
      loadingProgress: 10,
      loadingMessage: 'Reading file...'
    }));

    try {
      const buffer = await file.arrayBuffer();

      setState(prev => ({ ...prev, loadingProgress: 20, loadingMessage: 'Starting worker...' }));

      const worker = new Worker(
        new URL('../workers/scoringWorker.ts', import.meta.url),
        { type: 'module' }
      );
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const msg = e.data;

        if (msg.type === 'progress') {
          setState(prev => ({
            ...prev,
            loadingProgress: msg.percent,
            loadingMessage: `Processing… ${msg.processed} incidents`,
          }));
        }

        if (msg.type === 'result') {
          const {
            incidents, scores, overview, dimStats, feedbackItems, agentStats, groupStats,
            sourceColumns, rawTextTrimmed,
          } = msg.payload;

          const monthSet = new Set<string>();
          for (const inc of incidents) {
            const key = parseMonthKey(inc.Opened);
            if (key) monthSet.add(key);
          }
          const availableMonths: MonthOption[] = [...monthSet].sort().map(key => ({
            key,
            label: monthLabel(key),
          }));

          const weeks = availableWeeks(incidents);

          setState(prev => ({
            ...prev,
            incidents, scores, overview, dimStats, feedbackItems,
            agentStats, groupStats, loaded: true, loading: false,
            fileName: name, sourceColumns, rawTextTrimmed, currentPage: 'overview',
            availableMonths, selectedMonths: [],
            // Selections belong to the file they were made on.
            serviceSelection: ALL_VALUES, offeringSelection: ALL_VALUES,
            // Default the weekly review to the most recent complete week of data.
            availableWeeks: weeks, selectedWeek: weeks[weeks.length - 1] ?? '',
            loadingProgress: 100, loadingMessage: '',
          }));
          if (msg.payload.warnings.length) {
            toast.warning('File loaded with warnings', {
              id: INGESTION_WARNING_TOAST,
              description: msg.payload.warnings.join(' '),
              duration: 15000,
            });
          }
          stopWorker();
        }

        if (msg.type === 'error') {
          console.error('Worker error:', msg.payload);
          setState(prev => ({
            ...prev,
            loading: false,
            loadingProgress: 0,
            loadingMessage: `Error: ${msg.payload}`,
          }));
          stopWorker();
        }
      };

      worker.onerror = (err) => {
        console.error('Worker crash:', err);
        setState(prev => ({
          ...prev,
          loading: false,
          loadingProgress: 0,
          loadingMessage: `Worker error: ${err.message}`,
        }));
        stopWorker();
      };

      worker.postMessage({ buffer, name }, [buffer]);
    } catch (err) {
      console.error('Processing error:', err);
      stopWorker();
      setState(prev => ({
        ...prev,
        loading: false,
        loadingProgress: 0,
        loadingMessage: `Error: ${err instanceof Error ? err.message : String(err)}`,
      }));
    }
  }, [stopWorker]);

  const setCurrentPage = useCallback((page: string) => {
    setState(prev => ({ ...prev, currentPage: page }));
  }, []);

  const setFilterLabel = useCallback((label: string) => {
    setState(prev => ({ ...prev, filterLabel: label }));
  }, []);

  const setSelectedMonths = useCallback((months: string[]) => {
    setState(prev => ({ ...prev, selectedMonths: months }));
  }, []);

  const setServiceSelection = useCallback((selection: DimensionSelection) => {
    setState(prev => ({ ...prev, serviceSelection: selection }));
  }, []);

  const setOfferingSelection = useCallback((selection: DimensionSelection) => {
    setState(prev => ({ ...prev, offeringSelection: selection }));
  }, []);

  const clearDimensionFilters = useCallback(() => {
    setState(prev => ({ ...prev, serviceSelection: ALL_VALUES, offeringSelection: ALL_VALUES }));
  }, []);

  const setSelectedWeek = useCallback((week: string) => {
    setState(prev => ({ ...prev, selectedWeek: week }));
  }, []);

  const globalFilters = useMemo<GlobalFilters>(() => ({
    months: state.selectedMonths,
    services: state.serviceSelection,
    serviceOfferings: state.offeringSelection,
  }), [state.selectedMonths, state.serviceSelection, state.offeringSelection]);

  const isDimensionFilterActive = isDimensionFiltered(state.serviceSelection) || isDimensionFiltered(state.offeringSelection);

  // With no filter active the filtered views are just the precomputed
  // whole-dataset stats. With any filter (month, Service, Service offering) the
  // stats are always recomputed from that subset — including when the subset is
  // empty, so an empty selection renders an empty dashboard rather than the
  // all-time numbers. Filters only narrow the population; clusterId was assigned
  // once in the worker and problems below regroup by it, never recluster.
  const isFiltered = isAnyFilterActive(globalFilters);

  const filteredIncidents = useMemo(() => {
    if (!isFiltered) return state.incidents;
    return filterIncidents(state.incidents, globalFilters);
  }, [state.incidents, globalFilters, isFiltered]);

  const filteredScores = useMemo(() => {
    if (!isFiltered) return state.scores;
    const nums = new Set(filteredIncidents.map(i => i.Number));
    return state.scores.filter(s => nums.has(s.number));
  }, [state.scores, filteredIncidents, isFiltered]);

  const filteredOverview = useMemo(() =>
    isFiltered ? computeOverview(filteredIncidents, filteredScores) : state.overview,
    [isFiltered, filteredIncidents, filteredScores, state.overview]);

  const filteredDimStats = useMemo(() =>
    isFiltered ? computeDimStats(filteredScores) : state.dimStats,
    [isFiltered, filteredScores, state.dimStats]);

  const filteredFeedbackItems = useMemo(() =>
    isFiltered ? computeFeedback(filteredScores) : state.feedbackItems,
    [isFiltered, filteredScores, state.feedbackItems]);

  const filteredAgentStats = useMemo(() =>
    isFiltered ? computeAgentStats(filteredIncidents, filteredScores) : state.agentStats,
    [isFiltered, filteredIncidents, filteredScores, state.agentStats]);

  const filteredGroupStats = useMemo(() =>
    isFiltered ? computeGroupStats(filteredIncidents, filteredScores) : state.groupStats,
    [isFiltered, filteredIncidents, filteredScores, state.groupStats]);

  // Clustering already happened in the worker, so these only regroup by the
  // cluster id each incident carries — cheap enough to redo per filter change.
  const filteredProblems = useMemo(() =>
    computeProblemClusters(filteredIncidents, filteredScores),
    [filteredIncidents, filteredScores]);

  const filteredCategories = useMemo(() =>
    computeCategoryStats(filteredIncidents, filteredScores),
    [filteredIncidents, filteredScores]);

  const filteredActions = useMemo(() =>
    recommendActions(filteredProblems, filteredIncidents.length),
    [filteredProblems, filteredIncidents.length]);

  const dimensionAvailability = useMemo(() => availabilityOf(state.sourceColumns), [state.sourceColumns]);

  // Full membership of every problem, independent of any filter.
  const candidateTotals = useMemo(() => clusterSizes(state.incidents), [state.incidents]);

  // Trends deliberately span the whole dataset: a trend over a filtered slice of
  // months is not a trend.
  const weeklyTrends = useMemo(() =>
    computePeriodTrends(state.incidents, state.scores, 'week'),
    [state.incidents, state.scores]);

  const monthlyTrends = useMemo(() =>
    computePeriodTrends(state.incidents, state.scores, 'month'),
    [state.incidents, state.scores]);

  return (
    <AppContext.Provider value={{
      ...state,
      loadFile, setCurrentPage, setFilterLabel, setSelectedMonths, setSelectedWeek,
      setServiceSelection, setOfferingSelection, clearDimensionFilters,
      globalFilters, isDimensionFilterActive, dimensionAvailability, candidateTotals,
      filteredIncidents, filteredScores,
      filteredOverview, filteredDimStats, filteredFeedbackItems,
      filteredAgentStats, filteredGroupStats,
      filteredProblems, filteredCategories, filteredActions,
      weeklyTrends, monthlyTrends,
    }}>
      {children}
    </AppContext.Provider>
  );
}
