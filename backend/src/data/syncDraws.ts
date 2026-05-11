import { DataSourceManager } from './DataSourceManager';
import { fetchOfficialHistory539, fetchHistoryMultiYear } from './fetchOfficialHistory539';
import { verifyDraw, checkContinuity, DrawValidationError } from './verifyDraw';
import { toDisplayDate } from './dateUtils';
import {
  upsertDraw, getDraws, getLatestDraw,
  insertSyncLog, finishSyncLog,
  evaluateStrategyObservationLogs,
} from '../db/database';

export type SyncStatus = 'SUCCESS' | 'PARTIAL' | 'NO_NEW_DATA' | 'FAILED' | 'PENDING_OFFICIAL';

export interface SyncReport {
  status: SyncStatus;
  newDrawsInserted: number;
  latestDrawNo: string | null;
  latestDrawDate: string | null;
  missingPeriods: string[];
  errors: string[];
  diagnostic?: string;
  activeSource?: string;
  activeSourceUrl?: string | null;
  timestamp: string;
}

export interface SyncOptions {
  type?: 'sync-now' | 'sync-history' | 'retry' | 'recovery' | 'cron-sync';
  retryCount?: number;
  retryStage?: string | null;
  recoveryMode?: boolean;
}

export async function syncDraws(options: SyncOptions = {}): Promise<SyncReport> {
  const startedAt = new Date().toISOString();
  const latestBefore = getLatestDraw();
  const logId = insertSyncLog({
    started_at: startedAt,
    latest_draw_no_before: latestBefore?.draw_no ?? null,
    type: options.type ?? 'sync-now',
    retry_count: options.retryCount ?? 0,
    retry_stage: options.retryStage ?? null,
    recovery_mode: options.recoveryMode ?? false,
  });

  const report: SyncReport = {
    status: 'FAILED',
    newDrawsInserted: 0,
    latestDrawNo: latestBefore?.draw_no ?? null,
    latestDrawDate: toDisplayDate(latestBefore?.draw_date) ?? null,
    missingPeriods: [],
    errors: [],
    timestamp: startedAt,
  };

  try {
    const latestResult = await new DataSourceManager().fetchLatest();
    report.diagnostic = latestResult.diagnostic;
    report.activeSource = latestResult.health.activeSource;
    report.activeSourceUrl = latestResult.health.activeSourceUrl;

    if (!latestResult.success || !latestResult.data) {
      report.status = 'PENDING_OFFICIAL';
      report.errors.push(latestResult.message ?? latestResult.error ?? '官方資料暫時無法確認');
    } else {
      const d = latestResult.data;
      try {
        verifyDraw(d);
        const outcome = upsertDraw({
          draw_no: d.draw_no,
          draw_date: d.draw_date,
          numbers: d.numbers,
          source: d.source,
          source_url: d.source_url,
          verified: true,
        });
        report.latestDrawNo = d.draw_no;
        report.latestDrawDate = toDisplayDate(d.draw_date) ?? d.draw_date;
        report.status = outcome === 'inserted' ? 'SUCCESS' : 'NO_NEW_DATA';
        report.newDrawsInserted = outcome === 'inserted' ? 1 : 0;
        evaluateStrategyObservationLogs();
      } catch (e) {
        report.status = 'FAILED';
        report.errors.push(e instanceof DrawValidationError
          ? `validation failed: ${e.message}`
          : `DB insert failed: ${(e as Error).message}`);
      }
    }

    const latest = getLatestDraw();
    if (latest) {
      report.latestDrawNo = latest.draw_no;
      report.latestDrawDate = toDisplayDate(latest.draw_date) ?? latest.draw_date;
    }
  } catch (e) {
    report.status = 'FAILED';
    report.errors.push(`${options.type ?? 'sync-now'} failed: ${(e as Error).message}`);
  }

  finishSyncLog(logId, {
    finished_at: new Date().toISOString(),
    status: toDbStatus(report.status, options.recoveryMode),
    active_source: report.activeSource ?? null,
    source_url: report.activeSourceUrl ?? null,
    retry_count: options.retryCount ?? 0,
    retry_stage: options.retryStage ?? null,
    recovery_mode: options.recoveryMode ?? false,
    latest_draw_no_after: report.latestDrawNo,
    new_draws_inserted: report.newDrawsInserted,
    message: buildLogMessage(report),
    diagnostic: report.diagnostic ?? null,
    error_stack: report.diagnostic ?? (report.errors.length > 0 ? report.errors.join('\n') : null),
  });

  return report;
}

