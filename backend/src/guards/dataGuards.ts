import { getLatestDraw, getPreviousDraw, countDraws, getDB, getLastSuccessfulSync } from '../db/database';
import { checkContinuity } from '../data/verifyDraw';
import { getOfficialHtmlUrl } from '../data/fetchOfficialLatest539';
import { getConfig } from '../config/configService';
import { getPathSummary } from '../config/pathResolver';
import { getDataSourceHealth } from '../data/DataSourceManager';
import { getRetryRecoveryState } from '../data/syncRecoveryManager';
import { isoToDate, todayIso, toDisplayDate } from '../data/dateUtils';
import { sortNumbers } from '../utils/numbers';

export type DataStatus = 'VALID' | 'PENDING_OFFICIAL' | 'INVALID';
export type MinDataMode = 'FULL' | 'OBSERVATION' | 'INSUFFICIENT' | 'NO_DATA';

export const MIN_DATA = { PREDICT: 30, OBSERVATION: 100, SUFFICIENT: 300 } as const;

export function getMinDataMode(total: number): MinDataMode {
  if (total < MIN_DATA.PREDICT) return 'NO_DATA';
  if (total < MIN_DATA.OBSERVATION) return 'INSUFFICIENT';
  if (total < MIN_DATA.SUFFICIENT) return 'OBSERVATION';
  return 'FULL';
}

export interface DataStatusReport {
  mode: string;
  database_path: string;
  config_path: string;
  status: DataStatus;
  reason: string;
  can_predict: boolean;
  cannot_predict_reason: string | null;
  latest_draw_no: string | null;
  latest_draw_date: string | null;
  latest_numbers: number[] | null;
  previous_draw_no: string | null;
  previous_draw_date: string | null;
  previous_numbers: number[] | null;
  today_date: string;
  today_draw_status: 'DRAWN' | 'NOT_DRAWN';
  today_numbers: number[] | null;
  latest_used_draw_no: string | null;
  latest_used_draw_date: string | null;
  draw_count: number;
  minimum_data_met: boolean;
  min_data_mode: MinDataMode;
  data_continuous: boolean;
  history_incomplete: boolean;
  missing_periods_count: number;
  last_sync_time: string | null;
  last_sync_status: string | null;
  next_sync_time: string | null;
  retry_active: boolean;
  retry_count: number;
  retry_stage: string | null;
  recovery_mode: boolean;
  active_source: string;
  active_source_url: string | null;
  last_error_message: string | null;
  last_diagnostic: string | null;
  official_api_configured: boolean;
  official_html_url: string;
  active_api_url: string;
  api_available: boolean;
  html_fallback_available: boolean;
  last_successful_source: string | null;
  pending_official: boolean;
  next_auto_sync_time: string | null;
  last_error: string | null;
  latestDrawNo: string | null;
  latestDrawDate: string | null;
  totalDraws: number;
  missingPeriods: string[];
  lastSyncTime: string | null;
  canPredict: boolean;
  minDataMode: MinDataMode;
}

export interface TodayDrawStatus {
  todayDate: string;
  isDrawn: boolean;
  todayDrawNo: string | null;
  todayNumbers: number[] | null;
  previousDrawNo: string | null;
  previousDrawDate: string | null;
  previousNumbers: number[] | null;
}

