import { DataSourceManager, type DataSourceAttempt, type DataSourceSelectedSource } from './DataSourceManager';
import { verifyDraw } from './verifyDraw';
import { toDisplayDate } from './dateUtils';
import { getDatabaseAdapter, type AdapterDraw, type AdapterPrediction } from '../db/adapters';
import { getFirestoreDb } from '../db/adapters/firestoreClient';
import { isCloudReadonly } from '../db/adapters/readonlyGuard';
import { sortNumbers } from '../utils/numbers';

export interface CloudSyncReport {
  status: 'SUCCESS' | 'NO_NEW_DATA' | 'PENDING_OFFICIAL' | 'FAILED';
  newDrawsInserted: number;
  latestDrawNo: string | null;
  latestDrawDate: string | null;
  evaluated: boolean;
  errors: string[];
  activeSource?: string;
  activeSourceUrl?: string | null;
  selectedSource?: DataSourceSelectedSource;
  selectedUrl?: string | null;
  fallbackUsed?: boolean;
  attemptedSources?: DataSourceAttempt[];
}

export type CloudSyncType = 'cron-sync' | 'manual-sync';
export type CloudSyncLogStatus = 'success' | 'pending' | 'failed' | 'unauthorized';

export interface CloudSyncOptions {
  type?: CloudSyncType;
  retry?: number;
}

export interface CloudSyncLogInput {
  type: CloudSyncType;
  status: CloudSyncLogStatus;
  source?: string | null;
  source_url?: string | null;
  selected_source?: string | null;
  selected_url?: string | null;
  fallback_used?: boolean;
  attempted_sources?: DataSourceAttempt[];
  inserted?: number;
  retry?: number;
  latest_draw_no?: string | null;
  latest_draw_date?: string | null;
  error_message?: string | null;
  reason?: string | null;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
}

export async function cloudSyncNow(options: CloudSyncOptions = {}): Promise<CloudSyncReport> {
  const adapter = getDatabaseAdapter();
  const type = options.type ?? 'manual-sync';
  const retry = options.retry ?? 0;
  const startedAt = new Date().toISOString();
  const report: CloudSyncReport = {
    status: 'FAILED',
    newDrawsInserted: 0,
    latestDrawNo: null,
    latestDrawDate: null,
    evaluated: false,
    errors: [],
    selectedSource: 'none',
    selectedUrl: null,
    fallbackUsed: false,
    attemptedSources: [],
  };

  let latestResult: Awaited<ReturnType<DataSourceManager['fetchLatest']>>;
  try {
    latestResult = await new DataSourceManager().fetchLatest();
  } catch (e) {
    report.status = 'FAILED';
    report.errors.push((e as Error).message);
    await writeCloudSyncLogForReport(type, startedAt, report, retry);
    return report;
  }
  report.activeSource = latestResult.health.activeSource;
  report.activeSourceUrl = latestResult.health.activeSourceUrl;
  report.selectedSource = latestResult.health.selectedSource;
  report.selectedUrl = latestResult.health.selectedUrl;
  report.fallbackUsed = latestResult.health.fallbackUsed;
  report.attemptedSources = latestResult.health.attemptedSources;
  if (!latestResult.success || !latestResult.data) {
    report.status = 'PENDING_OFFICIAL';
    report.errors.push(latestResult.message ?? latestResult.error ?? '官方資料暫時無法確認');
    await writeCloudSyncLogForReport(type, startedAt, report, retry);
    return report;
  }

  try {
    verifyDraw(latestResult.data);
    const draw: AdapterDraw = {
      draw_no: latestResult.data.draw_no,
      draw_date: latestResult.data.draw_date,
      numbers: latestResult.data.numbers,
      source: latestResult.data.source,
      source_url: latestResult.data.source_url,
      verified: true,
    };
    const outcome = await adapter.insertDraw(draw);
    report.status = outcome === 'inserted' ? 'SUCCESS' : 'NO_NEW_DATA';
    report.newDrawsInserted = outcome === 'inserted' ? 1 : 0;
    report.latestDrawNo = draw.draw_no;
    report.latestDrawDate = toDisplayDate(draw.draw_date) ?? draw.draw_date;
    report.evaluated = await evaluatePredictionForDraw(draw);
    if (outcome === 'inserted' && 'setCache' in adapter) {
      await (adapter as { setCache(key: string, value: Record<string, unknown>): Promise<void> }).setCache('latest_draw', {
        latest_draw_no: draw.draw_no,
        latest_draw_date: draw.draw_date,
        data: {
          draw_no: draw.draw_no,
          draw_date: toDisplayDate(draw.draw_date) ?? draw.draw_date,
          numbers: sortNumbers(draw.numbers),
          formatted_numbers: sortNumbers(draw.numbers).map(n => String(n).padStart(2, '0')),
          source: draw.source ?? 'official',
          source_url: draw.source_url ?? null,
          verified: draw.verified === false ? 0 : 1,
        },
      });
    }
    await writeCloudSyncLogForReport(type, startedAt, report, retry);
    return report;
  } catch (e) {
    report.status = 'FAILED';
    report.errors.push((e as Error).message);
    await writeCloudSyncLogForReport(type, startedAt, report, retry);
    return report;
  }
}

