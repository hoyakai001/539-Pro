import type { BacktestRow, DrawRow } from '../db/database';
import type { DrawEntry } from './features';
import { evaluateBalance } from './BalanceModel';
import { computeSingleStats, computeTailStats, computeTwoStarStats, rowsToStatEntries } from '../stats/historicalStats';
import { combinations, comboKey, sortNumbers } from '../utils/numbers';

export const ADVANCED_STATS_WEIGHT = 0.15;
export const REDUCED_ADVANCED_STATS_WEIGHT = 0.05;
export const RECENT_SCORING_WEIGHTS = {
  count10: 0.25,
  count20: 0.30,
  count30: 0.30,
  count50: 0.10,
  count100: 0.05,
} as const;
export const RECENT_WEIGHTED_SCORING_SCHEMA = 'recent_weighted_scoring_single_rotation_structure_fatigue_v1';
const RECOMMENDATION_REPEAT_WINDOW = 5;
const RECOMMENDATION_REPEAT_MIN_SAMPLE = 3;
const COMBO_SUPPORT_SMOOTHING_THRESHOLD = 60;
const COMBO_SUPPORT_SMOOTHING_SLOPE = 0.45;
// Single (獨支) soft rotation — used by selectSingleWithRotation.
// All factors are deterministic, monotonic, never below 0.80, and only kick in
// when (a) sample size has enough recent records and (b) rank #1 vs #2 raw_total_score
// gap is small enough that rotation is a fair fight. If rank #1 is clearly ahead
// (gap ≥ SINGLE_TOP1_DOMINANCE_GAP_RATIO of #1 score), no rotation — rank #1 wins.
const SINGLE_REPEAT_WINDOW = 5;
const SINGLE_REPEAT_MIN_SAMPLE = 3;
const SINGLE_TOP1_DOMINANCE_GAP_RATIO = 0.05;
const SINGLE_CANDIDATE_POOL_SIZE = 10;
// Candidate pool diversification — soft tier classification used only at final combo selection.
// All 39 numbers stay candidates; X-tier is still selectable, just receives no diversification bonus.
// v4_restore_1: rolled back from Plan B (A=5 / B count10≤4) to the original v4 settings because
// backtest showed Plan B reduced 5-star coverage and distinct combos without a meaningful gain
// in top-1 rotation. v4 values below are the validated baseline. Do NOT tune these again unless
// you re-run the backtest harness and the user explicitly approves the change.
const POOL_A_MAX_RANK = 6;
const POOL_B_MAX_RANK = 18;
const POOL_B_MAX_HOT_COUNT = 3;
const POOL_C_MAX_RANK = 30;
const POOL_C_MIN_SCORE_RATIO = 0.40;
// Top-score non-linear compression — applied to final_score (relative to per-call max) BEFORE
// anti-hot. Compresses only the top ratio band so a multiplicative anti-hot factor can finally
// flip ranking when count10 / hot signals trigger. Below 75% of max → unchanged.
// Piecewise linear breakpoints (input pct → output pct of max):
//   75→75 (untouched), 85→80 (light), 95→82 (medium), 100→84 (heavy).
// v4_restore_1: rolled back the Plan B 95-100 slope nudge (0.45) to the original v4 value (0.40)
// because backtest showed it didn't produce meaningful additional rotation. Slopes and outputs
// here are the validated v4 baseline.
// Deterministic, monotonic, no randomness, no blacklist.
const TOP_COMPRESSION_THRESHOLD_PCT = 75;
const TOP_COMPRESSION_LIGHT_PCT = 85;
const TOP_COMPRESSION_MEDIUM_PCT = 95;
const TOP_COMPRESSION_LIGHT_OUTPUT = 80;
const TOP_COMPRESSION_MEDIUM_OUTPUT = 82;
const TOP_COMPRESSION_HEAVY_OUTPUT = 84;
const TOP_COMPRESSION_LIGHT_SLOPE = 0.5;
const TOP_COMPRESSION_MEDIUM_SLOPE = 0.2;
const TOP_COMPRESSION_HEAVY_SLOPE = 0.40;
export const THREE_STAR_WEIGHTS = {
  main_pair_score: 0.35,
  third_number_pair_support_score: 0.25,
  triple_history_score: 0.15,
  number_strength_score: 0.10,
  gap_reversion_score: 0.07,
  balance_overheat_score: 0.08,
} as const;

const MODEL_WINDOW = 100;
const TOP10_HOT_THRESHOLD = 6;

export interface NumberAnalysisRow {
  number: number;
  count10: number;
  count20: number;
  count30: number;
  count50: number;
  count100: number;
  last10_count: number;
  last20_count: number;
  last30_count: number;
  last10_miss: boolean;
  last20_miss: boolean;
  last30_miss: boolean;
  mean100: number;
  std100: number;
  last_seen_draw_no: string | null;
  last_seen_date: string | null;
  gap: number;
  gap_status: string;
  gap_reversion_bonus: number;
  consecutive_hit_count: number;
  consecutive_penalty: number;
  hotness_penalty: number;
  overheat_score: number;
  overheat_reason: string;
  recent_hit_count: number;
  original_score: number;
  compressed_score: number;
  antihot_factor: number;
  anti_hot_adjusted_score: number;
  antihot_reason: string;
  recent_selection_window_hit_count: number;
  selection_score_before_penalty: number;
  selection_score_after_penalty: number;
  selection_penalty_factor: number;
  selection_penalty_reason: string;
  hot_number: boolean;
  hot_control_penalty: number;
  conditional_score: number;
  pattern_score: number;
  gap_reversion_score: number;
  triple_score: number;
  advanced_score: number;
  advanced_stats_weight: number;
  advanced_score_adjusted: number;
  tracking_score: number;
  frequency_score: number;
  gap_score: number;
  tail_score: number;
  pair_score: number;
  repeat_score: number;
  balance_score: number;
  backtest_score: number;
  base_score: number;
  final_score: number;
  raw_total_score: number;
  normalized_score: number;
  total_score: number;
  rank: number;
  odd_even_balance_score: number;
  big_small_balance_score: number;
  zone_balance_score: number;
  tail_balance_score: number;
  consecutive_score: number;
  repeat_overlap_score: number;
  total_balance_score: number;
  selected_in_single: boolean;
  selected_in_two_star: boolean;
  selected_in_three_star: boolean;
  selected_in_four_star: boolean;
  selected_in_five_star: boolean;
  overlap_with_latest: boolean;
  overlap_with_previous: boolean;
  reason_text: string;
  simple_reason_text: string;
  balance_reason_text: string;
}

export interface NumberAnalysisSummaryRow {
  rank: number;
  number: number;
  normalized_score: number;
  count100: number;
  recent_hit_count: number;
  antihot_factor: number;
  antihot_reason: string;
  last10_count: number;
  last20_count: number;
  last30_count: number;
  last10_miss: boolean;
  last20_miss: boolean;
  last30_miss: boolean;
  gap: number;
  simple_reason_text: string;
}

export interface DrawProfile {
  type: 'hot' | 'cold' | 'normal';
  label: '偏熱' | '偏冷' | '正常';
  reason_text: string;
  hot_count: number;
  cold_count: number;
  balanced_count: number;
}

export interface TrackingSummary {
  enabled: boolean;
  tracking_status: '等待上一期結果' | '追蹤中' | '未啟用';
  previous_prediction_id: number | null;
  previous_prediction_available: boolean;
  previous_result_available: boolean;
  previous_three_star_hits: number | null;
  retained_numbers: number[];
  tracking_score: number;
  weight: number;
  reason_text: string;
}

export interface HotControlSummary {
  top10_hot_count: number;
  threshold: number;
  max_allowed_hot_count: number;
  adjusted: boolean;
  reason_text: string;
}

export interface ThreeStarCandidateScore {
  numbers: number[];
  sources: string[];
  main_pair: number[];
  main_pair_score: number;
  third_number_pair_support_score: number;
  triple_history_score: number;
  number_strength_score: number;
  gap_reversion_score: number;
  balance_overheat_score: number;
  tracking_score: number;
  combination_penalty: number;
  miss_penalty: number;
  pair_fatigue_factor: number;
  triple_fatigue_factor: number;
  pair_repeat_count: number;
  triple_repeat_count: number;
  recommendation_repeat_window: number;
  recommended_pair_repeat_count: number;
  recommended_triple_repeat_count: number;
  pair_recommendation_repeat_factor: number;
  triple_recommendation_repeat_factor: number;
  recommendation_repeat_ratio: number;
  recommendation_repeat_sample_size: number;
  recommendation_repeat_sample_size_insufficient: boolean;
  pair_score_before_smoothing: number;
  pair_score_after_smoothing: number;
  triple_score_before_smoothing: number;
  triple_score_after_smoothing: number;
  extra_overheat_factor: number;
  last10_overheat_triggered: boolean;
  pair_freshness_bonus: number;
  triple_freshness_bonus: number;
  pair_recent_recommendation_count: number;
  triple_recent_recommendation_count: number;
  three_star_score: number;
  reason_text: string;
}

export interface ThreeStarSummary {
  selected_three_star: number[];
  top_candidates: ThreeStarCandidateScore[];
  main_pair_score: number;
  third_number_pair_support_score: number;
  triple_history_score: number;
  number_strength_score: number;
  gap_reversion_score: number;
  balance_overheat_score: number;
  pair_fatigue_factor: number;
  triple_fatigue_factor: number;
  pair_repeat_count: number;
  triple_repeat_count: number;
  recommendation_repeat_window: number;
  recommended_pair_repeat_count: number;
  recommended_triple_repeat_count: number;
  pair_recommendation_repeat_factor: number;
  triple_recommendation_repeat_factor: number;
  recommendation_repeat_ratio: number;
  recommendation_repeat_sample_size: number;
  recommendation_repeat_sample_size_insufficient: boolean;
  pair_score_before_smoothing: number;
  pair_score_after_smoothing: number;
  triple_score_before_smoothing: number;
  triple_score_after_smoothing: number;
  extra_overheat_factor: number;
  last10_overheat_triggered: boolean;
  pair_freshness_bonus: number;
  triple_freshness_bonus: number;
  pair_recent_recommendation_count: number;
  triple_recent_recommendation_count: number;
  three_star_score: number;
  weights: typeof THREE_STAR_WEIGHTS;
  weights_total: number;
  candidate_sources: string[];
  pool_diversification: PoolDiversificationSummary;
  reason_text: string;
}

export interface ScoredPredictionModel {
  single_number: number;
  two_star: number[];
  three_star: number[];
  four_star: number[];
  five_star: number[];
  numbers: number[];
  number_scores: NumberAnalysisRow[];
  strategy_scores: Record<string, number | string | boolean>;
  balance_summary: ReturnType<typeof evaluateBalance>['summary'] & { reason_text: string; hot_stable_cold_mix: string };
  hot_control_summary: HotControlSummary;
  combination_repeat_summary: CombinationRepeatSummary;
  miss_penalty_summary: MissPenaltySummary;
  draw_profile: DrawProfile;
  three_star_summary: ThreeStarSummary;
  tracking_summary: TrackingSummary;
  anti_hot_selection_penalty_summary: AntiHotSelectionPenaltySummary;
  top_score_compression_summary: TopScoreCompressionSummary;
}

export interface AdvancedBacktestMetrics {
  hitRateTwo: number;
  hitRateThree: number;
  hitRateFour: number;
  hitRateFive: number;
  avgHits: number;
  maxLoseStreak: number;
  sample_size: number;
}

export interface AdvancedBacktestResult {
  base_model: AdvancedBacktestMetrics;
  advanced_model: AdvancedBacktestMetrics;
  three_star_main_model: AdvancedBacktestMetrics;
  improvement: boolean;
  advanced_stats_enabled: boolean;
  three_star_main_enabled: boolean;
  decision: 'enabled' | 'disabled';
  reason: string;
  latest_included_draw_no: string | null;
  sample_size: number;
}

interface ScoreOptions {
  includeOverheat: boolean;
  advancedStatsEnabled: boolean;
  useThreeStarCore?: boolean;
  recentBacktests?: BacktestRow[];
  previousPrediction?: PreviousPredictionContext | null;
}

export interface PreviousPredictionContext {
  prediction_id: number;
  target_date: string;
  target_draw_no: string | null;
  two_star: number[];
  three_star: number[];
  four_star: number[];
  five_star: number[];
  actual_numbers: number[] | null;
  recent_observations?: RecentPredictionObservationContext[];
}

export interface RecentPredictionObservationContext {
  target_draw_no: string | null;
  target_date: string;
  selected_single?: number | null;
  selected_two_star: number[];
  selected_three_star: number[];
  selected_four_star: number[];
  selected_five_star: number[];
}

export interface CombinationRepeatSummary {
  previous_prediction_id: number | null;
  previous_target_date: string | null;
  two_star_overlap: number;
  three_star_overlap: number;
  four_star_overlap: number;
  five_star_overlap: number;
  two_star_penalty: number;
  three_star_penalty: number;
  four_star_penalty: number;
  five_star_penalty: number;
  penalties: {
    two_star: number;
    three_star: number;
    four_star: number;
    five_star: number;
  };
  reason_text: string;
}

export interface MissPenaltySummary {
  previous_result_available: boolean;
  previous_hits: { two: number; three: number; four: number; five: number } | null;
  two_star_miss_penalty: number;
  three_star_miss_penalty: number;
  four_star_miss_penalty: number;
  five_star_miss_penalty: number;
  reason_text: string;
}

export interface AntiHotSelectionPenaltySummary {
  schema: typeof RECENT_WEIGHTED_SCORING_SCHEMA;
  enabled: boolean;
  window: number;
  min_factor: number;
  penalized_numbers: number[];
  reason_text: string;
}

type StatEntries = ReturnType<typeof rowsToStatEntries>;
type TwoStats = ReturnType<typeof computeTwoStarStats>;
type ComboKind = 'two_star' | 'three_star' | 'four_star' | 'five_star';

