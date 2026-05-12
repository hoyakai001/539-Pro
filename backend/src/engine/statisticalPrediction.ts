import type { DrawEntry } from './features';
import type { BacktestRow } from '../db/database';
import { comboKey, sortNumbers } from '../utils/numbers';
import {
  buildScoredPredictionModel,
  RECENT_WEIGHTED_SCORING_SCHEMA,
  runThreeStarMainBacktest,
  type AdvancedBacktestResult,
  type AntiHotSelectionPenaltySummary,
  type CombinationRepeatSummary,
  type DrawProfile,
  type HotControlSummary,
  type MissPenaltySummary,
  type NumberAnalysisRow,
  type PreviousPredictionContext,
  type ThreeStarSummary,
  type TrackingSummary,
} from './AdvancedStatsModel';
import { applyMultiStrategy, isMultiStrategyEnabled, MULTI_STRATEGY_DEFAULT_VERSION } from './multiStrategy';
import {
  applyEnsembleVoting,
  isEnsembleVotingEnabled,
  ENSEMBLE_VOTING_DEFAULT_VERSION,
} from './ensembleVoting';

export const HISTORICAL_MODEL_VERSION = 'v6.1-three-star-stable';
// PREDICTION_CACHE_SCHEMA: 同 baseline RECENT_WEIGHTED_SCORING_SCHEMA。
// 啟用 multi-strategy 時於 schema 後綴 `+multi_strategy_v1`；
// 啟用 ensemble_voting 時再追加 `+ensemble_voting_v1`，舊 cache 自動失效。
// Rollback（任一 ENV 關閉）後 schema 自動回到對應的較淺層，舊 cache 重新生效。
function computeCacheSchema(): string {
  let s: string = RECENT_WEIGHTED_SCORING_SCHEMA;
  if (isMultiStrategyEnabled()) {
    s = `${s}+${process.env['MULTI_STRATEGY_VERSION'] || MULTI_STRATEGY_DEFAULT_VERSION}`;
  }
  if (isEnsembleVotingEnabled()) {
    s = `${s}+${process.env['ENSEMBLE_VOTING_VERSION'] || ENSEMBLE_VOTING_DEFAULT_VERSION}`;
  }
  // Dynamic Window 啟用時加 schema 後綴，舊 cache 自動失效
  const dwEnabled = ((process.env['DYNAMIC_WINDOW_ENABLED'] ?? '').trim().toLowerCase() === 'true'
    || process.env['DYNAMIC_WINDOW_ENABLED'] === '1');
  if (dwEnabled) {
    s = `${s}+${process.env['DYNAMIC_WINDOW_VERSION'] || 'dynamic_window_v1'}`;
  }
  return s;
}
export const PREDICTION_CACHE_SCHEMA: string = computeCacheSchema();

/**
 * TransparentNumberScore：sqlite / Firestore / API 對外的單號分析欄位。
 * baseline / multi_strategy_v1 從不寫入 ensemble_* 欄位；只有 ensemble_voting_v1
 * 啟用時這些可選欄位才會被填入。frontend 不應依賴它們的存在。
 */
export interface TransparentNumberScore extends NumberAnalysisRow {
  // ─── ensemble_voting_v1 diagnostic（皆 optional；未啟用時為 undefined） ───
  ensemble_votes?: number;
  support_strategies?: number;
  trend_vote?: number;
  balance_vote?: number;
  anti_concentration_vote?: number;
  reversion_vote?: number;
  coverage_vote?: number;
  cross_strategy_consensus?: number;
  dominance_penalty?: number;
  pair_lock_penalty?: number;
  triple_lock_penalty?: number;
  recent_number_exposure?: number;
  core_group_exposure?: number;
  exposure_penalty?: number;
  core_group_penalty?: number;
  hot_top10_penalty?: number;
  structure_factor?: number;
  dynamic_window_factor?: number;
  consensus_protected?: boolean;
  final_vote_score?: number;
  final_vote_rank?: number;
}

export interface BetAdvice {
  score: number;
  advice_score: number;
  level: 'STRONG' | 'SMALL' | 'WATCH' | 'AVOID';
  label: string;
  confidence: string;
  reason_text: string;
  risk_flags: string[];
}

