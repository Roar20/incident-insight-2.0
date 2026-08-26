import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { EnrichedIncident } from '@/lib/parser';
import type { IncidentScore } from '@/lib/scorer';
import type { OverviewStats, DimStats, FeedbackItem, AgentStat, GroupStat } from '@/lib/analytics';
import {
  computeOverview, computeDimStats, computeFeedback,
  computeAgentStats, computeGroupStats, parseMonthKey, monthLabel,
} from '@/lib/analytics';
import type { WorkerMessage } from '@/workers/scoringWorker';

export interface MonthOption {
  key: string;
  label: string;
}

interface AppState {
  incidents: EnrichedIncident[];
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
  availableMonths: MonthOption[];
  selectedMonths: string[];
}

interface AppContextType extends AppState {
  loadFile: (file: File, name: string) => void;
  setCurrentPage: (page: string) => void;
  setFilterLabel: (label: string) => void;
  setSelectedMonths: (months: string[]) => void;
  filteredIncidents: EnrichedIncident[];
  filteredScores: IncidentScore[];
  filteredOverview: OverviewStats | null;
  filteredDimStats: DimStats[];
  filteredFeedbackItems: FeedbackItem[];
  filteredAgentStats: AgentStat[];
  filteredGroupStats: GroupStat[];
}

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
    availableMonths: [],
    selectedMonths: [],
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
          const { incidents, scores, overview, dimStats, feedbackItems, agentStats, groupStats } = msg.payload;

          const monthSet = new Set<string>();
          for (const inc of incidents) {
            const key = parseMonthKey(inc.Opened);
            if (key) monthSet.add(key);
          }
          const availableMonths: MonthOption[] = [...monthSet].sort().map(key => ({
            key,
            label: monthLabel(key),
          }));

          setState(prev => ({
            ...prev,
            incidents, scores, overview, dimStats, feedbackItems,
            agentStats, groupStats, loaded: true, loading: false,
            fileName: name, currentPage: 'overview',
            availableMonths, selectedMonths: [],
            loadingProgress: 100, loadingMessage: '',
          }));
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

  // When no month is selected the filtered views are just the precomputed
  // whole-dataset stats. When a month *is* selected the stats are always
  // recomputed from that subset — including when the subset is empty, so an
  // empty selection renders an empty dashboard rather than the all-time numbers.
  const isMonthFiltered = state.selectedMonths.length > 0;

  const filteredIncidents = useMemo(() => {
    if (!isMonthFiltered) return state.incidents;
    const selected = new Set(state.selectedMonths);
    return state.incidents.filter(inc => selected.has(parseMonthKey(inc.Opened)));
  }, [state.incidents, state.selectedMonths, isMonthFiltered]);

  const filteredScores = useMemo(() => {
    if (!isMonthFiltered) return state.scores;
    const nums = new Set(filteredIncidents.map(i => i.Number));
    return state.scores.filter(s => nums.has(s.number));
  }, [state.scores, filteredIncidents, isMonthFiltered]);

  const filteredOverview = useMemo(() =>
    isMonthFiltered ? computeOverview(filteredIncidents, filteredScores) : state.overview,
    [isMonthFiltered, filteredIncidents, filteredScores, state.overview]);

  const filteredDimStats = useMemo(() =>
    isMonthFiltered ? computeDimStats(filteredScores) : state.dimStats,
    [isMonthFiltered, filteredScores, state.dimStats]);

  const filteredFeedbackItems = useMemo(() =>
    isMonthFiltered ? computeFeedback(filteredScores) : state.feedbackItems,
    [isMonthFiltered, filteredScores, state.feedbackItems]);

  const filteredAgentStats = useMemo(() =>
    isMonthFiltered ? computeAgentStats(filteredIncidents, filteredScores) : state.agentStats,
    [isMonthFiltered, filteredIncidents, filteredScores, state.agentStats]);

  const filteredGroupStats = useMemo(() =>
    isMonthFiltered ? computeGroupStats(filteredIncidents, filteredScores) : state.groupStats,
    [isMonthFiltered, filteredIncidents, filteredScores, state.groupStats]);

  return (
    <AppContext.Provider value={{
      ...state,
      loadFile, setCurrentPage, setFilterLabel, setSelectedMonths,
      filteredIncidents, filteredScores,
      filteredOverview, filteredDimStats, filteredFeedbackItems,
      filteredAgentStats, filteredGroupStats,
    }}>
      {children}
    </AppContext.Provider>
  );
}
