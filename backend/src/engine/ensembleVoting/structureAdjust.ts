/**
 * structureAdjust.ts — 輕量結構修正（soft adjustment）
 *
 * 設計原則：
 *   - 不是新策略；不是 ranking 來源
 *   - 對 metaVoting 的 final_vote_score 套乘性微調倍率（範圍受 STRUCTURE_ADJUST_WEIGHT 限制）
 *   - 預設關閉（STRUCTURE_ADJUST_ENABLED=false）
 *   - 全部 deterministic：相同 inputs → 相同 outputs；不使用隨機數、無 hardcoded 號碼
 *   - 不禁用任何號碼、不指定號碼、不規定區間/連號/冷號必須存在
 *   - 倍率上下界由 W 控制；W=0.10 → [0.90, 1.10]、W=0.20 → [0.80, 1.20]
 *
 * 5 個 soft signals（每個產出 01-39 的 score ∈ [-1, +1]，平均後乘以 W 加到 1.0）：
 *
 *   1. tail_balance       — 該號的尾數最近 N 期是否過度/不足出現於 five_star
 *   2. zone_rotation      — 該號所在的 4 個區間（1-10/11-20/21-30/31-39）是否過度/不足
 *   3. gap_reversion      — 該號離上一次實際開出的期數（用 draws，不是 prediction）
 *   4. parity_balance     — 奇/偶 + 大(≥20)/小(<20)
 *   5. consecutive_fatigue— 該號附近（n-1, n+1）最近 N 期被推薦次數
 *
 * 訊號 = + 表示「應該稍加分」、- 表示「應該稍降分」、0 表示「沒意見」。
 * 5 個訊號平均後乘以 W：final_factor = 1 + W * mean_signal，clamp 到 [1-W, 1+W]。
 */

import type { DrawEntry } from '../features';
import type { EnsembleVotingConfig } from './config';
import type { PerNumberScores, RecentRecommendation } from './types';

const ALL_NUMBERS = Array.from({ length: 39 }, (_, i) => i + 1);