export interface StatisticalPrediction {
  target_date: string;
  target_draw_no?: string | null;
  latest_used_draw_no: string;
  latest_used_draw_date: string;
  single_number: number;
  single: number;
  two_star: number[];
  three_star: number[];
  four_star: number[];
  five_star: number[];
  numbers: number[];
  number_scores: TransparentNumberScore[];
  number_scores_json: TransparentNumberScore[];
  strategy_scores: Record<string, number | string | boolean>;
  balance_summary: unknown;
  hot_control_summary: HotControlSummary;
  combination_repeat_summary: CombinationRepeatSummary;
  miss_penalty_summary: MissPenaltySummary;
  draw_profile: DrawProfile;
  three_star_summary: ThreeStarSummary;
  tracking_summary: TrackingSummary;
  anti_hot_selection_penalty_summary: AntiHotSelectionPenaltySummary;
  bet_advice: BetAdvice;
  confidence_label: string;
  recommendation: string;
  model_version: string;
  strategy: string;
  anti_hot_selection_schema: string;
  data_status: 'VALID';
}

export function buildStatisticalPrediction(
  draws: DrawEntry[],
  targetDate: string,
  recentBacktests: BacktestRow[] = [],
  backtestDecision?: AdvancedBacktestResult,
  previousPrediction?: PreviousPredictionContext | null,
): StatisticalPrediction {
  if (draws.length < 100) throw new Error(`at least 100 verified draws are required, got ${draws.length}`);
  const decision = backtestDecision ?? (draws.length >= 200
    ? runThreeStarMainBacktest(draws)
    : {
      advanced_stats_enabled: false,
      three_star_main_enabled: false,
      decision: 'disabled' as const,
      improvement: false,
      reason: '近期驗證樣本不足，系統已改用較穩定的統計權重',
      base_model: emptyMetrics(),
      advanced_model: emptyMetrics(),
      three_star_main_model: emptyMetrics(),
      latest_included_draw_no: draws[0]?.draw_no ?? null,
      sample_size: 0,
    });
  const threeStarMainEnabled = decision.three_star_main_enabled;

  const model = buildScoredPredictionModel(draws, {
    includeOverheat: true,
    advancedStatsEnabled: threeStarMainEnabled,
    useThreeStarCore: threeStarMainEnabled,
    recentBacktests,
    previousPrediction: previousPrediction ?? null,
  });
  const selectedPair = model.two_star;
  const bet_advice = buildBetAdvice(model, threeStarMainEnabled);

  const baselineResult: StatisticalPrediction = {
    target_date: targetDate,
    latest_used_draw_no: draws[0].draw_no,
    latest_used_draw_date: draws[0].draw_date,
    single_number: model.single_number,
    single: model.single_number,
    two_star: sortNumbers(model.two_star),
    three_star: sortNumbers(model.three_star),
    four_star: sortNumbers(model.four_star),
    five_star: sortNumbers(model.five_star),
    numbers: sortNumbers(model.numbers),
    number_scores: model.number_scores,
    number_scores_json: model.number_scores,
    strategy_scores: {
      ...model.strategy_scores,
      advice_score: bet_advice.score,
      draw_profile: model.draw_profile.label,
      tracking_enabled: model.tracking_summary.enabled,
      advanced_stats_enabled: threeStarMainEnabled,
      three_star_main_enabled: threeStarMainEnabled,
      three_star_main_decision: decision.decision,
      three_star_main_reason: decision.reason,
      three_star_main_backtest_sample_size: decision.sample_size,
      three_star_main_latest_included_draw_no: decision.latest_included_draw_no ?? '',
      multi_strategy_enabled: false,
      multi_strategy_version: 'baseline',
      anti_hot_selection_schema: PREDICTION_CACHE_SCHEMA,
    },
    balance_summary: model.balance_summary,
    hot_control_summary: model.hot_control_summary,
    combination_repeat_summary: model.combination_repeat_summary,
    miss_penalty_summary: model.miss_penalty_summary,
    draw_profile: model.draw_profile,
    three_star_summary: model.three_star_summary,
    tracking_summary: model.tracking_summary,
    anti_hot_selection_penalty_summary: model.anti_hot_selection_penalty_summary,
    bet_advice,
    confidence_label: bet_advice.confidence,
    recommendation: bet_advice.label,
    model_version: HISTORICAL_MODEL_VERSION,
    strategy: `${threeStarMainEnabled ? 'recent-window-three-star-main' : 'recent-window-fallback-base'}:${comboKey(selectedPair)}`,
    anti_hot_selection_schema: PREDICTION_CACHE_SCHEMA,
    data_status: 'VALID',
  };

  // multi_strategy_v1 ensemble layer (ENV-gated; baseline returned as-is when disabled)
  const { prediction: afterMulti } = applyMultiStrategy(baselineResult, draws, previousPrediction ?? null);
  // ensemble_voting_v1 final arbitration layer (ENV-gated; defaults to off; baseline + multi_strategy_v1 preserved)
  const { prediction } = applyEnsembleVoting(afterMulti, draws, previousPrediction ?? null);
  return prediction;
}

