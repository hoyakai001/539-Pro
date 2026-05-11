export type DataStatus = 'VALID' | 'PENDING_OFFICIAL' | 'INVALID';
export type MinDataMode = 'FULL' | 'OBSERVATION' | 'INSUFFICIENT' | 'NO_DATA';

export interface DrawData {
  id: number;
  draw_no: string;
  draw_date: string;
  numbers: number[];
  source: string;
  source_url?: string | null;
  verified: number;
}

export interface TodayDrawStatus {
  todayDate: string;
  isDrawn: boolean;
  todayDrawNo: string | null;
  todayNumbers: number[] | null;
  previousDrawNo: string | null;
  previousDrawDate: string | null;
  previousNumbers: number[] | null;
}

export interface DataStatusReport {
  mode: string;
  database_path: string;
  config_path: string;
  status: DataStatus;
  reason: string;
  can_predict: boolean;
  cannot_predict_reason: string | null;
  latest_draw_no: string | null;
  latest_draw_date: string | null;
  latest_numbers: number[] | null;
  previous_draw_no: string | null;
  previous_draw_date: string | null;
  previous_numbers: number[] | null;
  today_date: string;
  today_draw_status: 'DRAWN' | 'NOT_DRAWN';
  today_numbers: number[] | null;
  latest_used_draw_no: string | null;
  latest_used_draw_date: string | null;
  draw_count: number;
  minimum_data_met: boolean;
  min_data_mode: MinDataMode;
  data_continuous: boolean;
  history_incomplete: boolean;
  missing_periods_count: number;
  last_sync_time: string | null;
  last_sync_status: string | null;
  next_sync_time: string | null;
  retry_active: boolean;
  retry_count: number;
  retry_stage: string | null;
  recovery_mode: boolean;
  active_source: string;
  active_source_url: string | null;
  last_error_message: string | null;
  last_diagnostic: string | null;
  official_api_configured: boolean;
  official_html_url: string;
  active_api_url: string;
  pending_official: boolean;
  latestDrawNo: string | null;
  latestDrawDate: string | null;
  totalDraws: number;
  missingPeriods: string[];
  lastSyncTime: string | null;
  canPredict: boolean;
  minDataMode: MinDataMode;
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

export interface DrawProfile {
  type: 'hot' | 'cold' | 'normal';
  label: '偏熱' | '偏冷' | '正常';
  hot_count: number;
  cold_count: number;
  balanced_count: number;
  reason_text: string;
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

export interface ObservationStatus {
  model_version: string;
  observed_count: number;
  target_count: number;
  status: '觀察中' | '已完成';
}

export interface StrategyPerformanceRecord {
  target_draw_no: string | null;
  target_date: string | null;
  single: number | null;
  two_star: number[];
  three_star: number[];
  four_star: number[];
  five_star: number[];
  actual_numbers: number[];
  hit_count: number;
  single_hit: boolean;
  two_star_hit: boolean;
  three_star_hit: boolean;
  four_star_hit: boolean;
  five_star_hit: boolean;
  three_star_hits: number;
  five_star_hits: number;
  advice: string | null;
  confidence: string | null;
}

export interface StrategyPerformance {
  window: number;
  sample_size: number;
  pending_count: number;
  hitRateSingle: number | null;
  hitRateTwo: number | null;
  hitRateThree: number | null;
  hitRateFour: number | null;
  hitRateFive: number | null;
  single_hit_count: number;
  two_star_hit_count: number;
  three_star_hit_count: number;
  four_star_hit_count: number;
  five_star_hit_count: number;
  avgHits: number | null;
  maxLoseStreak: number | null;
  byAdvice: Record<'STRONG' | 'SMALL' | 'WATCH' | 'AVOID', {
    sample_size: number;
    hitRateSingle: number | null;
    hitRateTwo: number | null;
    hitRateThree: number | null;
    hitRateFour: number | null;
    hitRateFive: number | null;
    avgHits: number | null;
  }>;
  periods?: {
    week: StrategyPerformancePeriod;
    previous_week: StrategyPerformancePeriod;
    month: StrategyPerformancePeriod;
    previous_month: StrategyPerformancePeriod;
  };
  recent_records: StrategyPerformanceRecord[];
}

export interface StrategyPerformancePeriod {
  key: 'week' | 'previous_week' | 'month' | 'previous_month';
  label: '本週' | '上週' | '本月' | '上月';
  start_date: string;
  end_date: string;
  sample_size: number;
  status: '資料不足' | '樣本偏少，僅供參考' | 'OK';
  avgHits: number | null;
  maxHits: number | null;
  maxLoseStreak: number | null;
  single_hit_count: number;
  two_star_hit_count: number;
  three_star_hit_count: number;
  four_star_hit_count: number;
  five_star_hit_count: number;
  hitRateSingle: number | null;
  hitRateTwo: number | null;
  hitRateThree: number | null;
  hitRateFour: number | null;
  hitRateFive: number | null;
  byAdvice: Record<'STRONG' | 'SMALL' | 'WATCH' | 'AVOID', {
    sample_size: number;
    hitRateSingle: number | null;
    hitRateTwo: number | null;
    hitRateThree: number | null;
    hitRateFour: number | null;
    hitRateFive: number | null;
    avgHits: number | null;
    maxHits: number | null;
  }>;
  recent_records: StrategyPerformanceRecord[];
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
  weights_total: number;
  candidate_sources: string[];
  reason_text: string;
}

export interface ComboSupportCounts {
  5: number;
  10: number;
  15: number;
  20: number;
  30: number;
}

export interface ComboSupportItem {
  label: '2+2' | '3+2' | '3+3' | '4+4';
  numbers: number[];
  counts: ComboSupportCounts;
  exists: boolean;
}

export interface ComboSupportSummary {
  level: '低' | '中' | '中高' | '高';
  windows: number[];
  two_plus_two: ComboSupportItem | null;
  two_plus_two_short: ComboSupportItem | null;
  two_plus_two_shorts?: ComboSupportItem[];
  three_plus_two: ComboSupportItem | null;
  three_plus_two_short: ComboSupportItem | null;
  three_plus_two_shorts?: ComboSupportItem[];
  three_plus_three: ComboSupportItem | null;
  four_plus_four: ComboSupportItem | null;
  short_term_heat: '低' | '中' | '偏高' | '高';
  reference_advice: string;
  explanation: string;
}

export interface PredictionData {
  id?: number;
  prediction_id?: number;
  target_date: string;
  target_draw_no?: string | null;
  latest_used_draw_no: string;
  latest_used_draw_date: string;
  single_number: number;
  single?: number;
  two_star: number[];
  three_star: number[];
  four_star: number[];
  five_star: number[];
  numbers?: number[];
  number_scores: NumberScoreRow[];
  strategy_scores: Record<string, number | string | boolean>;
  balance_summary?: unknown;
  hot_control_summary?: HotControlSummary | null;
  combination_repeat_summary?: CombinationRepeatSummary | null;
  miss_penalty_summary?: MissPenaltySummary | null;
  draw_profile?: DrawProfile | null;
  three_star_summary?: ThreeStarSummary | null;
  tracking_summary?: TrackingSummary | null;
  anti_hot_selection_schema?: 'recent_weighted_scoring_single_rotation_structure_fatigue_v1';
  anti_hot_selection_penalty_summary?: {
    schema: 'recent_weighted_scoring_single_rotation_structure_fatigue_v1';
    enabled: boolean;
    window: number;
    min_factor: number;
    penalized_numbers: number[];
    reason_text: string;
  } | null;
  combo_support_summary?: ComboSupportSummary | null;
  bet_advice?: {
    score: number;
    advice_score: number;
    level: 'STRONG' | 'SMALL' | 'WATCH' | 'AVOID';
    label: string;
    confidence: string;
    reason_text: string;
    risk_flags: string[];
  } | null;
  confidence_label: string;
  recommendation: string;
  data_status: DataStatus;
  cached?: boolean;
  cache_latest_draw_no?: string | null;
  prediction_updated_at?: string | null;
  locked?: boolean;
  version?: number;
  model_version?: string;
  strategy?: string;
  observation_status?: ObservationStatus;
  reasons?: Record<number, string>;
  featureSummary?: FeatureSummary;
}

export interface NumberScoreRow {
  number: number;
  count10: number;
  count20: number;
  count30: number;
  count50?: number;
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
  antihot_factor: number;
  anti_hot_adjusted_score: number;
  antihot_reason: string;
  recent_selection_window_hit_count?: number;
  selection_score_before_penalty?: number;
  selection_score_after_penalty?: number;
  selection_penalty_factor?: number;
  selection_penalty_reason?: string;
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
  odd_even_balance_score: number;
  big_small_balance_score: number;
  zone_balance_score: number;
  tail_balance_score: number;
  consecutive_score: number;
  repeat_overlap_score: number;
  total_balance_score: number;
  rank: number;
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

export interface FeatureSummary {
  hotNumbers_30: number[];
  shortHotNumbers_10: number[];
  hotTails: number[];
  highGapNumbers: number[];
  lastDrawNumbers: number[];
}

export interface BacktestRow {
  id: number;
  run_date: string;
  window_size: number;
  strategy_name: string;
  hit_rate_single: number | null;
  hit_rate_two?: number | null;
  hit_rate_three: number | null;
  hit_rate_four: number | null;
  hit_rate_five: number | null;
  avg_hits_two?: number | null;
  avg_hits_three: number | null;
  avg_hits_four: number | null;
  avg_hits_five: number | null;
  avg_hits?: number | null;
  max_losing_streak_two?: number | null;
  max_losing_streak_three?: number | null;
  max_losing_streak_four?: number | null;
  max_losing_streak_five?: number | null;
  max_losing_streak: number | null;
  sample_size?: number | null;
  tested_draws?: number | null;
  audit_status?: string | null;
  score: number | null;
}

export interface SyncLogRow {
  id: number | string;
  started_at: string;
  finished_at: string | null;
  type: string;
  status: 'running' | 'success' | 'failed' | 'partial' | 'pending' | 'recovered';
  active_source: string | null;
  source?: string | null;
  source_url: string | null;
  selected_source?: string | null;
  selected_url?: string | null;
  fallback_used?: boolean | null;
  attempted_sources?: Array<{
    source?: string | null;
    url?: string | null;
    status?: string | null;
    error?: string | null;
  }> | null;
  retry_count: number;
  retry?: number;
  retry_stage: string | null;
  recovery_mode: number;
  latest_draw_no_before: string | null;
  latest_draw_no_after: string | null;
  new_draws_inserted: number;
  inserted_count: number;
  inserted?: number;
  message: string | null;
  diagnostic: string | null;
  error_stack: string | null;
}

export interface StrategyWeightRow {
  id: number;
  strategy_name: string;
  weight: number;
  last_score: number | null;
  updated_at: string;
}

export interface AppConfig {
  officialApiUrl: string;
  officialApiCandidates: string[];
  officialHtmlUrl: string;
  optionalSecondarySourceUrl: string;
  syncIntervalMinutes: number;
  recoveryRetryMinutes: number;
  tw_lottery_api_latest: string;
  tw_lottery_history_url: string;
  verify_source_enabled: boolean;
  verify_source_url: string;
  auto_sync_interval_minutes: number;
  sync_cron: string;
  pilio: {
    enabled: boolean;
    baseUrl: string;
    pages: number;
    mode: 'verifyOnly' | 'backup';
    requestDelayMs: number;
    timeoutMs: number;
  };
  dataSourceHealth?: DataStatusReport;
}
