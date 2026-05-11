/**
 * ensembleVoting/config.ts — ENV 讀取與預設值
 *
 * 所有 ENV 都是可選；未設時走預設。
 * Deterministic：同樣 ENV → 同樣結果，永不使用隨機。
 */

export const ENSEMBLE_VOTING_DEFAULT_VERSION = 'ensemble_voting_v1';

export interface EnsembleVotingConfig {
  enabled: boolean;
  version: string;
  /** 每個 strategy 各自選的 top-K 候選數（投票才會被計入） */
  topK: number;
  /** 一個號碼至少需要被幾個 strategy 支持，才不會被 dominance_penalty 削弱 */
  minSupportStrategies: number;
  /** trend-only 號碼的 dominance penalty 倍率（0-1） */
  trendOnlyPenalty: number;
  /** final top10 中允許的 trend-only 比例上限 */
  maxTrendOnlyTop10Ratio: number;
  /** pair lock penalty 倍率（0-1） */
  pairLockPenalty: number;
  /** triple lock penalty 倍率（0-1） */
  tripleLockPenalty: number;
  /** dominance / pair / triple lock 計算的回看視窗（最近 N 期 prediction） */
  dominanceWindow: number;
  pairLockWindow: number;
  pairLockMaxRepeat: number;
  tripleLockWindow: number;
  tripleLockMaxRepeat: number;
  /** coverage strategy 的目標 01-39 數（通常就是 39） */
  coverageTarget: number;
  /** 單一 strategy 在 final top10 的最大 dominance 比例（diagnostic only） */
  maxSingleStrategyDominance: number;
  /** 各 strategy 的 meta vote 權重（normalize 後加總 1.0） */
  strategyWeights: {
    trend: number;
    balance: number;
    anti_concentration: number;
    reversion: number;
    coverage: number;
  };

