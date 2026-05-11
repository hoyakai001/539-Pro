/**
 * multiStrategy/strategies.ts — 5 個策略的計分函式
 *
 * 共同契約：
 *   - 輸入：baselineScores (01-39 normalized 0-100，由 baseline number_scores 拆出)
 *           draws (歷史，最新在前)
 *           recent (最近 N 期推薦組合)
 *   - 輸出：StrategyVote { scores: 1-39 → number, diagnostic }
 *   - 所有 01-39 都必須有對應 score（不可缺號）
 *   - 不可使用隨機數 / 不可硬編碼禁號 / 不可黑名單
 *   - 全部 deterministic：同 input → 同 output
 */

import type { DrawEntry } from '../features';
import type { MultiStrategyConfig } from './config';
import type { PerNumberScores, RecentRecommendation, StrategyVote } from './types';

const ALL_NUMBERS = Array.from({ length: 39 }, (_, i) => i + 1);

function emptyScores(): PerNumberScores {
  const m: PerNumberScores = {};
  for (const n of ALL_NUMBERS) m[n] = 0;
  return m;
}

// ─── 1. Trend Strategy ─────────────────────────────────────────────────
// 直接沿用 baseline normalized_score；保留現行高分熱號與 pair/triple 統計價值。
export function trendStrategy(baselineScores: PerNumberScores): StrategyVote {
  const scores = emptyScores();
  for (const n of ALL_NUMBERS) scores[n] = baselineScores[n] ?? 0;
  return {
    name: 'trend',
    scores,
    diagnostic: { source: 'baseline_normalized_score' },
  };
}

// ─── 2. Balance Strategy ───────────────────────────────────────────────
// 對 baseline 中過熱（Top10 出現比例過高）的號碼乘以衰減因子；對中溫號略加成。
// 不下調冷號分數；不加任何號碼到 selectedFive 之外。
export function balanceStrategy(
  baselineScores: PerNumberScores,
  draws: DrawEntry[],
  windowSize = 60,
): StrategyVote {
  const window = draws.slice(0, Math.min(windowSize, draws.length));
  const totalSlots = window.length * 5;
  const counts: Record<number, number> = {};
  for (const n of ALL_NUMBERS) counts[n] = 0;
  for (const d of window) for (const n of d.numbers) counts[n] = (counts[n] ?? 0) + 1;

  const expected = totalSlots / 39;  // 平均期望出現次數
  // 比 expected 高出 30% 視為偏熱；比 expected 低 30% 視為偏冷
  const HOT_THRESHOLD = expected * 1.30;
  const COLD_THRESHOLD = expected * 0.70;

  const scores = emptyScores();
  let hotAdjusted = 0;
  let midBoosted = 0;
  for (const n of ALL_NUMBERS) {
    const base = baselineScores[n] ?? 0;
    const c = counts[n];
    if (c > HOT_THRESHOLD) {
      // soft 衰減：依 over-ratio 線性，最多 0.30 衰減
      const over = (c - HOT_THRESHOLD) / Math.max(1, expected);
      const factor = Math.max(0.70, 1 - 0.30 * Math.min(1, over));
      scores[n] = base * factor;
      hotAdjusted++;
    } else if (c < COLD_THRESHOLD) {
      // 不主動下調冷號，但給予極小加成（避免完全淹沒）
      scores[n] = base * 1.02;
    } else {
      // mid 號略加成（讓中溫有機會被選）
      scores[n] = base * 1.05;
      midBoosted++;
    }
  }
  return {
    name: 'balance',
    scores,
    diagnostic: {
      window: window.length,
      hot_threshold_count: hotAdjusted,
      mid_boosted_count: midBoosted,
      expected_per_number: round(expected),
    },
  };
}

