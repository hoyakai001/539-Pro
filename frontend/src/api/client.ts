import type {
  DrawData, DataStatusReport, TodayDrawStatus,
  PredictionData, BacktestRow, SyncLogRow, AppConfig,
  StrategyWeightRow,
} from '../types';

const BASE = ((import.meta as unknown as { env?: Record<string, string> }).env?.['VITE_API_BASE_URL']) || '/api';

function adminHeaders(): HeadersInit {
  const token = sessionStorage.getItem('admin_token');
  return token ? { 'X-Admin-Token': token, Authorization: `Bearer ${token}` } : {};
}

async function get<T>(path: string, headers?: HeadersInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers });
  return parseJsonResponse<T>(res, path);
}

async function post<T>(path: string, body?: unknown, headers?: HeadersInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(headers ?? {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return parseJsonResponse<T>(res, path);
}

async function parseJsonResponse<T>(res: Response, path: string): Promise<T> {
  const json = await res.json();
  if (!res.ok) throwApiError(json, res.status, path);
  if (json.status === 'FIREBASE_QUOTA_EXCEEDED') throwApiError({ code: 'FIREBASE_QUOTA_EXCEEDED', message: '系統今日額度已用完，請明天再試' }, res.status, path);
  if (!json.success && json.error) throwApiError(json, res.status, path);
  if (!json.success && json.message) throwApiError(json, res.status, path);
  return json;
}

function throwApiError(json: Record<string, unknown>, status: number, path: string): never {
  const error = new Error(String(json['message'] ?? json['error'] ?? `HTTP ${status}: ${path}`)) as Error & { code?: string; status?: number };
  error.code = typeof json['code'] === 'string' ? json['code'] : typeof json['error'] === 'string' ? json['error'] : undefined;
  error.status = status;
  throw error;
}

async function getText(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  if (!res.ok) {
    let message = text || `HTTP ${res.status}: ${path}`;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string; diagnostic?: string };
      message = parsed.error || parsed.message || parsed.diagnostic || message;
    } catch {
      // Keep the plain text response as the error message.
    }
    throw new Error(message);
  }
  return text;
}

export interface StatusResponse {
  success: boolean;
  data: {
    dataStatus: DataStatusReport;
    todayDraw: TodayDrawStatus;
    official_html_url: string;
    official_api_configured: boolean;
    draw_count: number;
    minimum_data_met: boolean;
  };
}

export interface DrawResponse {
  success: boolean;
  data: DrawData | null;
  error?: string;
}

export interface PredictionResponse {
  success: boolean;
  cached?: boolean;
  data: PredictionData | null;
  dataStatus?: string;
  reason?: string;
  minDataMode?: string;
  error?: string;
}

export interface BacktestResponse {
  success: boolean;
  data: BacktestRow[];
}

export interface StrategyWeightsResponse {
  success: boolean;
  data: StrategyWeightRow[];
}

export interface SyncResponse {
  success: boolean;
  data: {
    status: string;
    newDrawsInserted: number;
    latestDrawNo: string | null;
    errors: string[];
  };
}

export interface SyncLogsResponse {
  success: boolean;
  data: SyncLogRow[];
}

export interface ConfigResponse {
  success: boolean;
  data: AppConfig;
}

export interface TrainResponse {
  success: boolean;
  data: {
    evaluated: number;
    skipped: number;
    backtestRan: boolean;
    message: string;
  };
}

export const api = {
  getStatus:          () => get<StatusResponse>('/data/status'),
  getLatestDraw:      () => get<DrawResponse>('/latest-draw'),
  getPreviousDraw:    () => get<DrawResponse>('/previous-draw'),
  getTodayPrediction: () => get<PredictionResponse>('/prediction/today'),
  getBacktests:       () => get<BacktestResponse>('/backtest/summary'),
  getStrategyWeights: () => get<StrategyWeightsResponse>('/strategy-weights'),
  getSyncLogs:        (limit = 20) => get<SyncLogsResponse>(`/sync-logs?limit=${limit}`, adminHeaders()),
  getHistoryDraws:    (query = 'recent=10') => get<{ success: boolean; total: number; page: number; limit: number; draws: DrawData[] }>(`/history/draws?${query}`),
  getHistoryStats:    () => get<{ success: boolean; data: unknown }>('/history/stats'),
  getNumberAnalysis:  () => get<{ success: boolean; window: number; view: string; advanced_stats_enabled: boolean; three_star_main_enabled: boolean; decision: string; reason: string; data: import('../types').NumberAnalysisSummaryRow[] }>('/stats/number-analysis?window=100&view=summary'),
  getStrategyObservation: (limit = 30) => get<{ success: boolean; data: import('../types').ObservationStatus & { logs: unknown[] } }>(`/strategy/observation?limit=${limit}`),
  getStrategyPerformance: (window = 30) => get<{ success: boolean; data: import('../types').StrategyPerformance }>(`/strategy/performance?window=${window}`),
  getTwoStarStats:    (query = 'top=50') => get<{ success: boolean; data: unknown }>(`/stats/two-star?${query}`),
  runHistoryAudit:    () => post<{ success: boolean; data: unknown }>('/history/audit'),
  getLatestAudit:     () => get<{ success: boolean; data: unknown }>('/history/audit/latest'),
  verifyPilio:        () => post<{ success: boolean; data: unknown }>('/pilio/verify'),
  regeneratePrediction: () => post<PredictionResponse>('/prediction/regenerate'),
  getConfig:          () => get<ConfigResponse>('/config'),
  syncNow:            () => post<SyncResponse>('/sync-now', undefined, adminHeaders()),
  syncHistory:        () => post<SyncResponse>('/sync-history'),
  runBacktest:        () => post<BacktestResponse>('/run-backtest'),
  runAdvancedBacktest: () => post<{ success: boolean; data: unknown }>('/backtest/advanced'),
  runThreeStarMainBacktest: () => post<{ success: boolean; data: unknown }>('/backtest/three-star-main'),
  train:              () => post<TrainResponse>('/train'),
  saveConfig:         (cfg: Partial<AppConfig>) => post<{ success: boolean; message: string }>('/config', cfg),
  adminStatus:        () => get<{ success: boolean; setup_required: boolean; authenticated: boolean; expires_in_minutes: number | null }>('/admin/status', adminHeaders()),
  adminSetup:         (password: string) => post<{ success: boolean; message: string }>('/admin/setup', { password }),
  adminLogin:         (password: string) => post<{ success: boolean; token: string; expires_in_minutes: number }>('/admin/login', { password }),
  adminLogout:        () => post<{ success: boolean }>('/admin/logout', undefined, adminHeaders()),
  getStrategyDoc:     () => getText('/docs/strategy'),
  getCloudDeployDoc:  () => getText('/docs/cloud-deploy'),
};
