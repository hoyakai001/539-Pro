/**
 * multiStrategy/index.ts — Public entry
 *
 * applyMultiStrategy(prediction, draws, recentRecommendations)
 *   → 若 MULTI_STRATEGY_ENABLED=true：跑 5 策略 ensemble，回傳重新挑選的 prediction
 *   → 若 disabled：原樣回 baseline prediction
 *
 * Backwards-compat：API 結構完全保留（single/two_star/.../number_scores/strategy_scores/combo_support_summary）。
 * 只新增 strategy_scores 內 diagnostic 欄位。
 */

import type { DrawEntry } from '../features';
import type { StatisticalPrediction } from '../statisticalPrediction';
import type { PreviousPredictionContext } from '../AdvancedStatsModel';
import { sortNumbers } from '../../utils/numbers';
import { getMultiStrategyConfig, isMultiStrategyEnabled } from './config';
import {
  trendStrategy,
  balanceStrategy,
  antiConcentrationStrategy,
  reversionStrategy,
  coverageStrategy,
} from './strategies';
import { aggregate, rerank, classifyTiers } from './aggregator';
import type { PerNumberScores, RecentRecommendation, StrategyName } from './types';

export { isMultiStrategyEnabled, getMultiStrategyConfig, MULTI_STRATEGY_DEFAULT_VERSION } from './config';

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
  // current "previous" 自己也算一筆（最近一次推薦）
  if (prev.five_star?.length || prev.three_star?.length) {
    seq.push({
      three_star: prev.three_star ?? [],
      five_star: prev.five_star?.length ? prev.five_star : [...new Set([...(prev.three_star ?? []), ...(prev.four_star ?? [])])],
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

export interface ApplyMultiStrategyResult {
  prediction: StatisticalPrediction;
  applied: boolean;
}

export function applyMultiStrategy(
  prediction: StatisticalPrediction,
  draws: DrawEntry[],
  previousPrediction?: PreviousPredictionContext | null,
): ApplyMultiStrategyResult {
  if (!isMultiStrategyEnabled()) {
    return { prediction, applied: false };
  }
  const config = getMultiStrategyConfig();
  const baseline = buildBaselineScoreMap(prediction.number_scores);
  const recent = recentFromObservations(previousPrediction ?? null);

  const votes = {
    trend: trendStrategy(baseline),
    balance: balanceStrategy(baseline, draws),
    anti_concentration: antiConcentrationStrategy(baseline, recent, config),
    reversion: reversionStrategy(baseline, draws, recent, config),
    coverage: coverageStrategy(baseline, recent, config),
  } satisfies Record<StrategyName, ReturnType<typeof trendStrategy>>;

  const ensemble = aggregate(votes, config);
  const reranked = rerank(ensemble.finalScores, draws, config);

  // baseline 5 vs ensemble 5 — 計算 coverage_improvement / repeat_reduction
  const baselineFive = new Set(prediction.five_star);
  const ensembleFive = new Set(reranked.five_star);
  const swapped = [...ensembleFive].filter(n => !baselineFive.has(n));
  const tiers = classifyTiers(draws);
  const hotInBaseline = [...baselineFive].filter(n => tiers.hot.has(n)).length;
  const hotInEnsemble = [...ensembleFive].filter(n => tiers.hot.has(n)).length;
  const recentPool = new Set<number>();
  for (const r of recent.slice(0, config.recentRecommendWindow)) for (const n of r.five_star) recentPool.add(n);
  const baselineNewToPool = [...baselineFive].filter(n => !recentPool.has(n)).length;
  const ensembleNewToPool = [...ensembleFive].filter(n => !recentPool.has(n)).length;

  // 最近 N 期推薦中與 baseline / ensemble 重複的 pair 數
  function countPairOverlap(picks: Set<number>): number {
    const arr = [...picks].sort((a, b) => a - b);
    const present = new Set<string>();
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) present.add(`${arr[i]},${arr[j]}`);
    }
    let total = 0;
    for (const r of recent.slice(0, config.recentRecommendWindow)) {
      const five = [...new Set(r.five_star)].sort((a, b) => a - b);
      for (let i = 0; i < five.length; i++) {
        for (let j = i + 1; j < five.length; j++) {
          if (present.has(`${five[i]},${five[j]}`)) total++;
        }
      }
    }
    return total;
  }
  const baselinePairRepeat = countPairOverlap(baselineFive);
  const ensemblePairRepeat = countPairOverlap(ensembleFive);

  // 更新 number_scores 的 selected_in_* flags（讓 UI 與 verify 一致）
  const updatedNumberScores = prediction.number_scores.map(row => ({
    ...row,
    selected_in_single: row.number === reranked.single,
    selected_in_two_star: reranked.two_star.includes(row.number),
    selected_in_three_star: reranked.three_star.includes(row.number),
    selected_in_four_star: reranked.four_star.includes(row.number),
    selected_in_five_star: reranked.five_star.includes(row.number),
  }));

  // 補強 strategy_scores diagnostic
  // strategy_scores 型別是 Record<string, number | string | boolean>
  const avgOver = (picks: number[], scores: PerNumberScores): number => {
    if (!picks.length) return 0;
    const total = picks.reduce((s, n) => s + (scores[n] ?? 0), 0);
    return Math.round(total / picks.length * 100) / 100;
  };

  const strategyScores: Record<string, number | string | boolean> = {
    ...prediction.strategy_scores,
    multi_strategy_enabled: true,
    multi_strategy_version: config.version,
    strategy_weights: JSON.stringify(ensemble.weights),
    strategy_contributions: JSON.stringify({
      trend: round(ensemble.contributions.trend),
      balance: round(ensemble.contributions.balance),
      anti_concentration: round(ensemble.contributions.anti_concentration),
      reversion: round(ensemble.contributions.reversion),
      coverage: round(ensemble.contributions.coverage),
    }),
    strategy_votes: JSON.stringify({
      trend: votes.trend.diagnostic,
      balance: votes.balance.diagnostic,
      anti_concentration: votes.anti_concentration.diagnostic,
      reversion: votes.reversion.diagnostic,
      coverage: votes.coverage.diagnostic,
    }),
    trend_score: avgOver(reranked.five_star, votes.trend.scores),
    balance_score: avgOver(reranked.five_star, votes.balance.scores),
    anti_concentration_score: avgOver(reranked.five_star, votes.anti_concentration.scores),
    reversion_score: avgOver(reranked.five_star, votes.reversion.scores),
    coverage_score: avgOver(reranked.five_star, votes.coverage.scores),
    final_ensemble_score: avgOver(reranked.five_star, ensemble.finalScores),
    concentration_penalty: round(votes.anti_concentration.scores[reranked.single] ?? 0),
    reversion_bonus: config.reversionBonus,
    coverage_bonus: config.coverageBonus,
    coverage_improvement: ensembleNewToPool - baselineNewToPool,
    repeat_reduction: baselinePairRepeat - ensemblePairRepeat,
    hot_count_in_five_star: hotInEnsemble,
    mid_cold_count_in_five_star: 5 - hotInEnsemble,
    ensemble_swap_count: reranked.swapCount,
    baseline_hot_count: hotInBaseline,
    swapped_in: swapped.length,
  };

  const updated: StatisticalPrediction = {
    ...prediction,
    single: reranked.single,
    single_number: reranked.single,
    two_star: sortNumbers(reranked.two_star),
    three_star: sortNumbers(reranked.three_star),
    four_star: sortNumbers(reranked.four_star),
    five_star: sortNumbers(reranked.five_star),
    numbers: sortNumbers(reranked.five_star),
    number_scores: updatedNumberScores,
    number_scores_json: updatedNumberScores,
    strategy_scores: strategyScores,
    strategy: `${prediction.strategy}|${config.version}`,
  };

  return { prediction: updated, applied: true };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
