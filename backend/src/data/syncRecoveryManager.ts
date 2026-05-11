import { getConfig } from '../config/configService';
import { runBacktest } from '../backtest/walkForwardBacktest';
import { buildStatisticalPrediction } from '../engine/statisticalPrediction';
import {
  getDraws, getLatestBacktests, getNextPredictionVersion, saveBacktest, savePrediction,
} from '../db/database';
import { todayIso } from './dateUtils';
import { syncDraws, type SyncReport } from './syncDraws';
import type { DrawEntry } from '../engine/features';

const RETRY_DELAYS_MINUTES = '1,3,5,10,15'.split(',').map(Number);

export interface RetryRecoveryState {
  retry_active: boolean;
  retry_count: number;
  retry_stage: string | null;
  recovery_mode: boolean;
  last_error_message: string | null;
  last_diagnostic: string | null;
  next_sync_time: string | null;
  recovered: boolean;
}

const state: RetryRecoveryState = {
  retry_active: false,
  retry_count: 0,
  retry_stage: null,
  recovery_mode: false,
  last_error_message: null,
  last_diagnostic: null,
  next_sync_time: null,
  recovered: false,
};

let retryTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;

export function getRetryRecoveryState(): RetryRecoveryState {
  return { ...state };
}

export function startAutomaticSync(): void {
  void runManagedSync('sync-now');
  const minutes = getConfig().syncIntervalMinutes || 30;
  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = setInterval(() => void runManagedSync('sync-now'), minutes * 60000);
}

export async function runManagedSync(type: 'sync-now' | 'retry' | 'recovery' | 'cron-sync' = 'sync-now'): Promise<SyncReport> {
  const report = await syncDraws({
    type,
    retryCount: state.retry_count,
    retryStage: state.retry_stage,
    recoveryMode: state.recovery_mode || type === 'recovery',
  });

  if (report.status === 'SUCCESS' || report.status === 'NO_NEW_DATA') {
    const wasRecovering = state.retry_active || state.recovery_mode || type === 'recovery';
    clearRetryTimer();
    state.retry_active = false;
    state.retry_count = 0;
    state.retry_stage = null;
    state.recovery_mode = false;
    state.last_error_message = null;
    state.last_diagnostic = null;
    state.next_sync_time = nextIso(getConfig().syncIntervalMinutes);
    state.recovered = wasRecovering;
    if (wasRecovering) await runRecoveryPostTasks();
  } else if (report.status === 'PENDING_OFFICIAL' || report.status === 'FAILED') {
    state.last_error_message = report.errors[0] ?? '官方資料暫時無法確認';
    state.last_diagnostic = report.diagnostic ?? null;
    scheduleNextRetry();
  }

  return report;
}

function scheduleNextRetry(): void {
  clearRetryTimer();
  if (state.retry_count < RETRY_DELAYS_MINUTES.length) {
    const delay = RETRY_DELAYS_MINUTES[state.retry_count];
    state.retry_count += 1;
    state.retry_active = true;
    state.retry_stage = `retry-${state.retry_count}`;
    state.recovery_mode = false;
    state.recovered = false;
    state.next_sync_time = nextIso(delay);
    retryTimer = setTimeout(() => void runManagedSync('retry'), delay * 60000);
  } else {
    const delay = getConfig().recoveryRetryMinutes || 5;
    state.retry_active = false;
    state.retry_stage = 'recovery';
    state.recovery_mode = true;
    state.recovered = false;
    state.next_sync_time = nextIso(delay);
    retryTimer = setTimeout(() => void runManagedSync('recovery'), delay * 60000);
  }
}

function clearRetryTimer(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

async function runRecoveryPostTasks(): Promise<void> {
  const rows = getDraws();
  if (rows.length < 30) return;
  const draws: DrawEntry[] = rows.map(d => ({
    draw_no: d.draw_no,
    draw_date: d.draw_date,
    numbers: JSON.parse(d.numbers_json),
  }));

  const metrics = runBacktest(draws);
  const today = todayIso();
  for (const m of metrics) {
    saveBacktest({
      run_date: today,
      window_size: m.windowSize,
      strategy_name: m.strategyName,
      hit_rate_single: null,
      hit_rate_two: m.hitRateTwo,
      hit_rate_three: m.hitRateThree,
      hit_rate_four: m.hitRateFour,
      hit_rate_five: m.hitRateFive,
      avg_hits_two: m.avgTwoHits,
      avg_hits_three: m.avgThreeHits,
      avg_hits_four: m.avgFourHits,
      avg_hits_five: m.avgFiveHits,
      avg_hits: m.avgHits,
      max_losing_streak_two: m.maxLoseStreakTwo,
      max_losing_streak_three: m.maxLoseStreakThree,
      max_losing_streak_four: m.maxLoseStreakFour,
      max_losing_streak_five: m.maxLoseStreakFive,
      max_losing_streak: m.maxLoseStreak,
      sample_size: m.sample_size,
      tested_draws: m.tested_draws,
      audit_status: m.audit_status,
      details_json: JSON.stringify(m.records),
      score: m.score,
    });
  }

  const latestBacktests = getLatestBacktests();
  const prediction = buildStatisticalPrediction(draws, today, latestBacktests);
  savePrediction({
    target_date: prediction.target_date,
    target_draw_no: null,
    latest_used_draw_no: prediction.latest_used_draw_no,
    latest_used_draw_date: prediction.latest_used_draw_date,
    single_number: prediction.single_number,
    numbers_json: JSON.stringify(prediction.numbers),
    two_star_json: JSON.stringify(prediction.two_star),
    three_star_json: JSON.stringify(prediction.three_star),
    four_star_json: JSON.stringify(prediction.four_star),
    five_star_json: JSON.stringify(prediction.five_star),
    number_scores_json: JSON.stringify(prediction.number_scores),
    strategy_scores_json: JSON.stringify({ ...prediction.strategy_scores, balance_summary: prediction.balance_summary }),
    scores_json: JSON.stringify({ number_scores: prediction.number_scores, balance_summary: prediction.balance_summary }),
    strategy: prediction.strategy,
    model_version: prediction.model_version,
    version: getNextPredictionVersion(today),
    locked: 1,
    confidence_label: prediction.confidence_label,
    recommendation: prediction.recommendation,
    data_status: 'VALID',
  });
}

function nextIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60000).toISOString();
}
