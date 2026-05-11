/**
 * multiStrategy/types.ts
 */

export type StrategyName = 'trend' | 'balance' | 'anti_concentration' | 'reversion' | 'coverage';

export interface PerNumberScores {
  /** 1-39 → score (任意尺度，aggregator 會 min-max normalize) */
  [n: number]: number;
}

export interface StrategyVote {
  name: StrategyName;
  /** 1-39 score map */
  scores: PerNumberScores;
  diagnostic: Record<string, number | string | boolean>;
}

export interface RecentRecommendation {
  three_star: number[];
  five_star: number[];
}

export interface EnsembleResult {
  /** 最終 1-39 ensemble score */
  finalScores: PerNumberScores;
  /** 各 strategy 經 weight 加權後對 final 的貢獻（per-strategy 總貢獻 0-100） */
  contributions: Record<StrategyName, number>;
  weights: Record<StrategyName, number>;
  /** 各 strategy 原始（normalize 前）的 score map，方便 diagnostic */
  rawScoresByStrategy: Record<StrategyName, PerNumberScores>;
}

export interface ReRankedPicks {
  single: number;
  two_star: number[];
  three_star: number[];
  four_star: number[];
  five_star: number[];
}

export interface MultiStrategyDiagnostic {
  multi_strategy_enabled: boolean;
  multi_strategy_version: string;
  strategy_weights: string;        // JSON.stringify 結果，型別配合 strategy_scores 限制
  strategy_contributions: string;  // JSON.stringify
  strategy_votes: string;          // JSON.stringify
  trend_score: number;
  balance_score: number;
  anti_concentration_score: number;
  reversion_score: number;
  coverage_score: number;
  concentration_penalty: number;
  reversion_bonus: number;
  coverage_bonus: number;
  final_ensemble_score: number;
  coverage_improvement: number;
  repeat_reduction: number;
  hot_count_in_five_star: number;
  mid_cold_count_in_five_star: number;
  ensemble_swap_count: number;
}
