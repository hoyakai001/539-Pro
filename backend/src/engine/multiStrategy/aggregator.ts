/**
 * multiStrategy/aggregator.ts — Ensemble 聚合器 + 重新挑選
 *
 * 規則：
 *   1. 每個 strategy 的 score map 個別 min-max normalize 到 0-100
 *   2. final[n] = sum_s ( weight[s] * normalized[s][n] )
 *   3. tie-break: same final score 比較號碼小者優先（deterministic）
 *   4. 重新挑 single/two/three/four/five_star，遵守 max_hot_ratio / min_mid_cold_ratio
 *   5. 永不刪號（01-39 全保留）
 *   6. 若 ensemble 無法滿足比例硬性 (e.g. mid+cold pool 不夠)，soft 退回（盡力，不 throw）
 */

import type { DrawEntry } from '../features';
import type { MultiStrategyConfig } from './config';
import type {
  EnsembleResult,
  PerNumberScores,
  ReRankedPicks,
  StrategyName,
  StrategyVote,
} from './types';

const ALL_NUMBERS = Array.from({ length: 39 }, (_, i) => i + 1);

function normalize(scores: PerNumberScores): PerNumberScores {
  const values = ALL_NUMBERS.map(n => scores[n] ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const out: PerNumberScores = {};
  if (max - min < 1e-9) {
    for (const n of ALL_NUMBERS) out[n] = 0;
    return out;
  }
  for (const n of ALL_NUMBERS) out[n] = ((scores[n] ?? 0) - min) / (max - min) * 100;
  return out;
}

export function aggregate(
  votes: Record<StrategyName, StrategyVote>,
  config: MultiStrategyConfig,
): EnsembleResult {
  const normalized: Record<StrategyName, PerNumberScores> = {
    trend: normalize(votes.trend.scores),
    balance: normalize(votes.balance.scores),
    anti_concentration: normalize(votes.anti_concentration.scores),
    reversion: normalize(votes.reversion.scores),
    coverage: normalize(votes.coverage.scores),
  };

  const finalScores: PerNumberScores = {};
  for (const n of ALL_NUMBERS) {
    finalScores[n] =
      config.weights.trend * (normalized.trend[n] ?? 0) +
      config.weights.balance * (normalized.balance[n] ?? 0) +
      config.weights.anti_concentration * (normalized.anti_concentration[n] ?? 0) +
      config.weights.reversion * (normalized.reversion[n] ?? 0) +
      config.weights.coverage * (normalized.coverage[n] ?? 0);
  }

  // contributions：各 strategy 加權貢獻總量（用於 diagnostic）
  const contributions: Record<StrategyName, number> = {
    trend: 0,
    balance: 0,
    anti_concentration: 0,
    reversion: 0,
    coverage: 0,
  };
  for (const n of ALL_NUMBERS) {
    contributions.trend += config.weights.trend * (normalized.trend[n] ?? 0);
    contributions.balance += config.weights.balance * (normalized.balance[n] ?? 0);
    contributions.anti_concentration += config.weights.anti_concentration * (normalized.anti_concentration[n] ?? 0);
    contributions.reversion += config.weights.reversion * (normalized.reversion[n] ?? 0);
    contributions.coverage += config.weights.coverage * (normalized.coverage[n] ?? 0);
  }

  return {
    finalScores,
    contributions,
    weights: { ...config.weights },
    rawScoresByStrategy: {
      trend: votes.trend.scores,
      balance: votes.balance.scores,
      anti_concentration: votes.anti_concentration.scores,
      reversion: votes.reversion.scores,
      coverage: votes.coverage.scores,
    },
  };
}

/** 由 baseline 60 期頻率分出 hot / mid / cold tier */
export function classifyTiers(draws: DrawEntry[], windowSize = 60): {
  hot: Set<number>; mid: Set<number>; cold: Set<number>;
} {
  const window = draws.slice(0, Math.min(windowSize, draws.length));
  const counts: Record<number, number> = {};
  for (const n of ALL_NUMBERS) counts[n] = 0;
  for (const d of window) for (const n of d.numbers) counts[n] = (counts[n] ?? 0) + 1;
  const sorted = [...ALL_NUMBERS].sort((a, b) => {
    const diff = (counts[b] ?? 0) - (counts[a] ?? 0);
    return diff !== 0 ? diff : a - b;  // tie-break: 號碼小者前
  });
  return {
    hot: new Set(sorted.slice(0, 10)),
    cold: new Set(sorted.slice(26)),  // 39-13=26..39 = 13 cold
    mid: new Set(sorted.slice(10, 26)),
  };
}

/**
 * 重新挑選 single / two / three / four / five_star。
 * 遵守 max_hot_ratio (五星中 hot 號 <= floor(5 * ratio))。
 * 同分 tie-break：number 小者先（deterministic）。
 */
export function rerank(
  finalScores: PerNumberScores,
  draws: DrawEntry[],
  config: MultiStrategyConfig,
): ReRankedPicks & { swapCount: number; hotCountInFive: number } {
  const tiers = classifyTiers(draws);
  // 全 39 號排名
  const ranked = [...ALL_NUMBERS].sort((a, b) => {
    const diff = (finalScores[b] ?? 0) - (finalScores[a] ?? 0);
    return Math.abs(diff) > 1e-9 ? diff : a - b;
  });

  // 先取 raw five
  let five = ranked.slice(0, 5);
  let swapCount = 0;
  const maxHot = Math.floor(5 * config.maxHotRatio);  // ex 0.6 -> 3
  const minMidCold = Math.max(0, 5 - maxHot);          // 至少 2
  let hotCount = five.filter(n => tiers.hot.has(n)).length;

  // 若 hot 過多，把超出的 hot 號（從末位往前換）替換為 ranked list 中下一個 mid/cold
  if (hotCount > maxHot) {
    // 由低分往高分掃 five，找出可以被 swap 的 hot
    const fiveByLowestFirst = [...five].reverse();
    for (const candidateOut of fiveByLowestFirst) {
      if (hotCount <= maxHot) break;
      if (!tiers.hot.has(candidateOut)) continue;
      // 找 ranked 第一個非 hot 且不在 five 內的
      const swapIn = ranked.find(n => !tiers.hot.has(n) && !five.includes(n));
      if (swapIn === undefined) break;
      five = five.map(n => n === candidateOut ? swapIn : n);
      hotCount = five.filter(n => tiers.hot.has(n)).length;
      swapCount++;
    }
  }

  // 維持「五星包含三星包含二星包含 single」的傳統巢狀
  const inFiveOrder = five.sort((a, b) => {
    const diff = (finalScores[b] ?? 0) - (finalScores[a] ?? 0);
    return Math.abs(diff) > 1e-9 ? diff : a - b;
  });
  const single = inFiveOrder[0];
  const two_star = inFiveOrder.slice(0, 2);
  const three_star = inFiveOrder.slice(0, 3);
  const four_star = inFiveOrder.slice(0, 4);
  const five_star = inFiveOrder.slice(0, 5);

  void minMidCold; // 不直接 enforce min（透過 max_hot 反向達成）

  return {
    single,
    two_star,
    three_star,
    four_star,
    five_star,
    swapCount,
    hotCountInFive: hotCount,
  };
}
