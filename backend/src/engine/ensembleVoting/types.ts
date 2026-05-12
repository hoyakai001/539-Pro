/**
 * ensembleVoting/types.ts
 *
 * 與 multiStrategy/types.ts 的差異：
 *   multiStrategy: 每個 strategy 回傳「對 baseline 的 score 調整」→ 加權求和
 *   ensembleVoting: 每個 strategy 回傳「獨立 ranking + topK + 投票」→ meta voting
 *
 * 重點：strategy 不再依附 baseline 分數。trend strategy 用 baseline 是合理的
 * （它本來就是「沿用 baseline 熱度」的語意），但其他 4 個 strategy 完全
 * 走自己的特徵 → 自己的 ranking，避免「score += xxx」這種 baseline++ 行為。
 */

export type EnsembleStrategyName =
  | 'trend'
  | 'balance'
  | 'anti_concentration'
  | 'reversion'
  | 'coverage';

export const ENSEMBLE_STRATEGIES: readonly EnsembleStrategyName[] = [
  'trend',
  'balance',
  'anti_concentration',
  'reversion',
  'coverage',
] as const;

/** 1-39 → score（任意尺度；meta voting 內部 min-max 為 0-100 後使用） */
export interface PerNumberScores {
  [n: number]: number;
}

/** 1-39 → vote weight（0-1；0 表示該 strategy 沒投票給該號） */
export interface PerNumberVotes {
  [n: number]: number;
}

export interface EnsembleStrategyVote {
  name: EnsembleStrategyName;
  /** 完整 01-39 的獨立排名（index 0 = 該 strategy 認為最該選；長度永遠 39） */
  ranking: number[];
  /** 該 strategy 自選的 top-K（K = config.topK；通常 10） */
  topK: number[];
  /** 該 strategy 對每個 01-39 的投票權重（topK 外 = 0；topK 內按排名位置線性遞減） */
  votes: PerNumberVotes;
  /** 0-1，該 strategy 對自己 topK 排名強度的信心（用 topK 內 score 落差衡量） */
  confidence: number;
  /** raw scores（debug 用，非 ranking 來源；meta voting 不直接使用） */
  rawScores: PerNumberScores;
  diagnostic: Record<string, number | string | boolean>;
}

export interface RecentRecommendation {
  three_star: number[];
  five_star: number[];
}

/** Meta voting 對單個 01-39 號碼的完整資訊 */
export interface NumberMetaVote {
  number: number;
  trend_vote: number;
  balance_vote: number;
  anti_concentration_vote: number;
  reversion_vote: number;
  coverage_vote: number;
  /** 該號碼出現在幾個 strategy 的 topK 內（0-5） */
  support_strategy_count: number;
  /** support_strategy_count / 5，0-1 */
  cross_strategy_consensus: number;
  /** 是否僅有 trend 一個 strategy 支持 */
  trend_only: boolean;
  /** dominance penalty 倍率（0-1，1 = 不降；越小越降） */
  dominance_penalty: number;
  /** pair lock penalty 倍率（0-1） */
  pair_lock_penalty: number;
  /** triple lock penalty 倍率（0-1） */
  triple_lock_penalty: number;
  // ─── Phase 2.5：號碼曝光控制 ────────────────────────────────────────
  /** 最近 N 期 five_star 中該號出現次數 */
  recent_number_exposure: number;
  /** 最近 N 期 three_star 中該號出現次數（更窄的「核心群」訊號） */
  core_group_exposure: number;
  /** exposure 觸發的 soft penalty 倍率（0-1） */
  exposure_penalty: number;
  /** core group exposure 觸發的 soft penalty 倍率（0-1） */
  core_group_penalty: number;
  /** post-processing 對 trend top10 過度集中時加上的 soft penalty 倍率（0-1） */
  hot_top10_penalty: number;
  /** consensus_protection 是否生效（support >= MIN_SUPPORT 時 true） */
  consensus_protected: boolean;
  /** structure_adjust 倍率（範圍 [1-W, 1+W]；W=0 或 disabled 時 = 1.0） */
  structure_factor: number;
  /** dynamic_window 倍率（範圍 [1-W, 1+W]；disabled / dormant 時 = 1.0） */
  dynamic_window_factor: number;
  /** weighted vote 累計，未套 penalty 前 */
  base_vote_score: number;
  /** 套完 dominance / pair-lock / triple-lock 後的最終投票分數 */
  final_vote_score: number;
  /** 由 final_vote_score 降冪後的 rank（1 = 第一名） */
  final_vote_rank: number;
}

export interface EnsembleVotingResult {
  /** 1-39 → NumberMetaVote */
  meta: Record<number, NumberMetaVote>;
  /** 由 final_vote_score 降冪排序的 01-39 */
  ranking: number[];
  /** 五星 / 四星 / 三星 / 二星 / single（由 ranking 取前 N） */
  picks: {
    single: number;
    two_star: number[];
    three_star: number[];
    four_star: number[];
    five_star: number[];
  };
  /** 各 strategy 的原始 vote table（diagnostic） */
  strategyVoteTable: Record<EnsembleStrategyName, PerNumberVotes>;
  /** 各 strategy confidence */
  strategyConfidence: Record<EnsembleStrategyName, number>;
  /** final top10 中 trend-only 數量 / 比例 */
  trend_only_count: number;
  trend_only_ratio: number;
  /** 套用 anti-dominance 時實際 soft penalty 的號碼數 */
  dominance_penalty_applied: number;
  pair_lock_penalty_applied: number;
  triple_lock_penalty_applied: number;
  // Phase 2.5 diagnostic counters
  exposure_penalty_applied: number;
  core_group_penalty_applied: number;
  hot_top10_penalty_applied: number;
  consensus_protected_count: number;
  structure_adjust_applied: number;
  structure_mean_factor: number;
  dynamic_window_applied: number;
  dynamic_window_mean_factor: number;
  dynamic_window_dormant_reason: string | null;
}