export type PoolTier = 'A' | 'B' | 'C' | 'X';

export interface PoolClassification {
  by_number: Record<number, PoolTier>;
  a_pool: number[];
  b_pool: number[];
  c_pool: number[];
  reason_text: string;
}

export interface PoolDiversificationSummary {
  enabled: boolean;
  classification: PoolClassification;
  two_star_pool_breakdown: { A: number; B: number; C: number; X: number };
  three_star_pool_breakdown: { A: number; B: number; C: number; X: number };
  four_star_pool_breakdown: { A: number; B: number; C: number; X: number };
  five_star_pool_breakdown: { A: number; B: number; C: number; X: number };
  reason_text: string;
}

export interface TopScoreCompressionSummary {
  enabled: boolean;
  max_final_score: number;
  max_compressed_score: number;
  threshold_pct: number;
  breakpoints: { input: number; output: number }[];
  compressed_count: number;
  reason_text: string;
}

interface PrelimRow {
  number: number;
  count10: number;
  count20: number;
  count30: number;
  count50: number;
  count100: number;
  mean100: number;
  std100: number;
  last_seen_draw_no: string | null;
  last_seen_date: string | null;
  gap: number;
  gap_status: string;
  gap_reversion_bonus: number;
  consecutive_hit_count: number;
  consecutive_penalty: number;
  hotness_penalty: number;
  overheat_score: number;
  overheat_reason: string;
  hot_number: boolean;
  hot_control_penalty: number;
  conditional_score: number;
  pattern_score: number;
  gap_reversion_score: number;
  triple_score: number;
  advanced_score: number;
  advanced_score_adjusted: number;
  frequency_score: number;
  gap_score: number;
  tail_score: number;
  pair_score: number;
  repeat_score: number;
  backtest_score: number;
  tracking_score: number;
  noBalanceBase: number;
  preliminary_score: number;
  recent_selection_window_hit_count: number;
  selection_penalty_factor: number;
  selection_score_before_penalty: number;
  selection_score_after_penalty: number;
  selection_penalty_reason: string;
}

interface AntiHotSelectionPenaltyConfig {
  enabled: boolean;
  window: number;
  minFactor: number;
}

interface SelectionResult {
  two_star: number[];
  three_star: number[];
  four_star: number[];
  five_star: number[];
  combination_repeat_summary: CombinationRepeatSummary;
  miss_penalty_summary: MissPenaltySummary;
  three_star_summary: ThreeStarSummary;
  anti_hot_selection_penalty_summary: AntiHotSelectionPenaltySummary;
}

export function buildScoredPredictionModel(draws: DrawEntry[], options: ScoreOptions): ScoredPredictionModel {
  if (draws.length < MODEL_WINDOW) throw new Error(`at least ${MODEL_WINDOW} verified draws are required, got ${draws.length}`);

  const statEntries = rowsToStatEntries(draws.slice(0, MODEL_WINDOW).map(toDrawRow));
  const antiHotConfig = getAntiHotConfig();
  const antiHotSelectionPenaltyConfig = getAntiHotSelectionPenaltyConfig();
  const singleStats = computeSingleStats(statEntries);
  const tailStats = computeTailStats(statEntries);
  const twoStats = computeTwoStarStats(statEntries);
  const latestNums = statEntries[0]?.numbers ?? [];
  const previousNums = statEntries[1]?.numbers ?? [];
  const repeatDist = buildRepeatDistribution(statEntries);
  const counts = singleStats.map(s => s.count100);
  const mean100 = avg(counts);
  const std100 = stddev(counts, mean100);
  const bestPairForTriple = twoStats[0]?.numbers ?? [];
  const backtestScore = averageBacktestScore((options.recentBacktests ?? []).filter(r => [30, 60, 100].includes(r.window_size)));
  const trackingSummary = buildTrackingSummary(options.previousPrediction ?? null);
  const advancedStatsWeight = options.advancedStatsEnabled ? ADVANCED_STATS_WEIGHT : REDUCED_ADVANCED_STATS_WEIGHT;

  const initialRows = singleStats.map(stat => {
    const tail = stat.number % 10;
    const tailStat = tailStats.find(t => t.tail === tail);
    const count20 = countInWindow(statEntries, stat.number, 20);
    const count50 = countInWindow(statEntries, stat.number, 50);
    const gapEval = evaluateGap(stat.currentGap, stat.avgGap, stat.maxGap);
    const frequency_score =
      (stat.count10 / 10) * RECENT_SCORING_WEIGHTS.count10 * 100 +
      (count20 / 20) * RECENT_SCORING_WEIGHTS.count20 * 100 +
      (stat.count30 / 30) * RECENT_SCORING_WEIGHTS.count30 * 100 +
      (count50 / 50) * RECENT_SCORING_WEIGHTS.count50 * 100 +
      (stat.count100 / 100) * RECENT_SCORING_WEIGHTS.count100 * 100;
    const gap_score = gapEval.bonus;
    const tailMean = (statEntries.length * 5) / 10;
    const tail_score = tailStat ? clamp((tailStat.count100 - tailMean) / 5, -3, 5) : 0;
    const pair_score = topPairSupport(stat.number, twoStats);
    const expectedRepeat = repeatAverage(repeatDist);
    const repeat_score = latestNums.includes(stat.number) ? clamp(expectedRepeat - 1.2, -2, 2.5) : 0;
    const backtest_score = backtestScore * 8;
    const antiHotSelectionPenalty = evaluateSelectionPenalty(stat.number, statEntries, 0, antiHotSelectionPenaltyConfig);
    const consecutive_hit_count = consecutiveHitCount(stat.number, statEntries);
    const consecutive_penalty = consecutivePenalty(consecutive_hit_count);
    const hotness_penalty = hotnessPenalty(stat.count100, mean100, std100);
    const overheat_score = clamp(consecutive_penalty + hotness_penalty, -10, 0);
    const overheat_reason = buildOverheatReason(consecutive_hit_count, consecutive_penalty, hotness_penalty);
    const hot_number = stat.count10 >= 2 || overheat_score < 0 || stat.count100 > mean100 + std100;
    const conditional_score = conditionalScore(stat.number, statEntries);
    const pattern_score = patternScore(stat.number, statEntries);
    const triple_score = perNumberTripleScore(stat.number, bestPairForTriple, statEntries);
    const advanced_score = conditional_score + pattern_score + gapEval.advanced + triple_score;
    const advanced_score_adjusted = advanced_score * advancedStatsWeight;
    const tracking_score = trackingNumberBonus(stat.number, trackingSummary, frequency_score + gap_score + pair_score);
    const noBalanceBase = frequency_score + gap_score + tail_score + pair_score + repeat_score + backtest_score;
    const preliminary_score =
      noBalanceBase +
      (options.includeOverheat ? overheat_score : 0) +
      advanced_score_adjusted +
      tracking_score;

    return {
      number: stat.number,
      count10: stat.count10,
      count20,
      count30: stat.count30,
      count50,
      count100: stat.count100,
      mean100,
      std100,
      last_seen_draw_no: stat.lastSeenDrawNo,
      last_seen_date: stat.lastSeenDate,
      gap: stat.currentGap,
      gap_status: gapEval.status,
      gap_reversion_bonus: gapEval.bonus,
      consecutive_hit_count,
      consecutive_penalty,
      hotness_penalty,
      overheat_score,
      overheat_reason,
      hot_number,
      hot_control_penalty: 0,
      conditional_score,
      pattern_score,
      gap_reversion_score: gapEval.advanced,
      triple_score,
      advanced_score,
      advanced_score_adjusted,
      frequency_score,
      gap_score,
      tail_score,
      pair_score,
      repeat_score,
      backtest_score,
      tracking_score,
      noBalanceBase,
      preliminary_score,
      recent_selection_window_hit_count: antiHotSelectionPenalty.recent_hit_count,
      selection_penalty_factor: antiHotSelectionPenalty.factor,
      selection_score_before_penalty: preliminary_score,
      selection_score_after_penalty: preliminary_score,
      selection_penalty_reason: antiHotSelectionPenalty.reason,
    };
  }).sort((a, b) => b.preliminary_score - a.preliminary_score || a.number - b.number);

  const { rows: prelim, summary: hotControlSummary } = applyHotControl(initialRows);
  const selectionRows = applySelectionPenalty(prelim, statEntries, antiHotSelectionPenaltyConfig);

  const selection = options.useThreeStarCore === false
    ? selectLegacyCombinations(selectionRows, statEntries, twoStats, options.previousPrediction ?? null)
    : selectThreeStarCoreCombinations(selectionRows, statEntries, twoStats, options.previousPrediction ?? null, options.includeOverheat, trackingSummary);
  const selectedFive = sortNumbers(selection.five_star);
  const fiveBalance = evaluateBalance(selectedFive, statEntries);

  // Two-pass so we can measure max_final_score across all rows BEFORE applying
  // top-score compression. The compression is the new layer; anti-hot logic
  // itself is unchanged — it just receives the compressed score instead of
  // the raw final_score.
  const intermediates = selectionRows.map(row => {
    const candidate = sortNumbers([...selectedFive.filter(n => n !== row.number).slice(0, 4), row.number]);
    const balance = evaluateBalance(candidate, statEntries);
    const base_score = row.noBalanceBase + balance.total_balance_score + row.tracking_score + row.hot_control_penalty;
    const final_score =
      base_score +
      (options.includeOverheat ? row.overheat_score : 0) +
      row.advanced_score_adjusted;
    return { row, candidate, balance, base_score, final_score };
  });
  const maxFinalScore = Math.max(...intermediates.map(i => i.final_score), 1);
  const compressionFinalScores: number[] = [];
  const compressionCompressedScores: number[] = [];

  const rawRows = intermediates.map(({ row, candidate, balance, base_score, final_score }) => {
    const compressed_score = compressTopScore(final_score, maxFinalScore);
    compressionFinalScores.push(final_score);
    compressionCompressedScores.push(compressed_score);
    const antiHot = evaluateAntiHot(row.number, statEntries, compressed_score, antiHotConfig);
    return {
      number: row.number,
      count10: row.count10,
      count20: row.count20,
      count30: row.count30,
      count50: row.count50,
      count100: row.count100,
      last10_count: row.count10,
      last20_count: row.count20,
      last30_count: row.count30,
      last10_miss: row.count10 === 0,
      last20_miss: row.count20 === 0,
      last30_miss: row.count30 === 0,
      mean100: round(row.mean100),
      std100: round(row.std100),
      last_seen_draw_no: row.last_seen_draw_no,
      last_seen_date: row.last_seen_date,
      gap: row.gap,
      gap_status: row.gap_status,
      gap_reversion_bonus: round(row.gap_reversion_bonus),
      consecutive_hit_count: row.consecutive_hit_count,
      consecutive_penalty: row.consecutive_penalty,
      hotness_penalty: row.hotness_penalty,
      overheat_score: round(row.overheat_score),
      overheat_reason: row.overheat_reason,
      recent_hit_count: antiHot.recent_hit_count,
      original_score: round(final_score),
      compressed_score: round(compressed_score),
      antihot_factor: antiHot.factor,
      anti_hot_adjusted_score: antiHot.adjusted_score,
      antihot_reason: antiHot.reason,
      recent_selection_window_hit_count: row.recent_selection_window_hit_count,
      selection_score_before_penalty: round(row.selection_score_before_penalty),
      selection_score_after_penalty: round(row.selection_score_after_penalty),
      selection_penalty_factor: row.selection_penalty_factor,
      selection_penalty_reason: row.selection_penalty_reason,
      hot_number: row.hot_number,
      hot_control_penalty: round(row.hot_control_penalty),
      conditional_score: round(row.conditional_score),
      pattern_score: round(row.pattern_score),
      gap_reversion_score: round(row.gap_reversion_score),
      triple_score: round(row.triple_score),
      advanced_score: round(row.advanced_score),
      advanced_stats_weight: advancedStatsWeight,
      advanced_score_adjusted: round(row.advanced_score_adjusted),
      tracking_score: round(row.tracking_score),
      frequency_score: round(row.frequency_score),
      gap_score: round(row.gap_score),
      tail_score: round(row.tail_score),
      pair_score: round(row.pair_score),
      repeat_score: round(row.repeat_score),
      balance_score: round(balance.total_balance_score),
      backtest_score: round(row.backtest_score),
      base_score: round(base_score),
      final_score: round(final_score),
      raw_total_score: antiHot.adjusted_score,
      normalized_score: 0,
      total_score: antiHot.adjusted_score,
      rank: 0,
      odd_even_balance_score: balance.odd_even_balance_score,
      big_small_balance_score: balance.big_small_balance_score,
      zone_balance_score: balance.zone_balance_score,
      tail_balance_score: balance.tail_balance_score,
      consecutive_score: balance.consecutive_score,
      repeat_overlap_score: balance.repeat_overlap_score,
      total_balance_score: balance.total_balance_score,
      selected_in_single: false,
      selected_in_two_star: selection.two_star.includes(row.number),
      selected_in_three_star: selection.three_star.includes(row.number),
      selected_in_four_star: selection.four_star.includes(row.number),
      selected_in_five_star: selectedFive.includes(row.number),
      overlap_with_latest: latestNums.includes(row.number),
      overlap_with_previous: previousNums.includes(row.number),
      reason_text: buildReasonText(row),
      simple_reason_text: buildSimpleReasonText(row),
      balance_reason_text: balance.balance_reason_text,
    };
  }).sort((a, b) => b.raw_total_score - a.raw_total_score || a.number - b.number);

  const maxRaw = Math.max(...rawRows.map(row => row.raw_total_score), 1);
  const scored = rawRows.map((row, index) => ({
    ...row,
    normalized_score: round(clamp(row.raw_total_score / maxRaw * 100, 0, 100)),
    total_score: round(clamp(row.raw_total_score / maxRaw * 100, 0, 100)),
    rank: index + 1,
  }));

  const singleSelection = selectSingleWithRotation(scored, options.previousPrediction ?? null);
  const single = singleSelection.number;
  const finalRows = scored.map(row => ({
    ...row,
    selected_in_single: row.number === single,
    selected_in_two_star: selection.two_star.includes(row.number),
    selected_in_three_star: selection.three_star.includes(row.number),
    selected_in_four_star: selection.four_star.includes(row.number),
    selected_in_five_star: selectedFive.includes(row.number),
  }));
  const drawProfile = buildDrawProfile(finalRows, selection.three_star, selectedFive);
  const hotStableColdMix = hotStableColdMixText(finalRows, selectedFive);
  const balanceReason = buildBalanceReason(fiveBalance.summary, hotStableColdMix, hotControlSummary);

  return {
    single_number: single,
    two_star: sortNumbers(selection.two_star),
    three_star: sortNumbers(selection.three_star),
    four_star: sortNumbers(selection.four_star),
    five_star: selectedFive,
    numbers: selectedFive,
    number_scores: finalRows,
    strategy_scores: {
      frequency: round(avg(finalRows.map(s => s.frequency_score))),
      gap: round(avg(finalRows.map(s => s.gap_score))),
      tail: round(avg(finalRows.map(s => s.tail_score))),
      pair: round(avg(finalRows.map(s => s.pair_score))),
      repeat: round(avg(finalRows.map(s => s.repeat_score))),
      balance: round(avg(finalRows.map(s => s.balance_score))),
      backtest: round(avg(finalRows.map(s => s.backtest_score))),
      overheat: round(avg(finalRows.map(s => s.overheat_score))),
      antihot_enabled: antiHotConfig.enabled,
      antihot_window: antiHotConfig.window,
      antihot_min_factor: antiHotConfig.minFactor,
      antihot_average_factor: round(avg(finalRows.map(s => s.antihot_factor))),
      anti_hot_selection_schema: RECENT_WEIGHTED_SCORING_SCHEMA,
      antihot_selection_penalty_enabled: selection.anti_hot_selection_penalty_summary.enabled,
      antihot_selection_penalty_window: selection.anti_hot_selection_penalty_summary.window,
      antihot_selection_min_factor: selection.anti_hot_selection_penalty_summary.min_factor,
      antihot_selection_penalized_numbers: comboKey(selection.anti_hot_selection_penalty_summary.penalized_numbers),
      advanced: round(avg(finalRows.map(s => s.advanced_score_adjusted))),
      tracking: round(avg(finalRows.map(s => s.tracking_score))),
      hot_control_adjusted: hotControlSummary.adjusted,
      advanced_stats_enabled: options.advancedStatsEnabled,
      advanced_stats_weight: advancedStatsWeight,
      advanced_stats_mode: options.advancedStatsEnabled ? 'normal' : 'reduced',
      recent_weight_10: RECENT_SCORING_WEIGHTS.count10,
      recent_weight_20: RECENT_SCORING_WEIGHTS.count20,
      recent_weight_30: RECENT_SCORING_WEIGHTS.count30,
      recent_weight_50: RECENT_SCORING_WEIGHTS.count50,
      recent_weight_100: RECENT_SCORING_WEIGHTS.count100,
      pair_fatigue_factor: selection.three_star_summary.pair_fatigue_factor,
      triple_fatigue_factor: selection.three_star_summary.triple_fatigue_factor,
      pair_repeat_count: selection.three_star_summary.pair_repeat_count,
      triple_repeat_count: selection.three_star_summary.triple_repeat_count,
      recommendation_repeat_window: selection.three_star_summary.recommendation_repeat_window,
      recommended_pair_repeat_count: selection.three_star_summary.recommended_pair_repeat_count,
      recommended_triple_repeat_count: selection.three_star_summary.recommended_triple_repeat_count,
      pair_recommendation_repeat_factor: selection.three_star_summary.pair_recommendation_repeat_factor,
      triple_recommendation_repeat_factor: selection.three_star_summary.triple_recommendation_repeat_factor,
      recommendation_repeat_ratio: selection.three_star_summary.recommendation_repeat_ratio,
      recommendation_repeat_sample_size: selection.three_star_summary.recommendation_repeat_sample_size,
      recommendation_repeat_sample_size_insufficient: selection.three_star_summary.recommendation_repeat_sample_size_insufficient,
      pair_score_before_smoothing: selection.three_star_summary.pair_score_before_smoothing,
      pair_score_after_smoothing: selection.three_star_summary.pair_score_after_smoothing,
      triple_score_before_smoothing: selection.three_star_summary.triple_score_before_smoothing,
      triple_score_after_smoothing: selection.three_star_summary.triple_score_after_smoothing,
      extra_overheat_factor: selection.three_star_summary.extra_overheat_factor,
      last10_overheat_triggered: selection.three_star_summary.last10_overheat_triggered,
      pair_freshness_bonus: selection.three_star_summary.pair_freshness_bonus,
      triple_freshness_bonus: selection.three_star_summary.triple_freshness_bonus,
      pair_recent_recommendation_count: selection.three_star_summary.pair_recent_recommendation_count,
      triple_recent_recommendation_count: selection.three_star_summary.triple_recent_recommendation_count,
      three_star_core_enabled: options.useThreeStarCore !== false,
      three_star_main_enabled: options.useThreeStarCore !== false,
      top_score_compression_enabled: process.env['TOP_SCORE_COMPRESSION_DISABLED'] !== '1',
      top_score_compression_threshold_pct: TOP_COMPRESSION_THRESHOLD_PCT,
      top_score_compressed_count: compressionFinalScores.reduce((acc, fs, i) => acc + (Math.abs(fs - compressionCompressedScores[i]) > 0.005 ? 1 : 0), 0),
      single_selection_method: singleSelection.method,
      single_top1_gap_ratio: singleSelection.top1_gap_ratio,
      single_recent_repeat_count: singleSelection.recent_repeat_count,
      single_repeat_factor_used: singleSelection.repeat_factor_used,
      single_considered_pool_size: singleSelection.considered_pool_size,
    },
    balance_summary: {
      ...fiveBalance.summary,
      hot_stable_cold_mix: hotStableColdMix,
      reason_text: balanceReason,
    },
    hot_control_summary: hotControlSummary,
    combination_repeat_summary: selection.combination_repeat_summary,
    miss_penalty_summary: selection.miss_penalty_summary,
    anti_hot_selection_penalty_summary: selection.anti_hot_selection_penalty_summary,
    draw_profile: drawProfile,
    three_star_summary: selection.three_star_summary,
    tracking_summary: {
      ...trackingSummary,
      tracking_score: round(avg(finalRows.filter(row => row.selected_in_three_star).map(row => row.tracking_score))),
    },
    top_score_compression_summary: buildTopScoreCompressionSummary(
      compressionFinalScores,
      compressionCompressedScores,
    ),
  };
}

