import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { EnrichedIncident } from '@/lib/parser';
import type { IncidentScore } from '@/lib/scorer';
import type { OverviewStats, DimStats, FeedbackItem, AgentStat, GroupStat } from '@/lib/analytics';
import {
  computeOverview, computeDimStats, computeFeedback,
  computeAgentStats, computeGroupStats,
} from '@/lib/analytics';

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

function parseMonthKey(opened: string): string {
  if (!opened) return '';
  const m = opened.match(/(\d{4})[/-](\d{2})/);
  return m ? `${m[1]}-${m[2]}` : '';
}

function monthLabel(key: string): string {
  if (!key) return '';
  const [year, month] = key.split('-');
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleString('default', { month: 'short', year: 'numeric' });
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

  const loadFile = useCallback(async (file: File, name: string) => {
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
        new URL('../workers/scoringWorker.js', import.meta.url),
        { type: 'module' }
      );

      worker.postMessage({ buffer, name }, [buffer]);

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;

        if (msg.type === 'progress') {
          setState(prev => ({
            ...prev,
            loadingProgress: msg.percent,
            loadingMessage: `Processing… ${msg.processed} incidents`,
          }));
        }

        if (msg.type === 'result') {
          const { incidents = [], scores = [], overview, dimStats, feedbackItems, agentStats, groupStats } = msg.payload;

          const monthSet = new Set<string>();
          for (const inc of incidents) {
            const m = (inc.Opened || '').match(/(\d{4})[/-](\d{2})/);
            if (m) monthSet.add(`${m[1]}-${m[2]}`);
          }
          const availableMonthKeys = [...monthSet].sort();
          const availableMonths: MonthOption[] = availableMonthKeys.map((k: string) => ({
            key: k,
            label: monthLabel(k),
          }));

          setState(prev => ({
            ...prev,
            incidents, scores, overview, dimStats, feedbackItems,
            agentStats, groupStats, loaded: true, loading: false,
            fileName: name, currentPage: 'overview',
            availableMonths, selectedMonths: [],
            loadingProgress: 100, loadingMessage: '',
          }));
          worker.terminate();
        }

        if (msg.type === 'error') {
          console.error('Worker error:', msg.payload);
          setState(prev => ({
            ...prev,
            loading: false,
            loadingProgress: 0,
            loadingMessage: `Error: ${msg.payload}`,
          }));
          worker.terminate();
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
        worker.terminate();
      };

    } catch (err: any) {
      console.error('Processing error:', err);
      setState(prev => ({
        ...prev,
        loading: false,
        loadingProgress: 0,
        loadingMessage: `Error: ${err.message}`,
      }));
    }
  }, []);

  const setCurrentPage = useCallback((page: string) => {
    setState(prev => ({ ...prev, currentPage: page }));
  }, []);

  const setFilterLabel = useCallback((label: string) => {
    setState(prev => ({ ...prev, filterLabel: label }));
  }, []);

  const setSelectedMonths = useCallback((months: string[]) => {
    setState(prev => ({ ...prev, selectedMonths: months }));
  }, []);

  const filteredIncidents = useMemo(() => {
    if (state.selectedMonths.length === 0) return state.incidents;
    return state.incidents.filter(inc => {
      const k = parseMonthKey(inc.Opened);
      return state.selectedMonths.includes(k);
    });
  }, [state.incidents, state.selectedMonths]);

  const filteredScores = useMemo(() => {
    if (state.selectedMonths.length === 0) return state.scores;
    const nums = new Set(filteredIncidents.map(i => i.Number));
    return state.scores.filter(s => nums.has(s.number));
  }, [state.scores, filteredIncidents, state.selectedMonths]);

  const filteredOverview = useMemo(() =>
    filteredIncidents.length > 0 ? computeOverview(filteredIncidents, filteredScores) : state.overview,
    [filteredIncidents, filteredScores, state.overview]);

  const filteredDimStats = useMemo(() =>
    filteredScores.length > 0 ? computeDimStats(filteredScores) : state.dimStats,
    [filteredScores, state.dimStats]);

  const filteredFeedbackItems = useMemo(() =>
    filteredScores.length > 0 ? computeFeedback(filteredScores) : state.feedbackItems,
    [filteredScores, state.feedbackItems]);

  const filteredAgentStats = useMemo(() =>
    filteredIncidents.length > 0 ? computeAgentStats(filteredIncidents, filteredScores) : state.agentStats,
    [filteredIncidents, filteredScores, state.agentStats]);

  const filteredGroupStats = useMemo(() =>
    filteredIncidents.length > 0 ? computeGroupStats(filteredIncidents, filteredScores) : state.groupStats,
    [filteredIncidents, filteredScores, state.groupStats]);

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