function buildBetAdvice(model: ReturnType<typeof buildScoredPredictionModel>, threeStarMainEnabled: boolean): BetAdvice {
  const rows = model.number_scores;
  const topScore = rows[0]?.normalized_score ?? 0;
  const top10Score = rows[9]?.normalized_score ?? rows[rows.length - 1]?.normalized_score ?? topScore;
  const selectedFive = rows.filter(row => row.selected_in_five_star);
  const overheatedSelected = selectedFive.filter(row => row.overheat_score < 0).length;
  const repeatSummary = model.combination_repeat_summary;
  const missSummary = model.miss_penalty_summary;
  const selectionPenalty = model.anti_hot_selection_penalty_summary;
  const comboFatigueAdjusted =
    model.three_star_summary.pair_fatigue_factor < 1 ||
    model.three_star_summary.triple_fatigue_factor < 1;
  const recommendationRepeatAdjusted =
    model.three_star_summary.pair_recommendation_repeat_factor < 1 ||
    model.three_star_summary.triple_recommendation_repeat_factor < 1;
  const extraShortTermOverheatAdjusted = model.three_star_summary.last10_overheat_triggered;
  const freshnessBalanced =
    model.three_star_summary.pair_freshness_bonus > 1 ||
    model.three_star_summary.triple_freshness_bonus > 1;
  const risk_flags: string[] = [];

  const threeStrength = clamp(model.three_star_summary.three_star_score / 100 * 25, 0, 25);
  const pairStrength = clamp(model.three_star_summary.main_pair_score / 100 * 15, 0, 15);
  const concentration = clamp((topScore - top10Score) / 20 * 15, 0, 15);
  const balanceScore = model.balance_summary.commonPattern ? 15 : 7;
  const overheatControl = overheatedSelected <= 1 ? 10 : overheatedSelected <= 3 ? 7 : 4;
  const repeatControl = repeatSummary.three_star_overlap < 3 && repeatSummary.five_star_overlap < 4 ? 10 : 3;
  const backtestEffective = threeStarMainEnabled ? 10 : 4;

  let score = threeStrength + pairStrength + concentration + balanceScore + overheatControl + repeatControl + backtestEffective;
  const missTotal =
    missSummary.two_star_miss_penalty +
    missSummary.three_star_miss_penalty +
    missSummary.four_star_miss_penalty +
    missSummary.five_star_miss_penalty;
  const top10HotTooMany = model.hot_control_summary.top10_hot_count > model.hot_control_summary.threshold;
  const threeStructureNormal =
    model.three_star_summary.three_star_score >= 55 &&
    model.three_star_summary.main_pair_score >= 45 &&
    model.three_star_summary.third_number_pair_support_score >= 35;
  const pairEffective = model.three_star_summary.main_pair_score >= 45;
  const balanceNormal = model.balance_summary.commonPattern !== false;
  const severeRepeat = repeatSummary.three_star_overlap === 3 || repeatSummary.five_star_overlap >= 4;
  const extremeProfile =
    (model.draw_profile.type === 'hot' && (model.hot_control_summary.top10_hot_count >= 9 || overheatedSelected >= 4)) ||
    (model.draw_profile.type === 'cold' && model.draw_profile.cold_count >= 3);

  if (repeatSummary.three_star_overlap === 3) {
    score -= 15;
    risk_flags.push('三星與前次完全重複');
  }
  if (repeatSummary.five_star_overlap >= 4) {
    score -= 15;
    risk_flags.push('五星與前次重疊偏高');
  }
  if (overheatedSelected >= 4) {
    score -= 10;
    risk_flags.push('近期熱門號比例偏高，已做平衡調整');
  } else if (overheatedSelected >= 2) {
    score -= 4;
    risk_flags.push('部分近期熱門號已做平衡調整');
  } else if (overheatedSelected === 1) {
    risk_flags.push('有1個近期熱門號已做平衡調整');
  }
  if (!model.balance_summary.commonPattern) {
    score -= 6;
    risk_flags.push('本期組合分布略偏離近期常見型態');
  }
  if (model.draw_profile.type !== 'normal') {
    score -= extremeProfile ? 6 : 3;
    risk_flags.push(`本期型態${model.draw_profile.label}`);
  }
  if (missTotal < 0) {
    score -= 10;
    risk_flags.push('前次未中組合已降低權重');
  }
  if (top10HotTooMany) {
    score -= 4;
    risk_flags.push('近期熱門號比例偏高，已做平衡調整');
  }
  if (selectionPenalty.enabled && selectionPenalty.penalized_numbers.length) {
    risk_flags.push('近期連續出現的號碼已降低權重');
  }
  if (comboFatigueAdjusted) {
    risk_flags.push('近期部分組合連續出現較多，系統已自動降低其重複影響');
  }
  if (recommendationRepeatAdjusted) {
    risk_flags.push('近期本日抓牌組合重複率較高，系統已自動平衡組合集中度');
  }
  if (extraShortTermOverheatAdjusted) {
    risk_flags.push('近期部分號碼過熱，系統已做短期平衡調整。');
  }
  if (freshnessBalanced) {
    risk_flags.push('近期推薦組合集中度較高，系統已適度增加組合輪替平衡。');
  }
  if (!threeStarMainEnabled) {
    score -= 4;
    risk_flags.push('近期進階模型表現不穩，已降低其影響');
  }

  score = round(clamp(score, 0, 100));
  const avoidAllowed =
    extremeProfile &&
    !threeStructureNormal &&
    (severeRepeat || missTotal < 0 || overheatedSelected >= 4) &&
    score < 42;
  if (!avoidAllowed && threeStructureNormal && pairEffective && balanceNormal && score < 42) score = 42;

  let level: BetAdvice['level'] =
    score >= 82 ? 'STRONG' :
    score >= 62 ? 'SMALL' :
    score >= 42 ? 'WATCH' :
    'AVOID';
  if (level === 'AVOID' && !avoidAllowed) {
    level = 'WATCH';
    score = Math.max(score, 42);
  }
  const labelByLevel: Record<BetAdvice['level'], string> = {
    STRONG: '強攻',
    SMALL: '小攻',
    WATCH: '觀望',
    AVOID: '不建議',
  };
  const confidence =
    level === 'STRONG' && risk_flags.length <= 1 ? '高' :
    level === 'SMALL' || (level === 'WATCH' && threeStructureNormal && pairEffective) ? '中' :
    '低';
  const reason_text = buildAdviceReason(level, labelByLevel[level], score, model);

  return {
    score,
    advice_score: score,
    level,
    label: labelByLevel[level],
    confidence,
    reason_text,
    risk_flags,
  };
}

function buildAdviceReason(level: BetAdvice['level'], label: string, score: number, model: ReturnType<typeof buildScoredPredictionModel>): string {
  if (level === 'STRONG') {
    return `主力三星與二星支撐都偏強，平衡檢查可接受，建議${label}。`;
  }
  if (level === 'SMALL') {
    return `主力組合有二星支撐，整體偏穩，建議${label}。`;
  }
  if (level === 'WATCH') {
    return `本期仍有可用三星結構，但近期波動較大，建議先${label}。`;
  }
  return `本期型態較極端且三星結構偏弱，建議${label}。`;
}

function emptyMetrics() {
  return {
    hitRateTwo: 0,
    hitRateThree: 0,
    hitRateFour: 0,
    hitRateFive: 0,
    avgHits: 0,
    maxLoseStreak: 0,
    sample_size: 0,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