export function checkDataFreshness(): DataStatusReport {
  const total = countDraws();
  const latest = getLatestDraw();
  const previous = getPreviousDraw();
  const lastSync = getLastSuccessfulSync();
  const cfg = getConfig();
  const paths = getPathSummary();
  const sourceHealth = getDataSourceHealth();
  const retry = getRetryRecoveryState();
  const today = getTodayDrawStatus();
  const minDataMode = getMinDataMode(total);
  const missing = total > 0
    ? checkContinuity((getDB().prepare('SELECT draw_no FROM draws ORDER BY draw_no').all() as { draw_no: string }[]).map(r => r.draw_no))
    : [];

  const latestNumbers = latest ? sortNumbers(JSON.parse(latest.numbers_json) as number[]) : null;
  const previousNumbers = previous ? sortNumbers(JSON.parse(previous.numbers_json) as number[]) : null;

  const base = {
    mode: paths.mode,
    database_path: paths.dbPath,
    config_path: paths.configPath,
    latest_draw_no: latest?.draw_no ?? null,
    latest_draw_date: toDisplayDate(latest?.draw_date) ?? null,
    latest_numbers: latestNumbers,
    previous_draw_no: previous?.draw_no ?? null,
    previous_draw_date: toDisplayDate(previous?.draw_date) ?? null,
    previous_numbers: previousNumbers,
    today_date: today.todayDate,
    today_draw_status: today.isDrawn ? 'DRAWN' as const : 'NOT_DRAWN' as const,
    today_numbers: today.todayNumbers ? sortNumbers(today.todayNumbers) : null,
    latest_used_draw_no: latest?.draw_no ?? null,
    latest_used_draw_date: toDisplayDate(latest?.draw_date) ?? null,
    draw_count: total,
    minimum_data_met: total >= MIN_DATA.PREDICT,
    min_data_mode: minDataMode,
    data_continuous: missing.length <= 10,
    history_incomplete: missing.length > 20,
    missing_periods_count: missing.length,
    last_sync_time: lastSync?.finished_at ?? null,
    last_sync_status: lastSync?.status ?? null,
    next_sync_time: retry.next_sync_time ?? getNextAutoSyncTime(lastSync?.finished_at ?? null, cfg.syncIntervalMinutes),
    retry_active: retry.retry_active,
    retry_count: retry.retry_count,
    retry_stage: retry.retry_stage,
    recovery_mode: retry.recovery_mode,
    active_source: sourceHealth.activeSource,
    active_source_url: sourceHealth.activeSourceUrl,
    last_error_message: retry.last_error_message ?? sourceHealth.lastError,
    last_diagnostic: retry.last_diagnostic ?? sourceHealth.lastError,
    official_api_configured: !!cfg.officialApiUrl,
    official_html_url: getOfficialHtmlUrl(),
    active_api_url: cfg.officialApiUrl,
    api_available: sourceHealth.apiAvailable,
    html_fallback_available: sourceHealth.htmlFallbackAvailable,
    last_successful_source: sourceHealth.lastSuccessfulSource,
    pending_official: sourceHealth.pendingOfficial || retry.recovery_mode || retry.retry_active,
    next_auto_sync_time: retry.next_sync_time ?? getNextAutoSyncTime(lastSync?.finished_at ?? null, cfg.syncIntervalMinutes),
    last_error: retry.last_error_message ?? sourceHealth.lastError,
    latestDrawNo: latest?.draw_no ?? null,
    latestDrawDate: toDisplayDate(latest?.draw_date) ?? null,
    totalDraws: total,
    missingPeriods: missing,
    lastSyncTime: lastSync?.finished_at ?? null,
    minDataMode: minDataMode,
  };

  if (retry.retry_active) return invalidLike(base, 'PENDING_OFFICIAL', '正在重新連線資料來源');
  if (retry.recovery_mode || sourceHealth.pendingOfficial || lastSync?.status === 'pending') {
    return invalidLike(base, 'PENDING_OFFICIAL', '官方資料暫時無法確認');
  }
  if (!latest || total === 0) return invalidLike(base, 'INVALID', '資料庫沒有開獎資料');
  if (total < MIN_DATA.PREDICT) return invalidLike(base, 'INVALID', `資料不足 ${MIN_DATA.PREDICT} 期`);
  if (missing.length > 20) return invalidLike(base, 'INVALID', `資料不連續，缺少 ${missing.length} 期`);
  const latestDate = isoToDate(latest.draw_date);
  if (!latestDate) return invalidLike(base, 'INVALID', `日期格式無效: ${latest.draw_date}`);
  const diffDays = (Date.now() - latestDate.getTime()) / 86400000;
  if (diffDays > 5) return invalidLike(base, 'PENDING_OFFICIAL', `資料已超過 ${Math.floor(diffDays)} 天未更新`);

  return {
    ...base,
    status: 'VALID',
    reason: retry.recovered ? '資料來源已恢復' : '資料完整有效',
    can_predict: true,
    cannot_predict_reason: null,
    canPredict: true,
  };
}

export function assertCanPredict(report: DataStatusReport): void {
  if (!report.can_predict) throw new Error(`[NoPredictionWhenInvalid] ${report.cannot_predict_reason} (status=${report.status})`);
}

export function validateOfficialSource(source: string): boolean {
  return ['taiwanlottery.com', 'official_latest', 'official_html', 'official_api', 'official_history_api', 'official_history_csv']
    .some(s => source.includes(s));
}

export function getTodayDrawStatus(): TodayDrawStatus {
  const today = todayIso();
  const todayRow = getDB()
    .prepare('SELECT * FROM draws WHERE draw_date = ? LIMIT 1')
    .get(today) as { draw_no: string; numbers_json: string } | undefined;
  const prev = getPreviousDraw();
  return {
    todayDate: toDisplayDate(today) ?? today,
    isDrawn: !!todayRow,
    todayDrawNo: todayRow?.draw_no ?? null,
    todayNumbers: todayRow ? sortNumbers(JSON.parse(todayRow.numbers_json)) : null,
    previousDrawNo: prev?.draw_no ?? null,
    previousDrawDate: toDisplayDate(prev?.draw_date) ?? null,
    previousNumbers: prev ? sortNumbers(JSON.parse(prev.numbers_json)) : null,
  };
}

function invalidLike<T extends object>(base: T, status: DataStatus, reason: string): T & {
  status: DataStatus; reason: string; can_predict: false; cannot_predict_reason: string; canPredict: false;
} {
  return { ...base, status, reason, can_predict: false, cannot_predict_reason: reason, canPredict: false };
}

function getNextAutoSyncTime(lastFinishedAt: string | null, intervalMinutes: number): string | null {
  if (!lastFinishedAt || !intervalMinutes) return null;
  const base = new Date(lastFinishedAt);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + intervalMinutes * 60000).toISOString();
}
