/**
 * ensembleVoting/index.ts — Public entry
 *
 * applyEnsembleVoting(prediction, draws, previousPrediction)
 *   - ENSEMBLE_VOTING_ENABLED=false → 原樣回傳輸入 prediction（no-op）
 *   - ENSEMBLE_VOTING_ENABLED=true  → 跑 5 個獨立 ranking + meta voting，
 *     回傳 single/two/three/four/five_star 重新排序的 prediction，
 *     並把 diagnostic 塞進 strategy_scores 與 number_scores 的可選欄位。
 *
 * 設計原則：
 *   - 此函式應在 applyMultiStrategy 之後呼叫，作為「最終仲裁層」。
 *     若 baseline / multi_strategy_v1 已經跑完，輸入 prediction 的 number_scores
 *     是該層的 normalized_score（0-100），這正是 trend strategy 的 baseline 來源。
 *   - 此函式只改寫 single/two_star/three_star/four_star/five_star、selected_in_*
 *     旗標、strategy_scores 內的 ensemble_* 欄位，以及 number_scores 內可選欄位。
 *   - 保留所有原有欄位，frontend 不應 break。
 */

import type { DrawEntry } from '../features';
import type { StatisticalPrediction } from '../statisticalPrediction';
import type { PreviousPredictionContext } from '../AdvancedStatsModel';
import { sortNumbers } from '../../utils/numbers';
import { getEnsembleVotingConfig, isEnsembleVotingEnabled } from './config';
import {
  trendStrategy,
  balanceStrategy,
  antiConcentrationStrategy,
  reversionStrategy,
  coverageStrategy,
} from './strategies';
import { metaVote } from './metaVoting';
import type {
  EnsembleStrategyName,
  EnsembleStrategyVote,
  PerNumberScores,
  RecentRecommendation,
} from './types';

export {
  isEnsembleVotingEnabled,
  getEnsembleVotingConfig,
  ENSEMBLE_VOTING_DEFAULT_VERSION,
} from './config';
export type { EnsembleVotingConfig } from './config';

const ALL_NUMBERS = Array.from({ length: 39 }, (_, i) => i + 1);

function buildBaselineScoreMap(numberScores: StatisticalPrediction['number_scores']): PerNumberScores {
  const m: PerNumberScores = {};
  for (const n of ALL_NUMBERS) m[n] = 0;
  for (const row of numberScores) {
    if (typeof row.number === 'number' && Number.isFinite(row.normalized_score)) {
      m[row.number] = row.normalized_score;
    }
  }
  return m;
}

function recentFromObservations(prev: PreviousPredictionContext | null | undefined): RecentRecommendation[] {
  if (!prev) return [];
  const seq: RecentRecommendation[] = [];
  if (prev.five_star?.length || prev.three_star?.length) {
    seq.push({
      three_star: prev.three_star ?? [],
      five_star: prev.five_star?.length
        ? prev.five_star
        : [...new Set([...(prev.three_star ?? []), ...(prev.four_star ?? [])])],
    });
  }
  for (const obs of prev.recent_observations ?? []) {
    seq.push({
      three_star: obs.selected_three_star ?? [],
      five_star: obs.selected_five_star?.length
        ? obs.selected_five_star
        : [...new Set([...(obs.selected_three_star ?? []), ...(obs.selected_four_star ?? [])])],
    });
  }
  return seq;
}

export interface ApplyEnsembleVotingResult {
  prediction: StatisticalPrediction;
  applied: boolean;
}