export function getNumberAnalysis(draws: DrawEntry[], advancedStatsEnabled: boolean): NumberAnalysisRow[] {
  return buildScoredPredictionModel(draws, {
    includeOverheat: true,
    advancedStatsEnabled,
    useThreeStarCore: true,
    recentBacktests: [],
    previousPrediction: null,
  }).number_scores;
}

export function toNumberAnalysisSummary(rows: NumberAnalysisRow[]): NumberAnalysisSummaryRow[] {
  return rows.map(row => ({
    rank: row.rank,
    number: row.number,
    normalized_score: row.normalized_score,
    count100: row.count100,
    recent_hit_count: row.recent_hit_count,
    antihot_factor: row.antihot_factor,
    antihot_reason: row.antihot_reason,
    last10_count: row.last10_count,
    last20_count: row.last20_count,
    last30_count: row.last30_count,
    last10_miss: row.last10_miss,
    last20_miss: row.last20_miss,
    last30_miss: row.last30_miss,
    gap: row.gap,
    simple_reason_text: row.simple_reason_text,
  }));
}

export function runAdvancedBacktest(allDraws: DrawEntry[]): AdvancedBacktestResult {
  if (allDraws.length < 200) throw new Error(`at least 200 verified draws are required for 100-sample A/B backtest, got ${allDraws.length}`);
  const targets = allDraws.slice(0, MODEL_WINDOW);
  const baseRecords = targets.map((target, index) => {
    const training = allDraws.slice(index + 1, index + 1 + MODEL_WINDOW);
    return evaluateTarget(target, training, {
      includeOverheat: false,
      advancedStatsEnabled: false,
      useThreeStarCore: false,
    });
  });
  const mainRecords = targets.map((target, index) => {
    const training = allDraws.slice(index + 1, index + 1 + MODEL_WINDOW);
    return evaluateTarget(target, training, {
      includeOverheat: true,
      advancedStatsEnabled: true,
      useThreeStarCore: true,
    });
  });

  const base_model = summarizeBacktest(baseRecords);
  const three_star_main_model = summarizeBacktest(mainRecords);
  const improvement =
    three_star_main_model.hitRateThree > base_model.hitRateThree ||
    three_star_main_model.avgHits > base_model.avgHits;
  const maxLoseStreakOk = three_star_main_model.maxLoseStreak <= base_model.maxLoseStreak + 2;
  const enabled = improvement && maxLoseStreakOk;

  return {
    base_model,
    advanced_model: three_star_main_model,
    three_star_main_model,
    improvement,
    advanced_stats_enabled: enabled,
    three_star_main_enabled: enabled,
    decision: enabled ? 'enabled' : 'disabled',
    reason: enabled ? '近期三星主力驗證達標' : '近期三星主力驗證不穩，已降低其影響',
    latest_included_draw_no: targets[0]?.draw_no ?? null,
    sample_size: targets.length,
  };
}

export const runThreeStarMainBacktest = runAdvancedBacktest;

function evaluateTarget(target: DrawEntry, training: DrawEntry[], options: ScoreOptions) {
  const prediction = buildScoredPredictionModel(training, options);
  const actual = sortNumbers(target.numbers);
  return {
    target_draw_no: target.draw_no,
    two: prediction.two_star.every(n => actual.includes(n)) ? 1 : 0,
    three: prediction.three_star.filter(n => actual.includes(n)).length,
    four: prediction.four_star.filter(n => actual.includes(n)).length,
    five: prediction.five_star.filter(n => actual.includes(n)).length,
  };
}

function summarizeBacktest(records: { two: number; three: number; four: number; five: number }[]): AdvancedBacktestMetrics {
  const sample = records.length;
  return {
    hitRateTwo: round(records.filter(r => r.two > 0).length / sample),
    hitRateThree: round(records.filter(r => r.three > 0).length / sample),
    hitRateFour: round(records.filter(r => r.four > 0).length / sample),
    hitRateFive: round(records.filter(r => r.five > 0).length / sample),
    avgHits: round(records.reduce((sum, r) => sum + r.five, 0) / sample),
    maxLoseStreak: maxLoseStreak(records),
    sample_size: sample,
  };
}

// ─── Candidate Pool Diversification ─────────────────────────────────────────
// Soft tier classification applied only at final combo selection.
// - All 39 numbers remain candidates.
// - No random / blacklist / hard gate.
// - Tiers are deterministically derived from finalCombinationNumberScore rank +
//   short-term hotness (count10) + score ratio relative to top score.
// - Diversity bonus tilts combo selection away from all-A monopolies but does
//   not promote a candidate that has no real score support.
function classifyPools(rows: PrelimRow[]): PoolClassification {
  // Backtest-only escape hatch: production runs with v4_restore values (A=6, B
  // count10≤3). Set PLAN_B_TUNING_ENABLED=1 in env (harness use only) to apply
  // Plan B values (A=5, B count10≤4) for comparison runs. Production never sets this.
  const planBEnabled = process.env['PLAN_B_TUNING_ENABLED'] === '1';
  const aMaxRank = planBEnabled ? 5 : POOL_A_MAX_RANK;
  const bMaxHotCount = planBEnabled ? 4 : POOL_B_MAX_HOT_COUNT;
  const sorted = [...rows].sort(
    (a, b) =>
      finalCombinationNumberScore(b) - finalCombinationNumberScore(a) ||
      a.number - b.number,
  );
  const maxScore = Math.max(...sorted.map(finalCombinationNumberScore), 1);
  const a_pool: number[] = [];
  const b_pool: number[] = [];
  const c_pool: number[] = [];
  const by_number: Record<number, PoolTier> = {};
  sorted.forEach((row, idx) => {
    const rank = idx + 1;
    const ratio = finalCombinationNumberScore(row) / maxScore;
    let tier: PoolTier = 'X';
    if (rank <= aMaxRank) {
      tier = 'A';
      a_pool.push(row.number);
    } else if (rank <= POOL_B_MAX_RANK && row.count10 <= bMaxHotCount) {
      tier = 'B';
      b_pool.push(row.number);
    } else if (rank <= POOL_C_MAX_RANK && ratio >= POOL_C_MIN_SCORE_RATIO) {
      tier = 'C';
      c_pool.push(row.number);
    }
    by_number[row.number] = tier;
  });
  return {
    by_number,
    a_pool: sortNumbers(a_pool),
    b_pool: sortNumbers(b_pool),
    c_pool: sortNumbers(c_pool),
    reason_text: '依分數排名與短期熱度自動分層，僅作為組合輪替參考，不影響任何號碼候選資格。',
  };
}