function emptyScores(initial = 0): PerNumberScores {
  const m: PerNumberScores = {};
  for (const n of ALL_NUMBERS) m[n] = initial;
  return m;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ─── 1. Tail balance ─────────────────────────────────────────────────────
// 統計最近 N 期 five_star 各尾數（0-9）出現次數。期望 = total / 10。
// signal = (expected - actual) / max(1, expected)，clamp [-1, +1]
function tailBalanceSignals(recent: RecentRecommendation[], window: number): PerNumberScores {
  const counts = new Array(10).fill(0);
  let total = 0;
  for (const r of recent.slice(0, window)) {
    for (const n of r.five_star ?? []) {
      counts[n % 10]++;
      total++;
    }
  }
  const expected = total > 0 ? total / 10 : 0;
  const signals = emptyScores();
  if (expected <= 0) return signals;
  for (const n of ALL_NUMBERS) {
    const c = counts[n % 10];
    signals[n] = clamp((expected - c) / Math.max(1, expected), -1, 1);
  }
  return signals;
}

// ─── 2. Zone rotation ────────────────────────────────────────────────────
// 4 個 zone：1-10、11-20、21-30、31-39。期望 = total / 4。
function zoneRotationSignals(recent: RecentRecommendation[], window: number): PerNumberScores {
  const counts = [0, 0, 0, 0];
  let total = 0;
  for (const r of recent.slice(0, window)) {
    for (const n of r.five_star ?? []) {
      const zone = n <= 10 ? 0 : n <= 20 ? 1 : n <= 30 ? 2 : 3;
      counts[zone]++;
      total++;
    }
  }
  const expected = total > 0 ? total / 4 : 0;
  const signals = emptyScores();
  if (expected <= 0) return signals;
  for (const n of ALL_NUMBERS) {
    const zone = n <= 10 ? 0 : n <= 20 ? 1 : n <= 30 ? 2 : 3;
    signals[n] = clamp((expected - counts[zone]) / Math.max(1, expected), -1, 1);
  }
  return signals;
}

// ─── 3. Gap reversion ────────────────────────────────────────────────────
// 用實際歷史 draws：算每個號碼最近一次出現是幾期前（current_gap）。
// 期望平均 gap = 39/5 = 7.8 期一次。
// signal = (current_gap - expected) / expected，clamp [-1, +1]。
// gap 越大 → signal 越大（鼓勵回補）。完全沒出現過 → signal = +1（上限）。
function gapReversionSignals(draws: DrawEntry[], lookback: number): PerNumberScores {
  const recentDraws = draws.slice(0, Math.min(lookback, draws.length));
  const lastSeen: Record<number, number> = {};
  for (let i = 0; i < recentDraws.length; i++) {
    for (const n of recentDraws[i].numbers) {
      if (lastSeen[n] === undefined) lastSeen[n] = i;  // i=0 是最新一期
    }
  }
  const expected = 39 / 5;  // 7.8
  const signals = emptyScores();
  for (const n of ALL_NUMBERS) {
    const gap = lastSeen[n] !== undefined ? lastSeen[n] : recentDraws.length;
    signals[n] = clamp((gap - expected) / Math.max(1, expected), -1, 1);
  }
  return signals;
}

// ─── 4. Parity / Big-Small balance ───────────────────────────────────────
// 同時看奇偶與大小比例。期望各佔一半。
// 4 種組合：odd-small / odd-big / even-small / even-big，期望 = total / 4。
function parityBalanceSignals(recent: RecentRecommendation[], window: number): PerNumberScores {
  const counts = [0, 0, 0, 0];
  let total = 0;
  function bucket(n: number): number {
    const odd = n % 2 === 1 ? 0 : 1;     // 0=odd, 1=even
    const big = n >= 20 ? 1 : 0;         // 0=small, 1=big
    return odd * 2 + big;
  }
  for (const r of recent.slice(0, window)) {
    for (const n of r.five_star ?? []) {
      counts[bucket(n)]++;
      total++;
    }
  }
  const expected = total > 0 ? total / 4 : 0;
  const signals = emptyScores();
  if (expected <= 0) return signals;
  for (const n of ALL_NUMBERS) {
    signals[n] = clamp((expected - counts[bucket(n)]) / Math.max(1, expected), -1, 1);
  }
  return signals;
}

// ─── 5. Consecutive fatigue ──────────────────────────────────────────────
// 統計最近 N 期 five_star 中該號相鄰號（n-1, n+1）被推薦次數。
// 越高 → signal 越負（連號疲勞）。
function consecutiveFatigueSignals(recent: RecentRecommendation[], window: number): PerNumberScores {
  const adjacentHits: Record<number, number> = {};
  for (const n of ALL_NUMBERS) adjacentHits[n] = 0;
  for (const r of recent.slice(0, window)) {
    const five = new Set(r.five_star ?? []);
    for (const n of ALL_NUMBERS) {
      if (five.has(n - 1)) adjacentHits[n]++;
      if (five.has(n + 1)) adjacentHits[n]++;
    }
  }
  // 期望：每期 5 個號最多 8 個相鄰位置 → window 期累計 ≈ window × (5×2/39) per number
  const maxExpected = Math.max(1, recent.length * 2);
  const signals = emptyScores();
  for (const n of ALL_NUMBERS) {
    signals[n] = clamp(-adjacentHits[n] / maxExpected, -1, 1);
  }
  return signals;
}

export interface StructureFactorResult {
  /** 每個 01-39 的最終倍率（範圍 [1 - W, 1 + W]），用來乘 final_vote_score */
  factors: PerNumberScores;
  /** 每個訊號的原始 score（diagnostic 用） */
  signals: {
    tail: PerNumberScores;
    zone: PerNumberScores;
    gap: PerNumberScores;
    parity: PerNumberScores;
    consecutive: PerNumberScores;
  };
  /** 套用倍率（factor != 1.0）的號碼數 */
  applied_count: number;
  /** 平均倍率（diagnostic） */
  mean_factor: number;
}

/**
 * 主要入口：給定當下的歷史資料 + 最近 prediction 紀錄，產出每個 01-39 的乘性倍率。
 * 不可變動：純函數，相同 inputs → 相同 outputs。
 */
export function computeStructureFactor(
  draws: DrawEntry[],
  recent: RecentRecommendation[],
  config: EnsembleVotingConfig,
): StructureFactorResult {
  const window = Math.max(5, Math.min(30, recent.length));
  const tail = tailBalanceSignals(recent, window);
  const zone = zoneRotationSignals(recent, window);
  const gap = gapReversionSignals(draws, 100);
  const parity = parityBalanceSignals(recent, window);
  const consecutive = consecutiveFatigueSignals(recent, window);

  const factors = emptyScores(1);
  const W = config.structureAdjustWeight;
  let applied = 0;
  let sum = 0;
  for (const n of ALL_NUMBERS) {
    const mean = (tail[n] + zone[n] + gap[n] + parity[n] + consecutive[n]) / 5;
    const factor = clamp(1 + W * mean, 1 - W, 1 + W);
    factors[n] = factor;
    sum += factor;
    if (Math.abs(factor - 1.0) > 1e-9) applied++;
  }
  return {
    factors,
    signals: { tail, zone, gap, parity, consecutive },
    applied_count: applied,
    mean_factor: sum / 39,
  };
}
