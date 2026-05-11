import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import type {
  DataStatusReport, TodayDrawStatus, DrawData,
  PredictionData, BacktestRow, SyncLogRow, StrategyWeightRow,
  StrategyPerformance,
} from '../types';

export interface DashboardState {
  dataStatus: DataStatusReport | null;
  todayDraw: TodayDrawStatus | null;
  latestDraw: DrawData | null;
  previousDraw: DrawData | null;
  prediction: PredictionData | null;
  predictionReason: string | null;
  backtests: BacktestRow[];
  syncLogs: SyncLogRow[];
  strategyWeights: StrategyWeightRow[];
  performance: StrategyPerformance | null;
  loading: boolean;
  syncing: boolean;
  lastRefresh: Date | null;
  error: string | null;
  refresh: () => Promise<void>;
  syncNow: () => Promise<void>;
}

export function useDashboard(): DashboardState {
  const [dataStatus, setDataStatus] = useState<DataStatusReport | null>(null);
  const [todayDraw, setTodayDraw] = useState<TodayDrawStatus | null>(null);
  const [latestDraw, setLatestDraw] = useState<DrawData | null>(null);
  const [previousDraw, setPreviousDraw] = useState<DrawData | null>(null);
  const [prediction, setPrediction] = useState<PredictionData | null>(null);
  const [predictionReason, setPredictionReason] = useState<string | null>(null);
  const [backtests] = useState<BacktestRow[]>([]);
  const [syncLogs] = useState<SyncLogRow[]>([]);
  const [strategyWeights] = useState<StrategyWeightRow[]>([]);
  const [performance, setPerformance] = useState<StrategyPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, latestRes, prevRes, predRes, performanceRes] = await Promise.allSettled([
        api.getStatus(),
        api.getLatestDraw(),
        api.getPreviousDraw(),
        api.getTodayPrediction(),
        api.getStrategyPerformance(30),
      ]);
      if (statusRes.status === 'fulfilled') {
        setDataStatus(statusRes.value.data.dataStatus);
        setTodayDraw(statusRes.value.data.todayDraw);
      }
      if (latestRes.status === 'fulfilled') setLatestDraw(latestRes.value.data);
      if (prevRes.status === 'fulfilled') setPreviousDraw(prevRes.value.data);
      if (predRes.status === 'fulfilled') {
        const r = predRes.value;
        setPrediction(r.success && r.data ? r.data : null);
        setPredictionReason(r.success && r.data ? null : (r.reason || r.error || '資料暫時無法確認，系統不出假資料'));
      }
      if (performanceRes.status === 'fulfilled') setPerformance(performanceRes.value.data);
      setLastRefresh(new Date());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      await api.syncNow();
      await refresh();
    } catch (e) {
      const error = e as Error & { code?: string; status?: number };
      const message = error.code === 'ADMIN_AUTH_REQUIRED' || error.status === 401
        ? '管理員登入已失效，請重新登入後再同步'
        : error.message.includes('額度')
          ? '系統今日額度已用完，請明天再試'
          : `官方資料暫時無法同步：${error.message}`;
      setError(message);
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  return {
    dataStatus, todayDraw, latestDraw, previousDraw, prediction, predictionReason,
    performance,
    backtests, syncLogs, strategyWeights, loading, syncing, lastRefresh, error,
    refresh, syncNow,
  };
}