export function applyEnsembleVoting(
  prediction: StatisticalPrediction,
  draws: DrawEntry[],
  previousPrediction?: PreviousPredictionContext | null,
): ApplyEnsembleVotingResult {
  if (!isEnsembleVotingEnabled()) {
    return { prediction, applied: false };
  }
  const config = getEnsembleVotingConfig();
  const baseline = buildBaselineScoreMap(prediction.number_scores);
  const recent = recentFromObservations(previousPrediction ?? null);

  const votes: Record<EnsembleStrategyName, EnsembleStrategyVote> = {
    trend: trendStrategy(baseline, config),
    balance: balanceStrategy(draws, config, baseline),
    anti_concentration: antiConcentrationStrategy(recent, config, baseline),
    reversion: reversionStrategy(draws, config, baseline),
    coverage: coverageStrategy(recent, config, baseline),
  };

  const result = metaVote(votes, recent, config);
  const five = sortNumbers(result.picks.five_star);
  const four = sortNumbers(result.picks.four_star);
  const three = sortNumbers(result.picks.three_star);
  const two = sortNumbers(result.picks.two_star);
  const single = result.picks.single;

  // 更新 number_scores：保留所有原欄位，附加 ensemble_* 可選欄位 + selected_in_*
  const updatedNumberScores = prediction.number_scores.map(row => {
    const m = result.meta[row.number];
    const ensembleFields = m
      ? {
        ensemble_votes: round(m.base_vote_score),
        support_strategies: m.support_strategy_count,
        trend_vote: round(m.trend_vote),
        balance_vote: round(m.balance_vote),
        anti_concentration_vote: round(m.anti_concentration_vote),
        reversion_vote: round(m.reversion_vote),
        coverage_vote: round(m.coverage_vote),
        cross_strategy_consensus: round(m.cross_strategy_consensus),
        dominance_penalty: round(m.dominance_penalty),
        pair_lock_penalty: round(m.pair_lock_penalty),
        triple_lock_penalty: round(m.triple_lock_penalty),
        recent_number_exposure: m.recent_number_exposure,
        core_group_exposure: m.core_group_exposure,
        exposure_penalty: round(m.exposure_penalty),
        core_group_penalty: round(m.core_group_penalty),
        hot_top10_penalty: round(m.hot_top10_penalty),
        consensus_protected: m.consensus_protected,
        final_vote_score: round(m.final_vote_score),
        final_vote_rank: m.final_vote_rank,
      }
      : {};
    return {
      ...row,
      ...ensembleFields,
      selected_in_single: row.number === single,
      selected_in_two_star: two.includes(row.number),
      selected_in_three_star: three.includes(row.number),
      selected_in_four_star: four.includes(row.number),
      selected_in_five_star: five.includes(row.number),
    };
  });

  // strategy_scores 補強 diagnostic
  const strategyScores: Record<string, number | string | boolean> = {
    ...prediction.strategy_scores,
    ensemble_voting_enabled: true,
    ensemble_voting_version: config.version,
    ensemble_strategy_weights: JSON.stringify(config.strategyWeights),
    ensemble_strategy_confidence: JSON.stringify({
      trend: round(result.strategyConfidence.trend),
      balance: round(result.strategyConfidence.balance),
      anti_concentration: round(result.strategyConfidence.anti_concentration),
      reversion: round(result.strategyConfidence.reversion),
      coverage: round(result.strategyConfidence.coverage),
    }),
    meta_votes: JSON.stringify(
      five.map(n => {
        const m = result.meta[n];
        return {
          number: n,
          rank: m.final_vote_rank,
          support: m.support_strategy_count,
          final: round(m.final_vote_score),
        };
      }),
    ),
    strategy_vote_table: JSON.stringify({
      trend: votes.trend.topK,
      balance: votes.balance.topK,
      anti_concentration: votes.anti_concentration.topK,
      reversion: votes.reversion.topK,
      coverage: votes.coverage.topK,
    }),
    trend_only_count: result.trend_only_count,
    trend_only_ratio: round(result.trend_only_ratio),
    dominance_penalty_applied: result.dominance_penalty_applied,
    pair_lock_penalty_applied: result.pair_lock_penalty_applied,
    triple_lock_penalty_applied: result.triple_lock_penalty_applied,
    exposure_penalty_applied: result.exposure_penalty_applied,
    core_group_penalty_applied: result.core_group_penalty_applied,
    hot_top10_penalty_applied: result.hot_top10_penalty_applied,
    consensus_protected_count: result.consensus_protected_count,
    ensemble_top_k: config.topK,
    ensemble_min_support_strategies: config.minSupportStrategies,
  };

  const updated: StatisticalPrediction = {
    ...prediction,
    single,
    single_number: single,
    two_star: two,
    three_star: three,
    four_star: four,
    five_star: five,
    numbers: five,
    number_scores: updatedNumberScores,
    number_scores_json: updatedNumberScores,
    strategy_scores: strategyScores,
    strategy: `${prediction.strategy}|${config.version}`,
  };

  return { prediction: updated, applied: true };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
