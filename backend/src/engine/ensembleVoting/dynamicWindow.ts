/**
 * dynamicWindow.ts — Dynamic Window soft re-weighting (v1)
 *
 * 設計原則：
 *   - 不換策略；不取代 ensemble；不引入 hard switch
 *   - 對 metaVoting 已算出的 final_vote_score 套乘性微調倍率（範圍 [1-W, 1+W]）
 *   - 預設關閉（DYNAMIC_WINDOW_ENABLED=false）
 *   - 全部 deterministic：相同輸入 → 相同輸出；不使用隨機數、不 hardcoded 號碼
 *   - 不禁用任何號碼、不指定號碼、不規定區間 / 連號 / 冷號必須存在
 *
 * 訊號設計：
 *   每個 01-39 在「過去 N 期真實開獎」中出現的次數，跨多個 window 加權平均後正規化。
 *   這個訊號**反映真實命中**（不是 prediction recommendation 頻率），與 ensemble 內既有
 *   `anti_concentration` / `coverage`（看推薦頻率）不衝突；與 `reversion`（看 100 期 z-score）
 *   方向相近但採用多視窗加權，能對「短中期狀態切換」做 soft 適應。
 *
 *   window weights（可由 ENV 覆蓋）：
 *     w_30 = 0.35, w_60 = 0.30, w_70 = 0.20, w_80 = 0.15
 *   選擇依據：adaptive backtest 顯示這 4 個 window 是 hit_rate 訊號最強的。
 *
 *   factor[n] = clamp(1 + W × normalized_score[n], 1 - W, 1 + W)
 *
 *   normalized_score[n] = (raw[n] - median) / max_abs_deviation
 *     → 接近最常出現號碼: 接近 +1；接近最冷號碼: 接近 -1；中位數: 0
 *
 *   套用前置條件（dormant guard）：
 *     - draws.length < DYNAMIC_WINDOW_MIN_OBSERVATIONS（預設 30）→ factor 全 1.0（no-op）
 *     這避免「資料不夠時瞎猜」。
 *
 * Rollback：
 *   - 設 DYNAMIC_WINDOW_ENABLED=false 或 DYNAMIC_WINDOW_WEIGHT=0 → 完全 no-op
 *   - cache schema 隨 ENV 變動自動失效
 */

import type { DrawEntry } from '../features';
import type { EnsembleVotingConfig } from './config';
import type { PerNumberScores } from './types';

const ALL_NUMBERS = Array.from({ length: 39 }, (_, i) => i + 1);

function emptyScores(initial = 0): PerNumberScores {
  const m: PerNumberScores = {};
  for (const n of ALL_NUMBERS) m[n] = initial;
  return m;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function countOccurrences(draws: DrawEntry[], window: number): PerNumberScores {
  const counts = emptyScores();
  const slice = draws.slice(0, Math.min(window, draws.length));
  for (const d of slice) {
    for (const n of d.numbers) {
      if (n >= 1 && n <= 39) counts[n]++;
    }
  }
  return counts;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface DynamicWindowResult {
  factors: PerNumberScores;
  /** 每個 01-39 的 normalized score（diagnostic） */
  scores: PerNumberScores;
  /** 啟用時填的 windows 與權重 */
  windows: { window: number; weight: number }[];
  /** 套用倍率（factor != 1.0）的號碼數 */
  applied_count: number;
  /** 平均 factor */
  mean_factor: number;
  /** dormant 原因（若 dormant）；否則 null */
  dormant_reason: string | null;
}

/**
 * 主入口：計算 per-number dynamic window factor。
 *
 * @param draws 真實歷史開獎（最新在前）
 * @param config ensemble config（含 DYNAMIC_WINDOW_* 設定）
 */
export function computeDynamicWindowFactor(
  draws: DrawEntry[],
  config: EnsembleVotingConfig,
): DynamicWindowResult {
  const noop: DynamicWindowResult = {
    factors: emptyScores(1),
    scores: emptyScores(0),
    windows: [],
    applied_count: 0,
    mean_factor: 1.0,
    dormant_reason: null,
  };
  if (!config.dynamicWindowEnabled || config.dynamicWindowWeight <= 0) {
    noop.dormant_reason = 'feature disabled';
    return noop;
  }
  if (!draws || draws.length < config.dynamicWindowMinObservations) {
    noop.dormant_reason = `insufficient draws (${draws?.length ?? 0} < ${config.dynamicWindowMinObservations})`;
    return noop;
  }

  // 加總多視窗 hit count。每個 window 的 count 先 normalize 到該 window 的 mean=0、再乘 weight 加總
  const windows = config.dynamicWindowWeights;
  const raw = emptyScores(0);
  for (const { window, weight } of windows) {
    if (window < 1 || weight <= 0) continue;
    const counts = countOccurrences(draws, window);
    const values = ALL_NUMBERS.map(n => counts[n]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    for (const n of ALL_NUMBERS) {
      // 用 mean-centered 累加（不在每個 window 裡 z-score，因為 stdev 在低樣本 noise 太大）
      raw[n] += weight * (counts[n] - mean);
    }
  }

  // 把 raw 正規化到 [-1, +1]：以 raw 中位數為 0，最大絕對偏差為 1
  const rawValues = ALL_NUMBERS.map(n => raw[n]);
  const med = median(rawValues);
  let maxDev = 0;
  for (const v of rawValues) {
    const d = Math.abs(v - med);
    if (d > maxDev) maxDev = d;
  }
  if (maxDev <= 1e-9) {
    // 全部相同 → 無訊號 → no-op
    noop.dormant_reason = 'no signal (uniform raw)';
    return noop;
  }

  const W = config.dynamicWindowWeight;
  const factors = emptyScores(1);
  const scores = emptyScores(0);
  let applied = 0;
  let sum = 0;
  for (const n of ALL_NUMBERS) {
    const normalized = clamp((raw[n] - med) / maxDev, -1, 1);
    scores[n] = normalized;
    const factor = clamp(1 + W * normalized, 1 - W, 1 + W);
    factors[n] = factor;
    sum += factor;
    if (Math.abs(factor - 1.0) > 1e-9) applied++;
  }

  return {
    factors,
    scores,
    windows,
    applied_count: applied,
    mean_factor: sum / 39,
    dormant_reason: null,
  };
}