export interface SyncHistoryReport extends SyncReport {
  historyIncomplete: boolean;
  yearsAttempted: number;
  yearsFailed: number;
}

export async function fullHistorySync(): Promise<SyncHistoryReport> {
  const startedAt = new Date().toISOString();
  const latestBefore = getLatestDraw();
  const logId = insertSyncLog({
    started_at: startedAt,
    latest_draw_no_before: latestBefore?.draw_no ?? null,
    type: 'sync-history',
  });

  const currentRocYear = new Date().getFullYear() - 1911;
  const report: SyncHistoryReport = {
    status: 'FAILED',
    newDrawsInserted: 0,
    latestDrawNo: latestBefore?.draw_no ?? null,
    latestDrawDate: toDisplayDate(latestBefore?.draw_date) ?? null,
    missingPeriods: [],
    errors: [],
    timestamp: startedAt,
    historyIncomplete: false,
    yearsAttempted: currentRocYear - 96 + 1,
    yearsFailed: 0,
    activeSource: 'api',
    activeSourceUrl: undefined,
  };

  try {
    const result = await fetchHistoryMultiYear(96, currentRocYear);
    report.activeSourceUrl = result.sourceUrl;

    if (result.draws) {
      for (const draw of result.draws) {
        try {
          verifyDraw(draw);
          const outcome = upsertDraw({
            draw_no: draw.draw_no,
            draw_date: draw.draw_date,
            numbers: draw.numbers,
            source: 'official_history_api',
            source_url: result.sourceUrl,
            verified: false,
          });
          if (outcome === 'inserted') report.newDrawsInserted++;
        } catch {
          // Skip invalid/conflicting history rows.
        }
      }
    }

    if (result.error) {
      report.errors.push(result.error);
      report.historyIncomplete = true;
      report.yearsFailed = result.failedCount ?? 0;
    }

    report.missingPeriods = checkContinuity(getDraws().map(d => d.draw_no));
    report.latestDrawNo = latestBefore?.draw_no ?? null;
    report.latestDrawDate = toDisplayDate(latestBefore?.draw_date) ?? null;
    report.status = report.errors.length === 0 ? 'SUCCESS' : 'PARTIAL';
  } catch (e) {
    report.status = 'FAILED';
    report.errors.push(`sync-history failed: ${(e as Error).message}`);
  }

  finishSyncLog(logId, {
    finished_at: new Date().toISOString(),
    status: toDbStatus(report.status),
    active_source: report.activeSource ?? 'api',
    source_url: report.activeSourceUrl ?? null,
    latest_draw_no_after: latestBefore?.draw_no ?? null,
    new_draws_inserted: report.newDrawsInserted,
    message: `sync-history completed; inserted ${report.newDrawsInserted} draw(s), failed months ${report.yearsFailed}`,
    diagnostic: report.errors.length > 0 ? report.errors.slice(0, 3).join('\n') : null,
    error_stack: report.errors.length > 0 ? report.errors.slice(0, 3).join('\n') : null,
  });

  return report;
}

export async function syncRecentYears(yearsBack = 1): Promise<void> {
  const currentRocYear = new Date().getFullYear() - 1911;
  const startYear = Math.max(96, currentRocYear - yearsBack);
  for (let y = startYear; y <= currentRocYear; y++) {
    const result = await fetchOfficialHistory539(y);
    if (!result.success || !result.draws) continue;
    for (const draw of result.draws) {
      try {
        verifyDraw(draw);
        upsertDraw({
          draw_no: draw.draw_no,
          draw_date: draw.draw_date,
          numbers: draw.numbers,
          source: 'official_history_api',
          source_url: result.sourceUrl,
          verified: false,
        });
      } catch {
        // Skip invalid rows.
      }
    }
  }
}

function toDbStatus(status: SyncStatus, recoveryMode = false): 'success' | 'failed' | 'partial' | 'pending' | 'recovered' {
  if (status === 'SUCCESS' || status === 'NO_NEW_DATA') return recoveryMode ? 'recovered' : 'success';
  if (status === 'PENDING_OFFICIAL') return 'pending';
  if (status === 'PARTIAL') return 'partial';
  return 'failed';
}

function buildLogMessage(report: SyncReport): string {
  if (report.status === 'PENDING_OFFICIAL') return `官方資料暫時無法確認: ${report.errors[0] ?? ''}`;
  if (report.errors.length > 0) return report.errors.join('; ');
  if (report.diagnostic) return `sync completed; ${report.diagnostic}`;
  return `sync completed; inserted ${report.newDrawsInserted} draw(s)`;
}