// Returns a soft additive bonus to the combination score that rewards combos
// containing B/C tier members. Magnitudes are tuned so that mid-tier combos
// can compete with all-A combos when their raw scores are within ~5–10% gap,
// but do not override genuinely stronger combos.
function poolDiversityBonus(
  kind: ComboKind,
  candidate: number[],
  pools: PoolClassification,
): number {
  // Backtest harness escape hatch: simulate old (pre-v3) behaviour with no
  // diversification bonus so we can compare metrics on identical data.
  if (process.env['POOL_DIVERSIFICATION_DISABLED'] === '1') return 0;
  const tiers = candidate.map(n => pools.by_number[n] ?? 'X');
  const aCount = tiers.filter(t => t === 'A').length;
  const bcCount = tiers.filter(t => t === 'B' || t === 'C').length;
  const nonACount = tiers.filter(t => t !== 'A').length;
  switch (kind) {
    case 'two_star':
      // 二星：至少 1 顆不可來自 A 池
      return nonACount >= 1 ? 5 : 0;
    case 'three_star':
      // 三星：至少 1 顆來自 B/C 池
      if (bcCount >= 2) return 9;
      if (bcCount >= 1) return 6;
      return 0;
    case 'four_star':
      // 四星：至少 1~2 顆來自 B/C 池
      if (bcCount >= 2) return 9;
      if (bcCount >= 1) return 6;
      return 0;
    case 'five_star':
      // 五星：至少 2 顆來自 B/C 池
      if (bcCount >= 3) return 11;
      if (bcCount >= 2) return 9;
      if (bcCount >= 1) return 5;
      return 0;
  }
  // Make sure A-only combos are not actively penalized — we only positively
  // reward diversity. Keeps high-score combos viable when no real B/C exists.
  return aCount > 0 ? 0 : 0;
}

function poolBreakdown(
  numbers: number[],
  pools: PoolClassification,
): { A: number; B: number; C: number; X: number } {
  const out = { A: 0, B: 0, C: 0, X: 0 };
  for (const n of numbers) {
    const tier = pools.by_number[n] ?? 'X';
    out[tier]++;
  }
  return out;
}

function summarizePoolDiversification(
  pools: PoolClassification,
  combos: { two_star: number[]; three_star: number[]; four_star: number[]; five_star: number[] },
): PoolDiversificationSummary {
  return {
    enabled: true,
    classification: pools,
    two_star_pool_breakdown: poolBreakdown(combos.two_star, pools),
    three_star_pool_breakdown: poolBreakdown(combos.three_star, pools),
    four_star_pool_breakdown: poolBreakdown(combos.four_star, pools),
    five_star_pool_breakdown: poolBreakdown(combos.five_star, pools),
    reason_text: '組合分層：A 池為高分核心，B 池為中段穩定號，C 池為近期低曝光但分數仍有支撐的號碼。最終組合至少混入 B/C 池成員以避免長期固定核心霸榜。',
  };
}

function applyHotControl(rows: PrelimRow[]): { rows: PrelimRow[]; summary: HotControlSummary } {
  const sorted = rows.map(row => ({ ...row })).sort((a, b) => b.preliminary_score - a.preliminary_score || a.number - b.number);
  const top10 = sorted.slice(0, 10);
  const top10Hot = top10.filter(row => row.hot_number);
  if (top10Hot.length <= TOP10_HOT_THRESHOLD) {
    return {
      rows: sorted,
      summary: {
        top10_hot_count: top10Hot.length,
        threshold: TOP10_HOT_THRESHOLD,
        max_allowed_hot_count: TOP10_HOT_THRESHOLD,
        adjusted: false,
        reason_text: 'Top10 熱號比例在部署版門檻內，未需降溫。',
      },
    };
  }

  let seenHot = 0;
  for (const row of sorted) {
    if (!row.hot_number) continue;
    seenHot++;
    if (seenHot > TOP10_HOT_THRESHOLD) {
      row.hot_control_penalty = -1;
      row.preliminary_score += row.hot_control_penalty;
    }
  }
  return {
    rows: sorted.sort((a, b) => b.preliminary_score - a.preliminary_score || a.number - b.number),
    summary: {
      top10_hot_count: top10Hot.length,
      threshold: TOP10_HOT_THRESHOLD,
      max_allowed_hot_count: TOP10_HOT_THRESHOLD,
      adjusted: true,
      reason_text: '本期熱門號偏多，系統已對後段熱號做輕量降溫處理。',
    },
  };
}

function selectThreeStarCoreCombinations(
  rows: PrelimRow[],
  draws: StatEntries,
  twoStats: TwoStats,
  previous: PreviousPredictionContext | null,
  includeOverheat: boolean,
  tracking: TrackingSummary,
): SelectionResult {
  const rowByNumber = new Map(rows.map(row => [row.number, row]));
  const scoreByNumber = new Map(rows.map(row => [row.number, finalCombinationNumberScore(row)]));
  const pairByKey = new Map(twoStats.map(stat => [stat.key, stat]));
  const pools = classifyPools(rows);
  const candidates = buildThreeStarCandidates(draws, twoStats);
  const scored = candidates
    .map(candidate => scoreThreeStarCandidate(candidate.numbers, candidate.sources, rowByNumber, pairByKey, draws, previous, includeOverheat, tracking, pools))
    .sort((a, b) => b.three_star_score - a.three_star_score || comboKey(a.numbers).localeCompare(comboKey(b.numbers)))
    .slice(0, 20);

  const selected = scored[0] ?? scoreThreeStarCandidate(sortNumbers(rows.slice(0, 3).map(row => row.number)), ['stableRecentMode'], rowByNumber, pairByKey, draws, previous, includeOverheat, tracking, pools);
  const three = selected.numbers;
  const two = selected.main_pair;
  const four = extendCombination('four_star', three, scoreByNumber, draws, twoStats, previous, pools);
  const five = extendCombination('five_star', four, scoreByNumber, draws, twoStats, previous, pools);
  const current = { two_star: two, three_star: three, four_star: four, five_star: five };
  const poolDiversification = summarizePoolDiversification(pools, current);
  return {
    ...current,
    combination_repeat_summary: buildCombinationRepeatSummary(previous, current),
      miss_penalty_summary: buildMissPenaltySummary(previous, current),
      anti_hot_selection_penalty_summary: buildAntiHotSelectionPenaltySummary(rows),
      three_star_summary: {
      selected_three_star: three,
      top_candidates: scored.slice(0, 20),
      main_pair_score: selected.main_pair_score,
      third_number_pair_support_score: selected.third_number_pair_support_score,
      triple_history_score: selected.triple_history_score,
      number_strength_score: selected.number_strength_score,
      gap_reversion_score: selected.gap_reversion_score,
      balance_overheat_score: selected.balance_overheat_score,
      pair_fatigue_factor: selected.pair_fatigue_factor,
      triple_fatigue_factor: selected.triple_fatigue_factor,
      pair_repeat_count: selected.pair_repeat_count,
      triple_repeat_count: selected.triple_repeat_count,
      recommendation_repeat_window: selected.recommendation_repeat_window,
      recommended_pair_repeat_count: selected.recommended_pair_repeat_count,
      recommended_triple_repeat_count: selected.recommended_triple_repeat_count,
      pair_recommendation_repeat_factor: selected.pair_recommendation_repeat_factor,
      triple_recommendation_repeat_factor: selected.triple_recommendation_repeat_factor,
      recommendation_repeat_ratio: selected.recommendation_repeat_ratio,
      recommendation_repeat_sample_size: selected.recommendation_repeat_sample_size,
      recommendation_repeat_sample_size_insufficient: selected.recommendation_repeat_sample_size_insufficient,
      pair_score_before_smoothing: selected.pair_score_before_smoothing,
      pair_score_after_smoothing: selected.pair_score_after_smoothing,
      triple_score_before_smoothing: selected.triple_score_before_smoothing,
      triple_score_after_smoothing: selected.triple_score_after_smoothing,
      extra_overheat_factor: selected.extra_overheat_factor,
      last10_overheat_triggered: selected.last10_overheat_triggered,
      pair_freshness_bonus: selected.pair_freshness_bonus,
      triple_freshness_bonus: selected.triple_freshness_bonus,
      pair_recent_recommendation_count: selected.pair_recent_recommendation_count,
      triple_recent_recommendation_count: selected.triple_recent_recommendation_count,
      three_star_score: selected.three_star_score,
      weights: THREE_STAR_WEIGHTS,
      weights_total: round(Object.values(THREE_STAR_WEIGHTS).reduce((sum, n) => sum + n, 0)),
      candidate_sources: ['historical100', 'topPairExtension', 'active30'],
      pool_diversification: poolDiversification,
      reason_text: selected.reason_text,
    },
  };
}

function selectLegacyCombinations(
  rows: PrelimRow[],
  draws: StatEntries,
  twoStats: TwoStats,
  previous: PreviousPredictionContext | null,
): SelectionResult {
  const scoreByNumber = new Map(rows.map(row => [row.number, finalCombinationNumberScore(row)]));
  const pools = classifyPools(rows);
  // Widen the legacy three-star candidate pool to A∪B∪C so B/C tier numbers
  // are reachable. Falls back to top-12 by score if A∪B∪C is too narrow.
  const unionPool = sortNumbers([
    ...new Set([...pools.a_pool, ...pools.b_pool, ...pools.c_pool]),
  ]);
  const fallbackTop = rows.slice(0, 12).map(s => s.number);
  const pool = unionPool.length >= 12 ? unionPool : sortNumbers([...new Set([...unionPool, ...fallbackTop])]);
  const two_star = bestCombination('two_star', twoStats.slice(0, 80).map(stat => stat.numbers), scoreByNumber, draws, twoStats, previous, pools);
  const three_star = bestCombination('three_star', combinations(pool, 3), scoreByNumber, draws, twoStats, previous, pools);
  const four_star = extendCombination('four_star', three_star, scoreByNumber, draws, twoStats, previous, pools);
  const five_star = extendCombination('five_star', four_star, scoreByNumber, draws, twoStats, previous, pools);
  const current = { two_star, three_star, four_star, five_star };
  const poolDiversification = summarizePoolDiversification(pools, current);
  const legacyCandidate = scoreThreeStarCandidate(three_star, ['stableRecentMode'], new Map(rows.map(r => [r.number, r])), new Map(twoStats.map(stat => [stat.key, stat])), draws, previous, false, emptyTrackingSummary(), pools);
  return {
    ...current,
    combination_repeat_summary: buildCombinationRepeatSummary(previous, current),
      miss_penalty_summary: buildMissPenaltySummary(previous, current),
      anti_hot_selection_penalty_summary: buildAntiHotSelectionPenaltySummary(rows),
      three_star_summary: {
      selected_three_star: three_star,
      top_candidates: [legacyCandidate],
      main_pair_score: legacyCandidate.main_pair_score,
      third_number_pair_support_score: legacyCandidate.third_number_pair_support_score,
      triple_history_score: legacyCandidate.triple_history_score,
      number_strength_score: legacyCandidate.number_strength_score,
      gap_reversion_score: legacyCandidate.gap_reversion_score,
      balance_overheat_score: legacyCandidate.balance_overheat_score,
      pair_fatigue_factor: legacyCandidate.pair_fatigue_factor,
      triple_fatigue_factor: legacyCandidate.triple_fatigue_factor,
      pair_repeat_count: legacyCandidate.pair_repeat_count,
      triple_repeat_count: legacyCandidate.triple_repeat_count,
      recommendation_repeat_window: legacyCandidate.recommendation_repeat_window,
      recommended_pair_repeat_count: legacyCandidate.recommended_pair_repeat_count,
      recommended_triple_repeat_count: legacyCandidate.recommended_triple_repeat_count,
      pair_recommendation_repeat_factor: legacyCandidate.pair_recommendation_repeat_factor,
      triple_recommendation_repeat_factor: legacyCandidate.triple_recommendation_repeat_factor,
      recommendation_repeat_ratio: legacyCandidate.recommendation_repeat_ratio,
      recommendation_repeat_sample_size: legacyCandidate.recommendation_repeat_sample_size,
      recommendation_repeat_sample_size_insufficient: legacyCandidate.recommendation_repeat_sample_size_insufficient,
      pair_score_before_smoothing: legacyCandidate.pair_score_before_smoothing,
      pair_score_after_smoothing: legacyCandidate.pair_score_after_smoothing,
      triple_score_before_smoothing: legacyCandidate.triple_score_before_smoothing,
      triple_score_after_smoothing: legacyCandidate.triple_score_after_smoothing,
      extra_overheat_factor: legacyCandidate.extra_overheat_factor,
      last10_overheat_triggered: legacyCandidate.last10_overheat_triggered,
      pair_freshness_bonus: legacyCandidate.pair_freshness_bonus,
      triple_freshness_bonus: legacyCandidate.triple_freshness_bonus,
      pair_recent_recommendation_count: legacyCandidate.pair_recent_recommendation_count,
      triple_recent_recommendation_count: legacyCandidate.triple_recent_recommendation_count,
      three_star_score: legacyCandidate.three_star_score,
      weights: THREE_STAR_WEIGHTS,
      weights_total: round(Object.values(THREE_STAR_WEIGHTS).reduce((sum, n) => sum + n, 0)),
      candidate_sources: ['stableRecentMode'],
      pool_diversification: poolDiversification,
      reason_text: '近期模型驗證不穩，已改用較穩定的統計權重。',
    },
  };
}

function buildThreeStarCandidates(draws: StatEntries, twoStats: TwoStats): { numbers: number[]; sources: string[] }[] {
  const map = new Map<string, Set<string>>();
  const add = (numbers: number[], source: string) => {
    const key = comboKey(numbers);
    const sources = map.get(key) ?? new Set<string>();
    sources.add(source);
    map.set(key, sources);
  };

  for (const draw of draws.slice(0, 100)) {
    for (const trio of combinations(draw.numbers, 3)) add(trio, 'historical100');
  }
  for (const draw of draws.slice(0, 30)) {
    for (const trio of combinations(draw.numbers, 3)) add(trio, 'active30');
  }
  for (const pair of twoStats.slice(0, 24).map(stat => stat.numbers)) {
    for (let c = 1; c <= 39; c++) {
      if (!pair.includes(c)) add([...pair, c], 'topPairExtension');
    }
  }

  return [...map.entries()].map(([key, sources]) => ({
    numbers: key.split(',').map(Number),
    sources: [...sources],
  }));
}