export async function writeCloudSyncLog(input: CloudSyncLogInput): Promise<void> {
  if (isCloudReadonly()) {
    console.warn(`[CLOUD_READONLY] skip sync_logs write: ${input.type}/${input.status}`);
    return;
  }
  try {
    const createdAt = input.created_at ?? new Date().toISOString();
    const startedAt = input.started_at ?? createdAt;
    const finishedAt = input.finished_at ?? createdAt;
    const id = `${createdAt.replace(/[:.]/g, '-')}_${input.type}_${input.status}`;
    await getFirestoreDb().collection('sync_logs').doc(id).set({
      type: input.type,
      status: input.status,
      source: input.source ?? null,
      source_url: input.source_url ?? null,
      selected_source: input.selected_source ?? null,
      selected_url: input.selected_url ?? null,
      fallback_used: input.fallback_used ?? false,
      attempted_sources: input.attempted_sources ?? [],
      inserted: input.inserted ?? 0,
      retry: input.retry ?? 0,
      latest_draw_no: input.latest_draw_no ?? null,
      latest_draw_date: input.latest_draw_date ?? null,
      error_message: input.error_message ?? null,
      reason: input.reason ?? null,
      created_at: createdAt,
      started_at: startedAt,
      finished_at: finishedAt,
    }, { merge: true });
  } catch (e) {
    console.warn(`[cloud-sync-log] ${(e as Error).message}`);
  }
}

// Production-integration: capture ensemble-voting diagnostic fields when a prediction is evaluated.
// The fields are pulled from the cached prediction's strategy_scores (no recomputation).
// Stored alongside hit-counts for rolling recent_N observation queries.
const CORE_GROUP = new Set<number>([8, 16, 21, 22, 27]);

function asNumberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}
function asBoolOrNull(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  return null;
}
function asStringOrNull(v: unknown): string | null {
  if (typeof v === 'string') return v;
  return null;
}