  // ─── Phase 2.5：核心群控制 / 號碼曝光控制 ─────────────────────────────
  /** 統計 recent_number_exposure 的視窗（最近幾期 prediction five_star） */
  numberExposureWindow: number;
  /** 該視窗內被選入 five_star 幾次（含）以上開始套 exposure_penalty */
  numberExposureMaxRepeat: number;
  /** exposure_penalty 倍率（0-1，每超出 1 次乘一次） */
  numberExposurePenalty: number;
  /** final top10 中 trend-topK 號碼比例上限；超過 → 套 hot_top10_penalty */
  hotTop10MaxRatio: number;
  /** hot_top10_penalty 倍率（0-1，乘性 soft penalty） */
  hotTop10Penalty: number;
  /** core_group_penalty 倍率（針對在 three_star 視窗中過度曝光的號） */
  coreGroupPenalty: number;
  /** core_group 統計的視窗（最近幾期 prediction three_star） */
  coreGroupWindow: number;
  /** 該視窗內 three_star 出現幾次（含）以上開始套 core_group_penalty */
  coreGroupMaxExposure: number;
  /** 跨策略共識保護：support_strategy_count >= 此值 → 降低 exposure / core / hot_top10 懲罰嚴重度 */
  consensusProtectionMinSupport: number;
  /** 嚴重度降低係數（0-1）：penalty -> 1 + (penalty - 1) * factor。0=完全保護、1=不保護 */
  consensusProtectionFactor: number;
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

function intMin(n: number, min: number): number {
  return Math.max(min, Math.trunc(n));
}

export function isEnsembleVotingEnabled(): boolean {
  const v = (process.env['ENSEMBLE_VOTING_ENABLED'] ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

export function getEnsembleVotingConfig(): EnsembleVotingConfig {
  const rawWeights = {
    trend: Math.max(0, num('ENSEMBLE_STRATEGY_WEIGHT_TREND', 0.22)),
    balance: Math.max(0, num('ENSEMBLE_STRATEGY_WEIGHT_BALANCE', 0.22)),
    anti_concentration: Math.max(0, num('ENSEMBLE_STRATEGY_WEIGHT_ANTI_CONCENTRATION', 0.22)),
    reversion: Math.max(0, num('ENSEMBLE_STRATEGY_WEIGHT_REVERSION', 0.17)),
    coverage: Math.max(0, num('ENSEMBLE_STRATEGY_WEIGHT_COVERAGE', 0.17)),
  };
  const sum = rawWeights.trend + rawWeights.balance + rawWeights.anti_concentration + rawWeights.reversion + rawWeights.coverage;
  const strategyWeights = sum > 0
    ? {
      trend: rawWeights.trend / sum,
      balance: rawWeights.balance / sum,
      anti_concentration: rawWeights.anti_concentration / sum,
      reversion: rawWeights.reversion / sum,
      coverage: rawWeights.coverage / sum,
    }
    : { trend: 0.2, balance: 0.2, anti_concentration: 0.2, reversion: 0.2, coverage: 0.2 };

  return {
    enabled: isEnsembleVotingEnabled(),
    version: process.env['ENSEMBLE_VOTING_VERSION'] || ENSEMBLE_VOTING_DEFAULT_VERSION,
    topK: intMin(num('ENSEMBLE_TOP_K', 10), 5),
    minSupportStrategies: intMin(num('ENSEMBLE_MIN_SUPPORT_STRATEGIES', 2), 1),
    trendOnlyPenalty: clamp01(num('ENSEMBLE_TREND_ONLY_PENALTY', 0.72)),
    maxTrendOnlyTop10Ratio: clamp01(num('ENSEMBLE_MAX_TREND_ONLY_TOP10_RATIO', 0.35)),
    pairLockPenalty: clamp01(num('ENSEMBLE_PAIR_LOCK_PENALTY', 0.82)),
    tripleLockPenalty: clamp01(num('ENSEMBLE_TRIPLE_LOCK_PENALTY', 0.78)),
    dominanceWindow: intMin(num('ENSEMBLE_DOMINANCE_WINDOW', 5), 1),
    pairLockWindow: intMin(num('ENSEMBLE_PAIR_LOCK_WINDOW', 5), 1),
    pairLockMaxRepeat: intMin(num('ENSEMBLE_PAIR_LOCK_MAX_REPEAT', 2), 1),
    tripleLockWindow: intMin(num('ENSEMBLE_TRIPLE_LOCK_WINDOW', 5), 1),
    tripleLockMaxRepeat: intMin(num('ENSEMBLE_TRIPLE_LOCK_MAX_REPEAT', 1), 1),
    coverageTarget: intMin(num('ENSEMBLE_COVERAGE_TARGET', 39), 5),
    maxSingleStrategyDominance: clamp01(num('ENSEMBLE_MAX_SINGLE_STRATEGY_DOMINANCE', 0.40)),
    strategyWeights,
    // Phase 2.5: number-level exposure / core_group / hot_top10 / consensus protection
    numberExposureWindow: intMin(num('ENSEMBLE_NUMBER_EXPOSURE_WINDOW', 10), 1),
    numberExposureMaxRepeat: intMin(num('ENSEMBLE_NUMBER_EXPOSURE_MAX_REPEAT', 4), 1),
    numberExposurePenalty: clamp01(num('ENSEMBLE_NUMBER_EXPOSURE_PENALTY', 0.80)),
    hotTop10MaxRatio: clamp01(num('ENSEMBLE_HOT_TOP10_MAX_RATIO', 0.35)),
    hotTop10Penalty: clamp01(num('ENSEMBLE_HOT_TOP10_PENALTY', 0.84)),
    coreGroupPenalty: clamp01(num('ENSEMBLE_CORE_GROUP_PENALTY', 0.82)),
    coreGroupWindow: intMin(num('ENSEMBLE_CORE_GROUP_WINDOW', 10), 1),
    coreGroupMaxExposure: intMin(num('ENSEMBLE_CORE_GROUP_MAX_EXPOSURE', 4), 1),
    consensusProtectionMinSupport: intMin(num('ENSEMBLE_CONSENSUS_PROTECTION_MIN_SUPPORT', 3), 1),
    consensusProtectionFactor: clamp01(num('ENSEMBLE_CONSENSUS_PROTECTION_FACTOR', 0.50)),
  };
}