function scoreThreeStarCandidate(
  numbers: number[],
  sources: string[],
  rowByNumber: Map<number, PrelimRow>,
  pairByKey: Map<string, TwoStats[number]>,
  draws: StatEntries,
  previous: PreviousPredictionContext | null,
  includeOverheat: boolean,
  tracking: TrackingSummary,
  pools: PoolClassification,
): ThreeStarCandidateScore {
  const trio = sortNumbers(numbers);
  const pairs = combinations(trio, 2);
  const pairScores = pairs.map(pair => ({ pair, score: normalizedPairScore(pairByKey.get(comboKey(pair))) }));
  const main = pairScores.sort((a, b) => b.score - a.score || comboKey(a.pair).localeCompare(comboKey(b.pair)))[0];
  const mainPair = sortNumbers(main?.pair ?? trio.slice(0, 2));
  const thirdPairs = pairs.filter(pair => comboKey(pair) !== comboKey(mainPair));
  const main_pair_score = round(main?.score ?? 0);
  const pair_repeat_count = consecutivePairRepeatCount(mainPair, previous);
  const triple_repeat_count = consecutiveTripleRepeatCount(trio, previous);
  const pair_fatigue_factor = pairFatigueFactor(pair_repeat_count);
  const triple_fatigue_factor = tripleFatigueFactor(triple_repeat_count);
  const recommendation_repeat_sample_size = recommendationRepeatSample(previous).length;
  const recommendation_repeat_sample_size_insufficient = recommendation_repeat_sample_size < RECOMMENDATION_REPEAT_MIN_SAMPLE;
  const recommended_pair_repeat_count = recommendedPairRepeatCount(mainPair, previous);
  const recommended_triple_repeat_count = recommendedTripleRepeatCount(trio, previous);
  const pair_recommendation_repeat_factor = pairRecommendationRepeatFactor(recommended_pair_repeat_count, recommendation_repeat_sample_size);
  const triple_recommendation_repeat_factor = tripleRecommendationRepeatFactor(recommended_triple_repeat_count, recommendation_repeat_sample_size);
  const pair_recent_recommendation_count = recommended_pair_repeat_count;
  const triple_recent_recommendation_count = recommended_triple_repeat_count;
  const pair_freshness_bonus = pairFreshnessBonus(pair_recent_recommendation_count, recommendation_repeat_sample_size);
  const triple_freshness_bonus = tripleFreshnessBonus(triple_recent_recommendation_count, recommendation_repeat_sample_size);
  const recommendation_repeat_ratio = recommendation_repeat_sample_size
    ? round(Math.max(recommended_pair_repeat_count, recommended_triple_repeat_count) / recommendation_repeat_sample_size)
    : 0;
  const third_number_pair_support_score = round(avg(thirdPairs.map(pair => normalizedPairScore(pairByKey.get(comboKey(pair))))));
  const historyCount = tripleHistoryCount(trio, draws);
  const triple_history_score = round(normalizedTripleHistoryScore(historyCount));
  const pair_score_before_smoothing = main_pair_score;
  const pair_score_after_smoothing = smoothComboSupportScore(pair_score_before_smoothing);
  const triple_score_before_smoothing = triple_history_score;
  const triple_score_after_smoothing = smoothComboSupportScore(triple_score_before_smoothing);
  const rowScores = trio.map(n => rowByNumber.get(n)).filter(Boolean) as PrelimRow[];
  const comboScores = rowScores.map(finalCombinationNumberScore);
  const maxRaw = Math.max(...[...rowByNumber.values()].map(finalCombinationNumberScore), 1);
  const number_strength_score = round(avg(comboScores.map(score => clamp(score / maxRaw * 100, 0, 100))));
  const extra_overheat_factor = round(rowScores.length ? Math.min(...rowScores.map(extraShortTermOverheatFactor)) : 1);
  const last10_overheat_triggered = rowScores.some(row => extraShortTermOverheatFactor(row) < 1);
  const gap_reversion_score = round(avg(rowScores.map(row => normalizedGapScore(row))));
  const balance = evaluateBalance(trio, draws);
  const overheatAverage = avg(rowScores.map(row => includeOverheat ? row.overheat_score : 0));
  const balance_overheat_score = round(clamp(50 + balance.total_balance_score * 4 + overheatAverage * 3, 0, 100));
  const baseScore =
    (pair_score_after_smoothing * pair_fatigue_factor * pair_recommendation_repeat_factor * pair_freshness_bonus) * THREE_STAR_WEIGHTS.main_pair_score +
    third_number_pair_support_score * THREE_STAR_WEIGHTS.third_number_pair_support_score +
    (triple_score_after_smoothing * triple_fatigue_factor * triple_recommendation_repeat_factor * triple_freshness_bonus) * THREE_STAR_WEIGHTS.triple_history_score +
    number_strength_score * THREE_STAR_WEIGHTS.number_strength_score +
    gap_reversion_score * THREE_STAR_WEIGHTS.gap_reversion_score +
    balance_overheat_score * THREE_STAR_WEIGHTS.balance_overheat_score;
  const tracking_score = trackingComboBonus(trio, tracking, baseScore);
  const combination_penalty = combinationRepeatPenalty('three_star', trio, previous).penalty;
  const miss_penalty = missPenalty('three_star', trio, previous).penalty;
  const pool_diversity_bonus = poolDiversityBonus('three_star', trio, pools);
  const three_star_score = round(clamp(baseScore + tracking_score + combination_penalty + miss_penalty + pool_diversity_bonus, 0, 100));
  return {
    numbers: trio,
    sources,
    main_pair: mainPair,
    main_pair_score,
    third_number_pair_support_score,
    triple_history_score,
    number_strength_score,
    gap_reversion_score,
    balance_overheat_score,
    tracking_score: round(tracking_score),
    combination_penalty,
    miss_penalty,
    pair_fatigue_factor,
    triple_fatigue_factor,
    pair_repeat_count,
    triple_repeat_count,
    recommendation_repeat_window: RECOMMENDATION_REPEAT_WINDOW,
    recommended_pair_repeat_count,
    recommended_triple_repeat_count,
    pair_recommendation_repeat_factor,
    triple_recommendation_repeat_factor,
    recommendation_repeat_ratio,
    recommendation_repeat_sample_size,
    recommendation_repeat_sample_size_insufficient,
    pair_score_before_smoothing,
    pair_score_after_smoothing,
    triple_score_before_smoothing,
    triple_score_after_smoothing,
    extra_overheat_factor,
    last10_overheat_triggered,
    pair_freshness_bonus,
    triple_freshness_bonus,
    pair_recent_recommendation_count,
    triple_recent_recommendation_count,
    three_star_score,
    reason_text: `二星骨架 ${comboKey(mainPair)}，三中三歷史 ${historyCount} 次，補碼支撐 ${third_number_pair_support_score}。`,
  };
}

