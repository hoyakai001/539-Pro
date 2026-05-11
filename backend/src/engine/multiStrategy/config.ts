/**
 * multiStrategy/config.ts — ENV 讀取 + 預設值
 *
 * 預設值與 README / .env.example 一致；所有 ENV 都是可選，未設時走預設。
 * Deterministic：同樣 ENV 配置必然得到同樣權重與結果。
 */

export const MULTI_STRATEGY_DEFAULT_VERSION = 'multi_strategy_v1';

export interface MultiStrategyConfig {
  enabled: boolean;
  version: string;
  weights: {
    trend: number;
    balance: number;
    anti_concentration: number;
    reversion: number;
    coverage: number;
  };
  weightsSum: number;        // 原始總和（normalize 前）
  minSupportFactor: number;  // reversion 最低分數門檻（0-1，相對 baseline normalized_score）
  maxHotRatio: number;       // five_star 中 hot 號比例上限
  minMidColdRatio: number;   // five_star 中 mid+cold 號比例下限
  recentRecommendWindow: number;
  pairRepeatPenalty: number;
  tripleRepeatPenalty: number;
  reversionBonus: number;
  coverageBonus: number;
}

function num(envKey: string, defaultValue: number): number {
  const raw = process.env[envKey];
  if (raw === undefined || raw === null || String(raw).trim() === '') return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function isMultiStrategyEnabled(): boolean {
  const v = (process.env['MULTI_STRATEGY_ENABLED'] ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

export function getMultiStrategyConfig(): MultiStrategyConfig {
  const rawWeights = {
    trend: Math.max(0, num('STRATEGY_WEIGHT_TREND', 0.35)),
    balance: Math.max(0, num('STRATEGY_WEIGHT_BALANCE', 0.20)),
    anti_concentration: Math.max(0, num('STRATEGY_WEIGHT_ANTI_CONCENTRATION', 0.20)),
    reversion: Math.max(0, num('STRATEGY_WEIGHT_REVERSION', 0.15)),
    coverage: Math.max(0, num('STRATEGY_WEIGHT_COVERAGE', 0.10)),
  };
  const sum = rawWeights.trend + rawWeights.balance + rawWeights.anti_concentration + rawWeights.reversion + rawWeights.coverage;
  // Normalize to sum=1.0; if user sets all zero (degenerate) fall back to default trend-only.
  const weights = sum > 0
    ? {
      trend: rawWeights.trend / sum,
      balance: rawWeights.balance / sum,
      anti_concentration: rawWeights.anti_concentration / sum,
      reversion: rawWeights.reversion / sum,
      coverage: rawWeights.coverage / sum,
    }
    : { trend: 1, balance: 0, anti_concentration: 0, reversion: 0, coverage: 0 };

  return {
    enabled: isMultiStrategyEnabled(),
    version: process.env['MULTI_STRATEGY_VERSION'] || MULTI_STRATEGY_DEFAULT_VERSION,
    weights,
    weightsSum: sum,
    minSupportFactor: clamp01(num('MULTI_STRATEGY_MIN_SUPPORT_FACTOR', 0.40)),
    maxHotRatio: clamp01(num('MULTI_STRATEGY_MAX_HOT_RATIO', 0.60)),
    minMidColdRatio: clamp01(num('MULTI_STRATEGY_MIN_MID_COLD_RATIO', 0.40)),
    recentRecommendWindow: Math.max(0, Math.trunc(num('MULTI_STRATEGY_RECENT_RECOMMEND_WINDOW', 5))),
    pairRepeatPenalty: clamp01(num('MULTI_STRATEGY_PAIR_REPEAT_PENALTY', 0.88)),
    tripleRepeatPenalty: clamp01(num('MULTI_STRATEGY_TRIPLE_REPEAT_PENALTY', 0.82)),
    reversionBonus: Math.max(1, num('MULTI_STRATEGY_REVERSION_BONUS', 1.08)),
    coverageBonus: Math.max(1, num('MULTI_STRATEGY_COVERAGE_BONUS', 1.06)),
  };
}