// ─── 3. Anti-Concentration Strategy ─────────────────────────────────────
// 對最近 N 期 prediction 推薦的號碼、pair、triple 做 soft penalty。
// 全部使用乘性 factor，不刪號碼。
export function antiConcentrationStrategy(
  baselineScores: PerNumberScores,
  recent: RecentRecommendation[],
  config: MultiStrategyConfig,
): StrategyVote {
  const window = recent.slice(0, config.recentRecommendWindow);
  // 號碼出現次數
  const numberHits: Record<number, number> = {};
  for (const n of ALL_NUMBERS) numberHits[n] = 0;
  for (const r of window) {
    for (const n of new Set(r.five_star)) numberHits[n] = (numberHits[n] ?? 0) + 1;
  }
  // pair / triple 重複次數
  const pairHits: Record<string, number> = {};
  const tripleHits: Record<string, number> = {};
  for (const r of window) {
    const five = [...new Set(r.five_star)].sort((a, b) => a - b);
    for (let i = 0; i < five.length; i++) {
      for (let j = i + 1; j < five.length; j++) {
        const k = `${five[i]},${five[j]}`;
        pairHits[k] = (pairHits[k] ?? 0) + 1;
        for (let m = j + 1; m < five.length; m++) {
          const t = `${five[i]},${five[j]},${five[m]}`;
          tripleHits[t] = (tripleHits[t] ?? 0) + 1;
        }
      }
    }
  }

  const scores = emptyScores();
  let penalizedNumberCount = 0;
  for (const n of ALL_NUMBERS) {
    const base = baselineScores[n] ?? 0;
    const hits = numberHits[n] ?? 0;
    if (hits === 0) {
      scores[n] = base;
    } else {
      // 每次出現衰減 8%，但不低於 baseline * 0.65（保留候選資格）
      const factor = Math.max(0.65, Math.pow(0.92, hits));
      scores[n] = base * factor;
      penalizedNumberCount++;
    }
  }
  return {
    name: 'anti_concentration',
    scores,
    diagnostic: {
      window: window.length,
      penalized_number_count: penalizedNumberCount,
      max_pair_repeat: Math.max(0, ...Object.values(pairHits)),
      max_triple_repeat: Math.max(0, ...Object.values(tripleHits)),
      pair_repeat_penalty_factor: config.pairRepeatPenalty,
      triple_repeat_penalty_factor: config.tripleRepeatPenalty,
    },
  };
}

// ─── 4. Reversion Strategy ──────────────────────────────────────────────
// 對長期低曝光 + 仍有 baseline 支撐（>= minSupportFactor * Top1）的號碼加成。
// 不對沒支撐的號碼硬上。
export function reversionStrategy(
  baselineScores: PerNumberScores,
  draws: DrawEntry[],
  recent: RecentRecommendation[],
  config: MultiStrategyConfig,
): StrategyVote {
  const recentWindow = draws.slice(0, Math.min(30, draws.length));
  const windowSlots = recentWindow.length * 5;
  const recentCounts: Record<number, number> = {};
  for (const n of ALL_NUMBERS) recentCounts[n] = 0;
  for (const d of recentWindow) for (const n of d.numbers) recentCounts[n] = (recentCounts[n] ?? 0) + 1;

  const recentRecCounts: Record<number, number> = {};
  for (const n of ALL_NUMBERS) recentRecCounts[n] = 0;
  for (const r of recent.slice(0, config.recentRecommendWindow)) {
    for (const n of new Set(r.five_star)) recentRecCounts[n] = (recentRecCounts[n] ?? 0) + 1;
  }

  const sortedBase = [...ALL_NUMBERS].sort((a, b) => (baselineScores[b] ?? 0) - (baselineScores[a] ?? 0));
  const top1Score = baselineScores[sortedBase[0]] ?? 0;
  const supportThreshold = top1Score * config.minSupportFactor;

  const scores = emptyScores();
  let boostedCount = 0;
  for (const n of ALL_NUMBERS) {
    const base = baselineScores[n] ?? 0;
    const drawHits = recentCounts[n] ?? 0;
    const recHits = recentRecCounts[n] ?? 0;
    const lowExposure = drawHits <= Math.max(0, Math.floor(windowSlots / 39 * 0.6)) && recHits === 0;
    const hasSupport = base >= supportThreshold;
    if (lowExposure && hasSupport) {
      scores[n] = base * config.reversionBonus;
      boostedCount++;
    } else {
      scores[n] = base;
    }
  }
  return {
    name: 'reversion',
    scores,
    diagnostic: {
      support_threshold: round(supportThreshold),
      min_support_factor: config.minSupportFactor,
      boosted_count: boostedCount,
      reversion_bonus: config.reversionBonus,
    },
  };
}

// ─── 5. Coverage Strategy ──────────────────────────────────────────────
// 對最近 N 期推薦五星 pool 完全沒出現的號碼加成；增加 distinct combos / 01-39 coverage。
export function coverageStrategy(
  baselineScores: PerNumberScores,
  recent: RecentRecommendation[],
  config: MultiStrategyConfig,
): StrategyVote {
  const window = recent.slice(0, config.recentRecommendWindow);
  const recentPool = new Set<number>();
  for (const r of window) for (const n of r.five_star) recentPool.add(n);

  const scores = emptyScores();
  let boostedCount = 0;
  for (const n of ALL_NUMBERS) {
    const base = baselineScores[n] ?? 0;
    if (!recentPool.has(n) && base > 0) {
      scores[n] = base * config.coverageBonus;
      boostedCount++;
    } else {
      scores[n] = base;
    }
  }
  return {
    name: 'coverage',
    scores,
    diagnostic: {
      window: window.length,
      pool_size: recentPool.size,
      boosted_count: boostedCount,
      coverage_bonus: config.coverageBonus,
    },
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