function bestCombination(
  kind: ComboKind,
  candidates: number[][],
  scoreByNumber: Map<number, number>,
  draws: StatEntries,
  twoStats: TwoStats,
  previous: PreviousPredictionContext | null,
  pools: PoolClassification,
): number[] {
  let best = sortNumbers(candidates[0] ?? []);
  let bestScore = -Infinity;
  for (const raw of candidates) {
    const candidate = sortNumbers(raw);
    const score = combinationScore(kind, candidate, scoreByNumber, draws, twoStats, previous, pools);
    if (score > bestScore || (score === bestScore && comboKey(candidate) < comboKey(best))) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function extendCombination(
  kind: 'four_star' | 'five_star',
  base: number[],
  scoreByNumber: Map<number, number>,
  draws: StatEntries,
  twoStats: TwoStats,
  previous: PreviousPredictionContext | null,
  pools: PoolClassification,
): number[] {
  let best: number[] = [];
  let bestScore = -Infinity;
  for (let n = 1; n <= 39; n++) {
    if (base.includes(n)) continue;
    const candidate = sortNumbers([...base, n]);
    const score = combinationScore(kind, candidate, scoreByNumber, draws, twoStats, previous, pools);
    if (score > bestScore || (score === bestScore && comboKey(candidate) < comboKey(best))) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function combinationScore(
  kind: ComboKind,
  candidate: number[],
  scoreByNumber: Map<number, number>,
  draws: StatEntries,
  twoStats: TwoStats,
  previous: PreviousPredictionContext | null,
  pools: PoolClassification,
): number {
  const relationship = relationshipScore(candidate, draws, twoStats);
  const smoothedRelationship = relationship.total_after_smoothing;
  return candidate.reduce((sum, n) => sum + (scoreByNumber.get(n) ?? 0), 0) +
    smoothedRelationship +
    fatigueRelationshipPenalty(kind, candidate, previous, smoothedRelationship) +
    recommendationRepeatRelationshipPenalty(kind, candidate, previous, smoothedRelationship) +
    recommendationFreshnessRelationshipBonus(kind, candidate, previous, smoothedRelationship) +
    balanceCandidateScore(candidate) +
    combinationRepeatPenalty(kind, candidate, previous).penalty +
    missPenalty(kind, candidate, previous).penalty +
    poolDiversityBonus(kind, candidate, pools);
}

function recommendationFreshnessRelationshipBonus(kind: ComboKind, candidate: number[], previous: PreviousPredictionContext | null, relationship: number): number {
  const sampleSize = recommendationRepeatSample(previous).length;
  if (!relationship || sampleSize < RECOMMENDATION_REPEAT_MIN_SAMPLE) return 0;
  const pairFactors = combinations(candidate, 2).map(pair => pairFreshnessBonus(recommendedPairRepeatCount(pair, previous), sampleSize));
  const pairFactor = pairFactors.length ? Math.max(...pairFactors) : 1;
  const tripleFactors = candidate.length >= 3
    ? combinations(candidate, 3).map(trio => tripleFreshnessBonus(recommendedTripleRepeatCount(trio, previous), sampleSize))
    : [1];
  const tripleFactor = tripleFactors.length ? Math.max(...tripleFactors) : 1;
  const factor = kind === 'two_star' ? pairFactor : Math.max(pairFactor, tripleFactor);
  return factor > 1 ? round(relationship * (factor - 1)) : 0;
}

function recommendationRepeatRelationshipPenalty(kind: ComboKind, candidate: number[], previous: PreviousPredictionContext | null, relationship: number): number {
  if (!relationship || recommendationRepeatSample(previous).length < RECOMMENDATION_REPEAT_MIN_SAMPLE) return 0;
  const pairFactors = combinations(candidate, 2).map(pair => pairRecommendationRepeatFactor(recommendedPairRepeatCount(pair, previous), recommendationRepeatSample(previous).length));
  const pairFactor = pairFactors.length ? Math.min(...pairFactors) : 1;
  const tripleFactors = candidate.length >= 3
    ? combinations(candidate, 3).map(trio => tripleRecommendationRepeatFactor(recommendedTripleRepeatCount(trio, previous), recommendationRepeatSample(previous).length))
    : [1];
  const tripleFactor = tripleFactors.length ? Math.min(...tripleFactors) : 1;
  const factor = kind === 'two_star' ? pairFactor : Math.min(pairFactor, tripleFactor);
  return factor < 1 ? round(relationship * (factor - 1)) : 0;
}

function fatigueRelationshipPenalty(kind: ComboKind, candidate: number[], previous: PreviousPredictionContext | null, relationship: number): number {
  if (!relationship || !previous?.recent_observations?.length) return 0;
  const pairFactors = combinations(candidate, 2).map(pair => pairFatigueFactor(consecutivePairRepeatCount(pair, previous)));
  const pairFactor = pairFactors.length ? Math.min(...pairFactors) : 1;
  const tripleFactors = candidate.length >= 3
    ? combinations(candidate, 3).map(trio => tripleFatigueFactor(consecutiveTripleRepeatCount(trio, previous)))
    : [1];
  const tripleFactor = tripleFactors.length ? Math.min(...tripleFactors) : 1;
  const factor = kind === 'two_star' ? pairFactor : Math.min(pairFactor, tripleFactor);
  return factor < 1 ? round(relationship * (factor - 1)) : 0;
}

function normalizedPairScore(stat: TwoStats[number] | undefined): number {
  if (!stat) return 0;
  const countScore = clamp(stat.count100 / 8 * 65, 0, 65);
  const activeScore = clamp(stat.count30 / 4 * 20, 0, 20);
  const gapScore = stat.gap === null ? 0 : clamp((MODEL_WINDOW - stat.gap) / MODEL_WINDOW * 15, 0, 15);
  return round(countScore + activeScore + gapScore);
}

function normalizedTripleHistoryScore(count: number): number {
  if (count >= 3) return 100;
  if (count === 2) return 60;
  if (count === 1) return 30;
  return 0;
}

function tripleHistoryScore(count: number): number {
  if (count >= 3) return 8;
  if (count === 2) return 5;
  if (count === 1) return 2;
  return 0;
}

function tripleHistoryCount(candidate: number[], draws: StatEntries): number {
  return draws.filter(draw => candidate.every(n => draw.numbers.includes(n))).length;
}

function topPairSupport(n: number, twoStats: TwoStats): number {
  return twoStats
    .filter(pair => pair.numbers.includes(n))
    .slice(0, 12)
    .reduce((sum, pair) => sum + pair.count100 * 0.45 - (pair.gap ?? MODEL_WINDOW) * 0.01, 0);
}

interface RelationshipScoreBreakdown {
  pair_score_before_smoothing: number;
  pair_score_after_smoothing: number;
  triple_score_before_smoothing: number;
  triple_score_after_smoothing: number;
  total_before_smoothing: number;
  total_after_smoothing: number;
}

function relationshipScore(candidate: number[], draws: StatEntries, twoStats: TwoStats): RelationshipScoreBreakdown {
  const byKey = new Map(twoStats.map(stat => [stat.key, stat]));
  const pairScoreBeforeSmoothing = combinations(candidate, 2).reduce((sum, pair) => {
    const stat = byKey.get(comboKey(pair));
    return sum + (stat ? stat.count100 * 2 - (stat.gap ?? MODEL_WINDOW) * 0.03 : 0);
  }, 0);
  const tripleScoreBeforeSmoothing = candidate.length >= 3
    ? combinations(candidate, 3).reduce((sum, trio) => sum + tripleHistoryScore(tripleHistoryCount(trio, draws)), 0)
    : 0;
  const pairScoreAfterSmoothing = smoothComboSupportScore(pairScoreBeforeSmoothing);
  const tripleScoreAfterSmoothing = smoothComboSupportScore(tripleScoreBeforeSmoothing);
  return {
    pair_score_before_smoothing: round(pairScoreBeforeSmoothing),
    pair_score_after_smoothing: pairScoreAfterSmoothing,
    triple_score_before_smoothing: round(tripleScoreBeforeSmoothing),
    triple_score_after_smoothing: tripleScoreAfterSmoothing,
    total_before_smoothing: round(pairScoreBeforeSmoothing + tripleScoreBeforeSmoothing),
    total_after_smoothing: round(pairScoreAfterSmoothing + tripleScoreAfterSmoothing),
  };
}

function smoothComboSupportScore(score: number): number {
  if (score <= COMBO_SUPPORT_SMOOTHING_THRESHOLD) return round(score);
  return round(COMBO_SUPPORT_SMOOTHING_THRESHOLD + (score - COMBO_SUPPORT_SMOOTHING_THRESHOLD) * COMBO_SUPPORT_SMOOTHING_SLOPE);
}

function finalCombinationNumberScore(row: PrelimRow): number {
  return round(row.selection_score_after_penalty * extraShortTermOverheatFactor(row));
}

/**
 * Top-Score Compression Layer
 *
 * Non-linear, deterministic compression applied to a number's final_score
 * relative to the per-call max_final_score. Compresses ONLY the top band so
 * the multiplicative anti-hot / overheat penalty further down can finally
 * flip ranking when count10 / hot signals trigger. Below 75% of max ⇒ no
 * change. Above 75% of max ⇒ piecewise linear interpolation:
 *   75% → 75% (untouched)
 *   85% → 80%   (light)
 *   95% → 82%   (medium)
 *   100% → 84%  (heavy)
 *
 * Properties:
 *   - Deterministic (no randomness involved)
 *   - Monotonic (preserves relative order at this layer alone)
 *   - All 39 numbers remain candidates (no blacklist / hard gate)
 *   - Hot numbers can still appear in Top10 and any combination
 *   - Real effect: enables anti-hot 0.9 vs 1.0 spread to actually flip top
 *     two when applied AFTER compression.
 */
function compressTopScore(score: number, maxScore: number): number {
  if (process.env['TOP_SCORE_COMPRESSION_DISABLED'] === '1') return score;
  if (maxScore <= 0) return score;
  // Backtest-only escape hatch: production runs the v4_restore slope (0.40).
  // Set PLAN_B_TUNING_ENABLED=1 (harness use only) to test Plan B slope (0.45).
  const planBEnabled = process.env['PLAN_B_TUNING_ENABLED'] === '1';
  const heavySlope = planBEnabled ? 0.45 : TOP_COMPRESSION_HEAVY_SLOPE;
  const pct = (score / maxScore) * 100;
  if (pct <= TOP_COMPRESSION_THRESHOLD_PCT) return score;
  let outputPct: number;
  if (pct < TOP_COMPRESSION_LIGHT_PCT) {
    outputPct =
      TOP_COMPRESSION_THRESHOLD_PCT +
      (pct - TOP_COMPRESSION_THRESHOLD_PCT) * TOP_COMPRESSION_LIGHT_SLOPE;
  } else if (pct < TOP_COMPRESSION_MEDIUM_PCT) {
    outputPct =
      TOP_COMPRESSION_LIGHT_OUTPUT +
      (pct - TOP_COMPRESSION_LIGHT_PCT) * TOP_COMPRESSION_MEDIUM_SLOPE;
  } else {
    outputPct =
      TOP_COMPRESSION_MEDIUM_OUTPUT +
      (pct - TOP_COMPRESSION_MEDIUM_PCT) * heavySlope;
  }
  return (outputPct / 100) * maxScore;
}

function buildTopScoreCompressionSummary(
  finalScores: number[],
  compressedScores: number[],
): TopScoreCompressionSummary {
  const enabled = process.env['TOP_SCORE_COMPRESSION_DISABLED'] !== '1';
  const max_final_score = Math.max(...finalScores, 0);
  const max_compressed_score = Math.max(...compressedScores, 0);
  let compressed_count = 0;
  for (let i = 0; i < finalScores.length; i++) {
    if (Math.abs(finalScores[i] - compressedScores[i]) > 0.005) compressed_count++;
  }
  return {
    enabled,
    max_final_score: round(max_final_score),
    max_compressed_score: round(max_compressed_score),
    threshold_pct: TOP_COMPRESSION_THRESHOLD_PCT,
    breakpoints: [
      { input: TOP_COMPRESSION_THRESHOLD_PCT, output: TOP_COMPRESSION_THRESHOLD_PCT },
      { input: TOP_COMPRESSION_LIGHT_PCT, output: TOP_COMPRESSION_LIGHT_OUTPUT },
      { input: TOP_COMPRESSION_MEDIUM_PCT, output: TOP_COMPRESSION_MEDIUM_OUTPUT },
      { input: 100, output: TOP_COMPRESSION_HEAVY_OUTPUT },
    ],
    compressed_count,
    reason_text: enabled
      ? '高分區做非線性壓縮：top 100→84，95→82，85→80，75 以下完全不動。所有號碼仍保留候選資格，僅縮小高分區絕對差距以利後續 anti-hot 與 overheat 能真正改寫排名。'
      : '高分區壓縮已被環境變數停用（僅供回測比較使用）。',
  };
}

function extraShortTermOverheatFactor(row: Pick<PrelimRow, 'count10'>): number {
  if (row.count10 >= 5) return 0.78;
  if (row.count10 === 4) return 0.82;
  if (row.count10 === 3) return 0.87;
  if (row.count10 === 2) return 0.93;
  return 1;
}

/**
 * Single (獨支) Soft Rotation Selector
 *
 * Replaces the previous `single = scored[0].number` rule. The selector still
 * uses the post-anti-hot post-compression `raw_total_score` (no separate score
 * universe), but injects two soft adjustments before deciding which number
 * becomes the day's 獨支:
 *
 *   1. top1_dominance — if rank #1 score is clearly ahead of rank #2 by
 *      at least SINGLE_TOP1_DOMINANCE_GAP_RATIO of #1's score (default 5%),
 *      rank #1 wins outright (the gap is real, no rotation needed).
 *
 *   2. recent_single_repeat_factor — when the rank-1 vs rank-2 gap is small
 *      AND we have ≥ SINGLE_REPEAT_MIN_SAMPLE prior recommendations, apply a
 *      multiplicative repeat factor to each top-N candidate's score:
 *           recent appearances as 獨支    factor
 *           0                              1.00
 *           1                              0.96
 *           2                              0.90
 *           ≥ 3                            0.82
 *      Pick the candidate with the highest adjusted score.
 *
 * Properties:
 *   - Deterministic (no randomness), monotonic per candidate
 *   - All 39 numbers remain candidates — soft factor only, no blacklist
 *   - 08 (or any number) can still be 獨支 if its post-factor score is highest
 *   - Tie-break (when adjusted scores tie): lower original rank, then lower
 *     number — same input always produces the same output
 *   - Reads ONLY past recommendation records (selected_single from prior
 *     observations); never uses draw results to drive rotation
 */
interface SingleSelectionResult {
  number: number;
  method: 'top1_clear_winner' | 'top1_insufficient_sample' | 'soft_rotation' | 'fallback';
  top1_gap_ratio: number;
  recent_repeat_count: number;
  repeat_factor_used: number;
  considered_pool_size: number;
  reason_text: string;
}

function singleRepeatFactor(repeats: number): number {
  // Soft, never below 0.80 — must not become a hard ban.
  if (repeats >= 3) return 0.82;
  if (repeats === 2) return 0.90;
  if (repeats === 1) return 0.96;
  return 1;
}

function selectSingleWithRotation(
  scored: { number: number; rank: number; raw_total_score: number }[],
  previous: PreviousPredictionContext | null,
): SingleSelectionResult {
  // Backtest-only escape hatch: skip rotation entirely and behave like v4_restore_1
  // (always pick rank #1). Production never sets this.
  if (process.env['SINGLE_ROTATION_DISABLED'] === '1') {
    const top0 = scored[0];
    return {
      number: top0 ? top0.number : 0,
      method: 'fallback',
      top1_gap_ratio: 1,
      recent_repeat_count: 0,
      repeat_factor_used: 1,
      considered_pool_size: scored.length,
      reason_text: '獨支輪替已被環境變數停用（僅供回測比較使用）。',
    };
  }
  if (scored.length === 0) {
    return {
      number: 0,
      method: 'fallback',
      top1_gap_ratio: 0,
      recent_repeat_count: 0,
      repeat_factor_used: 1,
      considered_pool_size: 0,
      reason_text: '無可用候選號碼',
    };
  }
  const top = scored[0];
  if (scored.length < 2) {
    return {
      number: top.number,
      method: 'fallback',
      top1_gap_ratio: 1,
      recent_repeat_count: 0,
      repeat_factor_used: 1,
      considered_pool_size: 1,
      reason_text: '候選池僅有一個號碼',
    };
  }
  const second = scored[1];
  const gap = top.raw_total_score - second.raw_total_score;
  const gapRatio = top.raw_total_score > 0 ? gap / top.raw_total_score : 0;

  // Clear-winner shortcut: when rank #1 dominates rank #2, no rotation needed.
  if (gapRatio >= SINGLE_TOP1_DOMINANCE_GAP_RATIO) {
    return {
      number: top.number,
      method: 'top1_clear_winner',
      top1_gap_ratio: round(gapRatio),
      recent_repeat_count: 0,
      repeat_factor_used: 1,
      considered_pool_size: 1,
      reason_text: 'rank #1 分數明顯領先，獨支採 rank #1。',
    };
  }

  // Pull recent 獨支 picks (window = SINGLE_REPEAT_WINDOW). Only kicks in when
  // we have at least SINGLE_REPEAT_MIN_SAMPLE prior records — observation phase.
  const recentSingles = (previous?.recent_observations ?? [])
    .slice(0, SINGLE_REPEAT_WINDOW)
    .map(obs => obs.selected_single)
    .filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 39);

  if (recentSingles.length < SINGLE_REPEAT_MIN_SAMPLE) {
    return {
      number: top.number,
      method: 'top1_insufficient_sample',
      top1_gap_ratio: round(gapRatio),
      recent_repeat_count: 0,
      repeat_factor_used: 1,
      considered_pool_size: 1,
      reason_text: '近期獨支樣本不足，獨支採 rank #1。',
    };
  }

  // Soft rotation: rescore Top-N by raw_total_score × singleRepeatFactor.
  const pool = scored.slice(0, SINGLE_CANDIDATE_POOL_SIZE);
  const candidates = pool.map(row => {
    const repeats = recentSingles.filter(n => n === row.number).length;
    const factor = singleRepeatFactor(repeats);
    return {
      number: row.number,
      original_rank: row.rank,
      base_score: row.raw_total_score,
      repeat_count: repeats,
      factor,
      adjusted_score: row.raw_total_score * factor,
    };
  });

  // Deterministic tie-break — same input always produces same output.
  candidates.sort((a, b) =>
    b.adjusted_score - a.adjusted_score ||
    a.original_rank - b.original_rank ||
    a.number - b.number,
  );

  const winner = candidates[0];
  return {
    number: winner.number,
    method: 'soft_rotation',
    top1_gap_ratio: round(gapRatio),
    recent_repeat_count: winner.repeat_count,
    repeat_factor_used: winner.factor,
    considered_pool_size: candidates.length,
    reason_text: '高分接近時依過去獨支記錄做輕微輪替平衡。',
  };
}

function balanceCandidateScore(candidate: number[]): number {
  const zones = new Set(candidate.map(zoneOf)).size;
  const tails = new Map<number, number>();
  candidate.forEach(n => tails.set(n % 10, (tails.get(n % 10) ?? 0) + 1));
  const maxTail = Math.max(...tails.values());
  const consecutive = consecutivePairs(candidate);
  return zones * 1.2 - Math.max(0, maxTail - 2) * 2 - Math.max(0, consecutive - 1);
}

function combinationRepeatPenalty(kind: ComboKind, candidate: number[], previous: PreviousPredictionContext | null): { overlap: number; penalty: number } {
  const prev = previousNumbers(kind, previous);
  if (!prev.length) return { overlap: 0, penalty: 0 };
  const overlap = overlapCount(candidate, prev);
  if (kind === 'two_star') return { overlap, penalty: overlap === 2 ? -5 : 0 };
  if (kind === 'three_star') return { overlap, penalty: overlap === 3 ? -8 : overlap === 2 ? -3 : 0 };
  if (kind === 'four_star') return { overlap, penalty: overlap === 4 ? -10 : overlap === 3 ? -5 : 0 };
  return { overlap, penalty: overlap === 5 ? -12 : overlap === 4 ? -6 : overlap === 3 ? -3 : 0 };
}

function consecutivePairRepeatCount(pair: number[], previous: PreviousPredictionContext | null): number {
  const target = sortNumbers(pair);
  return consecutiveObservationRepeatCount(previous, obs =>
    sameCombo(obs.selected_two_star, target) ||
    containsCombo(obs.selected_three_star, target)
  );
}

function consecutiveTripleRepeatCount(trio: number[], previous: PreviousPredictionContext | null): number {
  const target = sortNumbers(trio);
  return consecutiveObservationRepeatCount(previous, obs => sameCombo(obs.selected_three_star, target));
}

function consecutiveObservationRepeatCount(
  previous: PreviousPredictionContext | null,
  predicate: (obs: RecentPredictionObservationContext) => boolean,
): number {
  const observations = previous?.recent_observations ?? [];
  let count = 0;
  for (const obs of observations) {
    if (!predicate(obs)) break;
    count++;
  }
  return count;
}

function pairFatigueFactor(repeatCount: number): number {
  if (repeatCount >= 5) return 0.80;
  if (repeatCount >= 4) return 0.88;
  if (repeatCount >= 3) return 0.92;
  return 1;
}

function tripleFatigueFactor(repeatCount: number): number {
  if (repeatCount >= 5) return 0.75;
  if (repeatCount >= 4) return 0.85;
  if (repeatCount >= 3) return 0.90;
  return 1;
}

function recommendationRepeatSample(previous: PreviousPredictionContext | null): RecentPredictionObservationContext[] {
  return (previous?.recent_observations ?? []).slice(0, RECOMMENDATION_REPEAT_WINDOW);
}

function recommendedPairRepeatCount(pair: number[], previous: PreviousPredictionContext | null): number {
  const sample = recommendationRepeatSample(previous);
  if (sample.length < RECOMMENDATION_REPEAT_MIN_SAMPLE) return 0;
  const target = sortNumbers(pair);
  return sample.filter(obs =>
    sameCombo(obs.selected_two_star, target) ||
    containsCombo(obs.selected_three_star, target) ||
    containsCombo(obs.selected_four_star, target) ||
    containsCombo(obs.selected_five_star, target)
  ).length;
}

function recommendedTripleRepeatCount(trio: number[], previous: PreviousPredictionContext | null): number {
  const sample = recommendationRepeatSample(previous);
  if (sample.length < RECOMMENDATION_REPEAT_MIN_SAMPLE) return 0;
  const target = sortNumbers(trio);
  return sample.filter(obs =>
    sameCombo(obs.selected_three_star, target) ||
    containsCombo(obs.selected_four_star, target) ||
    containsCombo(obs.selected_five_star, target)
  ).length;
}

// Structural pair/triple fatigue (single_rotation_structure_fatigue_v1):
// strengthened from v4_restore_1 because users observed that fixed pair/triple
// structures (e.g. 08-22-27) keep recurring across many days. Factors are still:
//   - soft (multiplicative, never below 0.80)
//   - data-driven (counts come from prior recommendation records, NOT draws)
//   - generalized (applies to ANY pair/triple, no hardcoded numbers)
//   - skipped when sample size < RECOMMENDATION_REPEAT_MIN_SAMPLE
// Tier guidance from user spec:
//   pair  ≥ 3 → light decay,  ≥ 4 → medium decay,  ≥ 5 → strong decay
//   triple ≥ 2 → light decay, ≥ 3 → medium decay, ≥ 4 → strong decay
function pairRecommendationRepeatFactor(repeatCount: number, sampleSize: number): number {
  if (sampleSize < RECOMMENDATION_REPEAT_MIN_SAMPLE || repeatCount <= 1) return 1;
  // Backtest-only escape hatch: revert to v4_restore_1 values for comparison runs.
  if (process.env['STRUCTURE_FATIGUE_REVERTED'] === '1') {
    if (repeatCount >= 5) return 0.88;
    if (repeatCount === 4) return 0.90;
    if (repeatCount === 3) return 0.94;
    return 0.97;
  }
  if (repeatCount >= 5) return 0.82; // was 0.88
  if (repeatCount === 4) return 0.86; // was 0.90
  if (repeatCount === 3) return 0.90; // was 0.94
  return 0.96;                        // 2 occurrences: was 0.97
}

function tripleRecommendationRepeatFactor(repeatCount: number, sampleSize: number): number {
  if (sampleSize < RECOMMENDATION_REPEAT_MIN_SAMPLE || repeatCount <= 1) return 1;
  // Backtest-only escape hatch: revert to v4_restore_1 values for comparison runs.
  if (process.env['STRUCTURE_FATIGUE_REVERTED'] === '1') {
    if (repeatCount >= 5) return 0.85;
    if (repeatCount === 4) return 0.88;
    if (repeatCount === 3) return 0.92;
    return 0.96;
  }
  if (repeatCount >= 5) return 0.80; // was 0.85 (floor)
  if (repeatCount === 4) return 0.84; // was 0.88
  if (repeatCount === 3) return 0.88; // was 0.92
  return 0.94;                        // 2 occurrences: was 0.96 (light decay enters earlier for triples)
}

function pairFreshnessBonus(repeatCount: number, sampleSize: number): number {
  if (sampleSize < RECOMMENDATION_REPEAT_MIN_SAMPLE) return 1;
  if (repeatCount === 0) return 1.05;
  if (repeatCount === 1) return 1.02;
  return 1;
}

function tripleFreshnessBonus(repeatCount: number, sampleSize: number): number {
  if (sampleSize < RECOMMENDATION_REPEAT_MIN_SAMPLE) return 1;
  if (repeatCount === 0) return 1.06;
  if (repeatCount === 1) return 1.03;
  return 1;
}

function sameCombo(a: number[] | undefined, b: number[]): boolean {
  return comboKey(sortNumbers(a ?? [])) === comboKey(b);
}

function containsCombo(container: number[] | undefined, combo: number[]): boolean {
  const set = new Set(container ?? []);
  return combo.every(n => set.has(n));
}

function missPenalty(kind: ComboKind, candidate: number[], previous: PreviousPredictionContext | null): { penalty: number } {
  if (!previous?.actual_numbers) return { penalty: 0 };
  const hits = previousHits(previous);
  const prev = previousNumbers(kind, previous);
  const overlap = overlapCount(candidate, prev);
  if (kind === 'two_star' && hits.two === 0 && overlap === 2) return { penalty: -3 };
  if (kind === 'three_star' && hits.three === 0 && overlap === 3) return { penalty: -4 };
  if (kind === 'four_star' && hits.four === 0 && overlap >= 3) return { penalty: -3 };
  if (kind === 'five_star' && hits.five === 0 && overlap >= 4) return { penalty: -4 };
  return { penalty: 0 };
}

function buildCombinationRepeatSummary(
  previous: PreviousPredictionContext | null,
  current: { two_star: number[]; three_star: number[]; four_star: number[]; five_star: number[] },
): CombinationRepeatSummary {
  const two = combinationRepeatPenalty('two_star', current.two_star, previous);
  const three = combinationRepeatPenalty('three_star', current.three_star, previous);
  const four = combinationRepeatPenalty('four_star', current.four_star, previous);
  const five = combinationRepeatPenalty('five_star', current.five_star, previous);
  const parts = [];
  if (two.penalty < 0) parts.push(`二星完全相同，降權 ${two.penalty}`);
  if (three.penalty < 0) parts.push(`三星重疊 ${three.overlap} 碼，降權 ${three.penalty}`);
  if (four.penalty < 0) parts.push(`四星重疊 ${four.overlap} 碼，降權 ${four.penalty}`);
  if (five.penalty < 0) parts.push(`五星重疊 ${five.overlap} 碼，降權 ${five.penalty}`);
  return {
    previous_prediction_id: previous?.prediction_id ?? null,
    previous_target_date: previous?.target_date ?? null,
    two_star_overlap: two.overlap,
    three_star_overlap: three.overlap,
    four_star_overlap: four.overlap,
    five_star_overlap: five.overlap,
    two_star_penalty: two.penalty,
    three_star_penalty: three.penalty,
    four_star_penalty: four.penalty,
    five_star_penalty: five.penalty,
    penalties: {
      two_star: two.penalty,
      three_star: three.penalty,
      four_star: four.penalty,
      five_star: five.penalty,
    },
    reason_text: parts.length ? `${parts.join('；')}。` : '與前次 prediction 無過度重複。',
  };
}

function buildMissPenaltySummary(
  previous: PreviousPredictionContext | null,
  current: { two_star: number[]; three_star: number[]; four_star: number[]; five_star: number[] },
): MissPenaltySummary {
  const hits = previous?.actual_numbers ? previousHits(previous) : null;
  const two = missPenalty('two_star', current.two_star, previous).penalty;
  const three = missPenalty('three_star', current.three_star, previous).penalty;
  const four = missPenalty('four_star', current.four_star, previous).penalty;
  const five = missPenalty('five_star', current.five_star, previous).penalty;
  const total = two + three + four + five;
  return {
    previous_result_available: !!previous?.actual_numbers,
    previous_hits: hits,
    two_star_miss_penalty: two,
    three_star_miss_penalty: three,
    four_star_miss_penalty: four,
    five_star_miss_penalty: five,
    reason_text: !previous
      ? '沒有前次 prediction，未套用未中降權。'
      : !previous.actual_numbers
        ? '前次目標尚未開獎，miss_penalty = 0。'
        : total < 0
          ? '前次已開獎且部分同組合未中，已做輕量降權。'
          : '前次結果未觸發未中降權。',
  };
}

function previousHits(previous: PreviousPredictionContext): { two: number; three: number; four: number; five: number } {
  const actual = previous.actual_numbers ?? [];
  return {
    two: previous.two_star.every(n => actual.includes(n)) ? 1 : 0,
    three: previous.three_star.filter(n => actual.includes(n)).length,
    four: previous.four_star.filter(n => actual.includes(n)).length,
    five: previous.five_star.filter(n => actual.includes(n)).length,
  };
}

function buildTrackingSummary(previous: PreviousPredictionContext | null): TrackingSummary {
  if (!previous) return emptyTrackingSummary('沒有前次 prediction，短期追蹤未啟用。');
  if (!previous.actual_numbers) {
    return {
      enabled: false,
      tracking_status: '等待上一期結果',
      previous_prediction_id: previous.prediction_id,
      previous_prediction_available: true,
      previous_result_available: false,
      previous_three_star_hits: null,
      retained_numbers: [],
      tracking_score: 0,
      weight: 0,
      reason_text: '前次 prediction 尚未開獎，tracking_score = 0。',
    };
  }
  const hitNumbers = sortNumbers(previous.three_star.filter(n => previous.actual_numbers?.includes(n)));
  if (hitNumbers.length === 0) {
    return {
      enabled: false,
      tracking_status: '未啟用',
      previous_prediction_id: previous.prediction_id,
      previous_prediction_available: true,
      previous_result_available: true,
      previous_three_star_hits: 0,
      retained_numbers: [],
      tracking_score: 0,
      weight: 0,
      reason_text: '前次三星未命中，短期追蹤未啟用。',
    };
  }
  const weight = hitNumbers.length >= 2 ? 0.10 : 0.04;
  return {
    enabled: true,
    tracking_status: '追蹤中',
    previous_prediction_id: previous.prediction_id,
    previous_prediction_available: true,
    previous_result_available: true,
    previous_three_star_hits: hitNumbers.length,
    retained_numbers: hitNumbers,
    tracking_score: 0,
    weight,
    reason_text: `前次三星命中 ${hitNumbers.length} 碼，僅以 ${Math.round(weight * 100)}% 權重做短期延續。`,
  };
}

function emptyTrackingSummary(reason = '短期追蹤未啟用。'): TrackingSummary {
  return {
    enabled: false,
    tracking_status: '未啟用',
    previous_prediction_id: null,
    previous_prediction_available: false,
    previous_result_available: false,
    previous_three_star_hits: null,
    retained_numbers: [],
    tracking_score: 0,
    weight: 0,
    reason_text: reason,
  };
}

function trackingNumberBonus(n: number, summary: TrackingSummary, referenceScore: number): number {
  if (!summary.enabled || !summary.retained_numbers.includes(n)) return 0;
  return round(clamp(referenceScore * summary.weight, 0, 5));
}

function trackingComboBonus(candidate: number[], summary: TrackingSummary, baseScore: number): number {
  if (!summary.enabled) return 0;
  const overlap = candidate.filter(n => summary.retained_numbers.includes(n)).length;
  if (!overlap) return 0;
  return round(clamp(baseScore * summary.weight * (overlap / Math.max(1, summary.retained_numbers.length)), 0, baseScore * 0.10));
}

function buildDrawProfile(rows: NumberAnalysisRow[], three: number[], five: number[]): DrawProfile {
  const top10 = rows.slice(0, 10);
  const top10Hot = top10.filter(row => row.hot_number).length;
  const top10Cold = top10.filter(row => row.last10_count === 0).length;
  const threeHot = rows.filter(row => three.includes(row.number) && row.hot_number).length;
  const fiveHot = rows.filter(row => five.includes(row.number) && row.overheat_score < 0).length;
  const fiveCold = rows.filter(row => five.includes(row.number) && ['偏冷觀察', '過冷不追'].includes(row.gap_status)).length;
  const type: DrawProfile['type'] =
    top10Hot >= 7 || threeHot >= 3 || fiveHot >= 4 ? 'hot' :
    top10Cold >= 7 || fiveCold >= 3 ? 'cold' :
    'normal';
  const label: DrawProfile['label'] = type === 'hot' ? '偏熱' : type === 'cold' ? '偏冷' : '正常';
  const reason_text =
    type === 'hot'
      ? `Top10 熱號 ${top10Hot} 碼，三星熱號 ${threeHot} 碼，五星過熱號 ${fiveHot} 碼。`
      : type === 'cold'
        ? `Top10 近10期未開 ${top10Cold} 碼，五星偏冷號 ${fiveCold} 碼。`
        : `熱號、穩定號與冷門觀察號混合，沒有明顯極端。`;
  return {
    type,
    label,
    reason_text,
    hot_count: fiveHot,
    cold_count: fiveCold,
    balanced_count: Math.max(0, five.length - fiveHot - fiveCold),
  };
}

function evaluateGap(currentGap: number, avgGap: number, maxGap: number): { status: string; bonus: number; advanced: number } {
  const average = Math.max(1, avgGap);
  if (currentGap < average * 0.75) return { status: '正常', bonus: -1, advanced: -1 };
  if (currentGap < average * 1.25) return { status: '接近回補', bonus: 2, advanced: 1.5 };
  if (currentGap < Math.min(average * 2.5, maxGap * 0.9)) {
    return { status: '偏冷觀察', bonus: clamp((currentGap - average) / average * 4 + 3, 3, 8), advanced: 4 };
  }
  return { status: '過冷不追', bonus: 2, advanced: 0 };
}

function normalizedGapScore(row: PrelimRow): number {
  if (row.gap_status === '偏冷觀察') return 75;
  if (row.gap_status === '接近回補') return 55;
  if (row.gap_status === '過冷不追') return 25;
  return 35;
}

function conditionalScore(n: number, draws: StatEntries): number {
  const latest = draws[0]?.numbers ?? [];
  let conditionCount = 0;
  let hitCount = 0;
  for (let i = 0; i < draws.length - 1; i++) {
    const previous = draws[i + 1].numbers;
    const conditionMatched = latest.some(x => previous.includes(x));
    if (!conditionMatched) continue;
    conditionCount++;
    if (draws[i].numbers.includes(n)) hitCount++;
  }
  if (conditionCount < 5) return 0;
  const baseline = draws.filter(d => d.numbers.includes(n)).length / Math.max(1, draws.length);
  return clamp(((hitCount / conditionCount) - baseline) * 12, -3, 5);
}

function patternScore(n: number, draws: StatEntries): number {
  const tail = n % 10;
  const zone = zoneOf(n);
  const tailCount = draws.reduce((sum, d) => sum + d.numbers.filter(x => x % 10 === tail).length, 0);
  const zoneCount = draws.reduce((sum, d) => sum + d.numbers.filter(x => zoneOf(x) === zone).length, 0);
  const tailMean = (draws.length * 5) / 10;
  const zoneMean = (draws.length * 5) / 3;
  return clamp(((tailCount - tailMean) / Math.max(1, tailMean)) * 3 + ((zoneCount - zoneMean) / Math.max(1, zoneMean)) * 2, -3, 4);
}

function perNumberTripleScore(n: number, bestPair: number[], draws: StatEntries): number {
  if (bestPair.length !== 2 || bestPair.includes(n)) return 0;
  return tripleHistoryScore(tripleHistoryCount(sortNumbers([...bestPair, n]), draws));
}

function consecutiveHitCount(n: number, draws: StatEntries): number {
  let count = 0;
  for (const draw of draws) {
    if (!draw.numbers.includes(n)) break;
    count++;
  }
  return count;
}

function consecutivePenalty(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return -1;
  if (count === 2) return -3;
  if (count === 3) return -6;
  return -9;
}

function hotnessPenalty(count100: number, mean100: number, std100: number): number {
  if (std100 <= 0) return 0;
  if (count100 > mean100 + 2 * std100) return -3;
  if (count100 > mean100 + std100) return -1;
  return 0;
}

function buildOverheatReason(consecutiveCount: number, consecutivePenaltyValue: number, hotnessPenaltyValue: number): string {
  const parts = [];
  if (consecutivePenaltyValue < 0) parts.push(`連開 ${consecutiveCount} 期，扣 ${Math.abs(consecutivePenaltyValue)}`);
  if (hotnessPenaltyValue < 0) parts.push(`近100期偏熱，扣 ${Math.abs(hotnessPenaltyValue)}`);
  return parts.length ? parts.join('；') : '無明顯過熱。';
}

interface AntiHotConfig {
  enabled: boolean;
  window: number;
  minFactor: number;
}

function getAntiHotConfig(): AntiHotConfig {
  return {
    enabled: process.env['ANTIHOT_ENABLED'] !== 'false',
    window: positiveInt(process.env['ANTIHOT_WINDOW'], 5),
    minFactor: clampNumber(parseNumber(process.env['ANTIHOT_MIN_FACTOR'], 0.60), 0.01, 1),
  };
}

function getAntiHotSelectionPenaltyConfig(): AntiHotSelectionPenaltyConfig {
  return {
    enabled: process.env['ANTIHOT_SELECTION_PENALTY_ENABLED'] !== 'false',
    window: positiveInt(process.env['ANTIHOT_SELECTION_WINDOW'], 4),
    minFactor: clampNumber(parseNumber(process.env['ANTIHOT_SELECTION_MIN_FACTOR'], 0.50), 0.01, 1),
  };
}

function applySelectionPenalty(rows: PrelimRow[], draws: StatEntries, config: AntiHotSelectionPenaltyConfig): PrelimRow[] {
  return rows.map(row => {
    const penalty = evaluateSelectionPenalty(row.number, draws, row.preliminary_score, config);
    return {
      ...row,
      recent_selection_window_hit_count: penalty.recent_hit_count,
      selection_penalty_factor: penalty.factor,
      selection_score_before_penalty: round(row.preliminary_score),
      selection_score_after_penalty: penalty.adjusted_score,
      selection_penalty_reason: penalty.reason,
    };
  }).sort((a, b) => b.selection_score_after_penalty - a.selection_score_after_penalty || a.number - b.number);
}

function evaluateSelectionPenalty(n: number, draws: StatEntries, originalScore: number, config: AntiHotSelectionPenaltyConfig): {
  recent_hit_count: number;
  factor: number;
  adjusted_score: number;
  reason: string;
} {
  const recent_hit_count = countInWindow(draws, n, config.window);
  if (!config.enabled) {
    return {
      recent_hit_count,
      factor: 1,
      adjusted_score: round(originalScore),
      reason: 'Selection anti-hot 已關閉，未降權。',
    };
  }
  const baseFactor =
    recent_hit_count <= 1 ? 1 :
    recent_hit_count === 2 ? 0.85 :
    recent_hit_count === 3 ? 0.65 :
    0.50;
  const factor = round(clampNumber(Math.max(baseFactor, config.minFactor), config.minFactor, 1));
  const adjusted_score = round(originalScore * factor);
  return {
    recent_hit_count,
    factor,
    adjusted_score,
    reason: buildSelectionPenaltyReason(config.window, recent_hit_count, factor),
  };
}

function buildSelectionPenaltyReason(window: number, recentHitCount: number, factor: number): string {
  if (factor >= 1) return '近期未過熱，未做平衡調整。';
  const percent = Math.round((1 - factor) * 100);
  return `近${window}期出現${recentHitCount}次，近期熱門號已做平衡調整（降低${percent}%）。`;
}

function buildAntiHotSelectionPenaltySummary(rows: PrelimRow[]): AntiHotSelectionPenaltySummary {
  const penalized_numbers = sortNumbers(rows.filter(row => row.selection_penalty_factor < 1).map(row => row.number));
  return {
    schema: RECENT_WEIGHTED_SCORING_SCHEMA,
    enabled: process.env['ANTIHOT_SELECTION_PENALTY_ENABLED'] !== 'false',
    window: positiveInt(process.env['ANTIHOT_SELECTION_WINDOW'], 4),
    min_factor: clampNumber(parseNumber(process.env['ANTIHOT_SELECTION_MIN_FACTOR'], 0.50), 0.01, 1),
    penalized_numbers,
    reason_text: penalized_numbers.length
      ? '近期熱門號已做平衡調整。'
      : '近期未觸發平衡調整。',
  };
}

function evaluateAntiHot(n: number, draws: StatEntries, originalScore: number, config: AntiHotConfig): {
  recent_hit_count: number;
  factor: number;
  adjusted_score: number;
  reason: string;
} {
  const recent_hit_count = draws.slice(0, config.window).filter(draw => draw.numbers.includes(n)).length;
  if (!config.enabled) {
    return {
      recent_hit_count,
      factor: 1,
      adjusted_score: round(originalScore),
      reason: 'Anti-hot 已關閉，未降權。',
    };
  }
  const baseFactor =
    recent_hit_count <= 1 ? 1 :
    recent_hit_count === 2 ? 0.90 :
    recent_hit_count === 3 ? 0.80 :
    0.65;
  const factor = round(clampNumber(Math.max(baseFactor, config.minFactor), config.minFactor, 1));
  const adjusted_score = round(originalScore * factor);
  return {
    recent_hit_count,
    factor,
    adjusted_score,
    reason: buildAntiHotReason(config.window, recent_hit_count, factor),
  };
}

function buildAntiHotReason(window: number, recentHitCount: number, factor: number): string {
  if (factor >= 1) return '近期未過熱，未降權。';
  const percent = Math.round((1 - factor) * 100);
  if (recentHitCount >= 4) return `近${window}期出現${recentHitCount}次，短期過熱，保守降權${percent}%。`;
  return `近${window}期出現${recentHitCount}次，保守降權${percent}%。`;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function buildRepeatDistribution(draws: StatEntries): Record<string, number> {
  const dist: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (let i = 0; i < draws.length - 1; i++) {
    const overlap = draws[i].numbers.filter(n => draws[i + 1].numbers.includes(n)).length;
    dist[String(overlap)]++;
  }
  return dist;
}

function repeatAverage(dist: Record<string, number>): number {
  const total = Object.values(dist).reduce((sum, n) => sum + n, 0);
  if (!total) return 0;
  return Object.entries(dist).reduce((sum, [key, count]) => sum + Number(key) * count, 0) / total;
}

function toDrawRow(d: DrawEntry, index: number): DrawRow {
  return {
    id: index,
    draw_no: d.draw_no,
    draw_date: d.draw_date,
    numbers_json: JSON.stringify(sortNumbers(d.numbers)),
    source: 'verified_db',
    source_url: null,
    verified: 1,
    verified_by_pilio: 0,
    audit_status: 'PASS',
    created_at: '',
    updated_at: '',
  };
}

function buildReasonText(row: PrelimRow): string {
  const parts = [];
  if (row.selection_penalty_factor < 1) parts.push('近期熱門號已做平衡調整');
  if (row.frequency_score > 15) parts.push('中短期頻率支撐');
  if (['接近回補', '偏冷觀察'].includes(row.gap_status)) parts.push(row.gap_status);
  if (row.pair_score > 8) parts.push('二星支撐強');
  if (row.overheat_score < 0) parts.push('已做過熱扣分');
  if (row.hot_control_penalty < 0) parts.push('Top10 熱號降溫');
  if (row.tracking_score > 0) parts.push('短期命中追蹤加分');
  return parts.length ? parts.join('；') : '近期統計分布穩定。';
}

function buildSimpleReasonText(row: PrelimRow): string {
  if (row.selection_penalty_factor < 1) return row.selection_penalty_reason;
  if (row.consecutive_hit_count > 0) return '近期連開，已適度降分。';
  if (row.hotness_penalty < 0) return '近期熱門號已做平衡調整。';
  if (row.count10 === 0 && row.gap_status !== '過冷不追') return '近10期未開，屬冷門觀察。';
  if (row.gap_status === '過冷不追') return 'GAP 極高，避免盲目追冷。';
  return '近期穩定出現，無明顯過熱。';
}

function buildBalanceReason(summary: ReturnType<typeof evaluateBalance>['summary'], mix: string, hotSummary: HotControlSummary): string {
  if (hotSummary.adjusted) return `本組略偏熱門，已做降溫處理；奇偶 ${summary.oddEven}、大小 ${summary.bigSmall}、區間 ${summary.zones}，熱穩冷 ${mix}。`;
  if (summary.commonPattern) return `本組分布正常，大小與奇偶比例接近近期常見型態；熱穩冷 ${mix}。`;
  return `本組部分型態較少見；奇偶 ${summary.oddEven}、大小 ${summary.bigSmall}、區間 ${summary.zones}，熱穩冷 ${mix}。`;
}

function hotStableColdMixText(rows: NumberAnalysisRow[], nums: number[]): string {
  const selected = rows.filter(row => nums.includes(row.number));
  const hot = selected.filter(row => row.hot_number).length;
  const cold = selected.filter(row => ['偏冷觀察', '過冷不追'].includes(row.gap_status)).length;
  const stable = Math.max(0, selected.length - hot - cold);
  return `熱${hot}/穩${stable}/冷${cold}`;
}

function previousNumbers(kind: ComboKind, previous: PreviousPredictionContext | null): number[] {
  if (!previous) return [];
  if (kind === 'two_star') return sortNumbers(previous.two_star ?? []);
  if (kind === 'three_star') return sortNumbers(previous.three_star ?? []);
  if (kind === 'four_star') return sortNumbers(previous.four_star ?? []);
  return sortNumbers(previous.five_star ?? []);
}

function overlapCount(a: number[], b: number[]): number {
  return a.filter(n => b.includes(n)).length;
}

function countInWindow(draws: StatEntries, n: number, window: number): number {
  return draws.slice(0, window).filter(draw => draw.numbers.includes(n)).length;
}

function averageBacktestScore(rows: BacktestRow[]): number {
  const scores = rows.map(r => r.score ?? 0).filter(Number.isFinite);
  return scores.length ? avg(scores) : 0;
}

function maxLoseStreak(records: { five: number }[]): number {
  let current = 0;
  let max = 0;
  for (const record of records) {
    if (record.five > 0) current = 0;
    else {
      current++;
      max = Math.max(max, current);
    }
  }
  return max;
}

function zoneOf(n: number): number {
  if (n <= 13) return 0;
  if (n <= 26) return 1;
  return 2;
}

function consecutivePairs(nums: number[]): number {
  const sorted = sortNumbers(nums);
  let count = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] === 1) count++;
  }
  return count;
}

function avg(values: number[]): number {
  return values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : 0;
}

function stddev(values: number[], mean: number): number {
  return values.length ? Math.sqrt(values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / values.length) : 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