export async function evaluatePredictionForDraw(draw: AdapterDraw): Promise<boolean> {
  const adapter = getDatabaseAdapter();
  const prediction = await adapter.getPredictionByDrawNo(draw.draw_no);
  if (!prediction) return false;
  const actual = sortNumbers(draw.numbers);
  const two = numbers(prediction.two_star);
  const three = numbers(prediction.three_star);
  const four = numbers(prediction.four_star);
  const five = numbers(prediction.five_star);
  const ss = (prediction['strategy_scores'] ?? {}) as Record<string, unknown>;
  const core_group_count = five.filter(n => CORE_GROUP.has(n)).length;
  await adapter.saveObservation({
    prediction_id: prediction.id ?? null,
    model_version: prediction.model_version,
    target_draw_no: draw.draw_no,
    target_date: prediction.target_date ?? draw.draw_date,
    latest_used_draw_no: asStringOrNull(prediction['latest_used_draw_no']),
    selected_single: Number(prediction.single_number ?? prediction.single ?? 0),
    selected_two_star: two,
    selected_three_star: three,
    selected_four_star: four,
    selected_five_star: five,
    three_star: three,
    actual_numbers: actual,
    single_hit: actual.includes(Number(prediction.single_number ?? prediction.single ?? 0)),
    two_star_hit: two.length === 2 && two.every(n => actual.includes(n)),
    three_star_hits: hitCount(three, actual),
    four_star_hits: hitCount(four, actual),
    five_star_hits: hitCount(five, actual),
    advice_level: advice(prediction).level,
    advice_label: advice(prediction).label,
    advice: advice(prediction).label,
    confidence: advice(prediction).confidence,
    // ── ensemble / multi_strategy diagnostic snapshot ──────────────────────
    schema: asStringOrNull(ss['anti_hot_selection_schema']),
    multi_strategy_enabled: asBoolOrNull(ss['multi_strategy_enabled']),
    multi_strategy_version: asStringOrNull(ss['multi_strategy_version']),
    ensemble_voting_enabled: asBoolOrNull(ss['ensemble_voting_enabled']),
    ensemble_voting_version: asStringOrNull(ss['ensemble_voting_version']),
    trend_only_count: asNumberOrNull(ss['trend_only_count']),
    trend_only_ratio: asNumberOrNull(ss['trend_only_ratio']),
    dominance_penalty_applied: asNumberOrNull(ss['dominance_penalty_applied']),
    pair_lock_penalty_applied: asNumberOrNull(ss['pair_lock_penalty_applied']),
    triple_lock_penalty_applied: asNumberOrNull(ss['triple_lock_penalty_applied']),
    exposure_penalty_applied: asNumberOrNull(ss['exposure_penalty_applied']),
    core_group_penalty_applied: asNumberOrNull(ss['core_group_penalty_applied']),
    hot_top10_penalty_applied: asNumberOrNull(ss['hot_top10_penalty_applied']),
    consensus_protected_count: asNumberOrNull(ss['consensus_protected_count']),
    core_group_count,
    evaluated_at: new Date().toISOString(),
  });
  return true;
}

async function writeCloudSyncLogForReport(
  type: CloudSyncType,
  startedAt: string,
  report: CloudSyncReport,
  retry: number,
): Promise<void> {
  await writeCloudSyncLog({
    type,
    status: toLogStatus(report.status),
    source: report.activeSource ?? null,
    source_url: report.activeSourceUrl ?? null,
    selected_source: report.selectedSource ?? null,
    selected_url: report.selectedUrl ?? null,
    fallback_used: report.fallbackUsed ?? false,
    attempted_sources: report.attemptedSources ?? [],
    inserted: report.newDrawsInserted,
    retry,
    latest_draw_no: report.latestDrawNo,
    latest_draw_date: report.latestDrawDate,
    error_message: report.errors.length ? report.errors.join('\n') : null,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  });
}

function toLogStatus(status: CloudSyncReport['status']): CloudSyncLogStatus {
  if (status === 'SUCCESS' || status === 'NO_NEW_DATA') return 'success';
  if (status === 'PENDING_OFFICIAL') return 'pending';
  return 'failed';
}

function hitCount(pick: number[], actual: number[]): number {
  return pick.filter(n => actual.includes(n)).length;
}

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? sortNumbers(value.map(Number).filter(Number.isFinite)) : [];
}

function advice(prediction: AdapterPrediction): { level: string; label: string; confidence: string } {
  const raw = prediction.bet_advice;
  return {
    level: String(raw?.level ?? ''),
    label: String(raw?.label ?? prediction['advice_label'] ?? ''),
    confidence: String(raw?.confidence ?? prediction.confidence ?? ''),
  };
}
