/**
 * ensembleVoting/metaVoting.ts — Meta Voting Layer
 *
 * 流程：
 *   1. 收集 5 個 strategy 的 vote map（每個 strategy 自己 topK，外面為 0）
 *   2. 對每個 01-39 計算：
 *        trend_vote / balance_vote / anti_concentration_vote / reversion_vote / coverage_vote
 *        support_strategy_count = #strategies with vote > 0
 *        cross_strategy_consensus = support_strategy_count / 5
 *        trend_only = (support_strategy_count === 1 && trend_vote > 0)
 *        base_vote_score = sum(weight[s] * vote[s][n])
 *   3. 計算 pair / triple lock penalty：
 *        - 從最近 N 期 prediction 五星中統計 pair / triple 出現次數
 *        - 若某 pair 在 window 內出現 > pairLockMaxRepeat：penalty 套用到該 pair 兩個號碼
 *        - 若某 triple 出現 > tripleLockMaxRepeat：penalty 套用到該 triple 三個號碼
 *        - 多次觸發 → 倍率累乘
 *   4. 計算 dominance penalty：
 *        - 若 number 是 trend_only 且 support_strategy_count < minSupportStrategies：
 *          套用 trendOnlyPenalty 倍率
 *   5. final_vote_score = base_vote_score * dominance_penalty * pair_lock_penalty * triple_lock_penalty
 *   6. final_vote_rank 由 final_vote_score 排序
 *   7. Anti-Dominance 後處理：若 top10 中 trend-only 比例 > maxTrendOnlyTop10Ratio，
 *      對剩餘的 trend-only 號碼再套一次衰減後重排（仍 deterministic）
 *
 * 嚴格禁止：random / blacklist / hard ban。所有 penalty 都是 deterministic 倍率。
 */

import type { DrawEntry } from '../features';
import type { EnsembleVotingConfig } from './config';
import type {
  EnsembleStrategyVote,
  EnsembleVotingResult,
  NumberMetaVote,
  PerNumberVotes,
  RecentRecommendation,
  EnsembleStrategyName,
} from './types';
import { computeStructureFactor, type StructureFactorResult } from './structureAdjust';
import { computeDynamicWindowFactor, type DynamicWindowResult } from './dynamicWindow';

const ALL_NUMBERS = Array.from({ length: 39 }, (_, i) => i + 1);

/** 從最近 N 期 five_star 統計 pair / triple 出現次數 */
function buildPairTripleHits(recent: RecentRecommendation[], window: number) {
  const slice = recent.slice(0, window);
  const pairHits = new Map<string, number>();
  const tripleHits = new Map<string, number>();
  for (const r of slice) {
    const five = [...new Set(r.five_star)].sort((a, b) => a - b);
    for (let i = 0; i < five.length; i++) {
      for (let j = i + 1; j < five.length; j++) {
        const pk = `${five[i]},${five[j]}`;
        pairHits.set(pk, (pairHits.get(pk) ?? 0) + 1);
        for (let k = j + 1; k < five.length; k++) {
          const tk = `${five[i]},${five[j]},${five[k]}`;
          tripleHits.set(tk, (tripleHits.get(tk) ?? 0) + 1);
        }
      }
    }
  }
  return { pairHits, tripleHits };
}

function computePairLockPenalty(
  number: number,
  pairHits: Map<string, number>,
  config: EnsembleVotingConfig,
): number {
  let factor = 1.0;
  for (const [k, count] of pairHits) {
    if (count <= config.pairLockMaxRepeat) continue;
    const [a, b] = k.split(',').map(Number);
    if (a === number || b === number) {
      factor *= config.pairLockPenalty;
    }
  }
  return factor;
}

function computeTripleLockPenalty(
  number: number,
  tripleHits: Map<string, number>,
  config: EnsembleVotingConfig,
): number {
  let factor = 1.0;
  for (const [k, count] of tripleHits) {
    if (count <= config.tripleLockMaxRepeat) continue;
    const [a, b, c] = k.split(',').map(Number);
    if (a === number || b === number || c === number) {
      factor *= config.tripleLockPenalty;
    }
  }
  return factor;
}

/** Tie-break：final_vote_score 高者前；同分時號碼小者前（deterministic） */
function rankNumbers(meta: Record<number, NumberMetaVote>): number[] {
  return [...ALL_NUMBERS].sort((a, b) => {
    const diff = (meta[b]?.final_vote_score ?? 0) - (meta[a]?.final_vote_score ?? 0);
    if (Math.abs(diff) > 1e-9) return diff;
    return a - b;
  });
}

/**
 * 跨策略共識保護：support 達門檻時，把 penalty 嚴重度乘以 factor。
 *   penalty = 1 + (penalty - 1) * factor
 *   factor=0 → penalty 變 1.0（完全保護）
 *   factor=0.5 → penalty 與 1.0 的距離減半（嚴重度減半，但仍保留方向）
 *   factor=1 → 無保護
 */
function applyConsensusProtection(
  penalty: number,
  supportCount: number,
  config: EnsembleVotingConfig,
): { penalty: number; protected: boolean } {
  if (penalty >= 1.0) return { penalty, protected: false };
  if (supportCount < config.consensusProtectionMinSupport) return { penalty, protected: false };
  const f = config.consensusProtectionFactor;
  return { penalty: 1 + (penalty - 1) * f, protected: true };
}

/** 統計最近 N 期 five_star 中每個 01-39 出現次數 */
function buildExposureCounts(recent: RecentRecommendation[], window: number, slot: 'five_star' | 'three_star'): Record<number, number> {
  const counts: Record<number, number> = {};
  for (let n = 1; n <= 39; n++) counts[n] = 0;
  for (const r of recent.slice(0, window)) {
    const arr = r[slot] ?? [];
    for (const n of new Set(arr)) counts[n] = (counts[n] ?? 0) + 1;
  }
  return counts;
}

export function metaVote(
  votes: Record<EnsembleStrategyName, EnsembleStrategyVote>,
  recent: RecentRecommendation[],
  config: EnsembleVotingConfig,
  draws?: DrawEntry[],
): EnsembleVotingResult {
  const { pairHits, tripleHits } = buildPairTripleHits(recent, config.pairLockWindow);
  // triple 視窗可能不同；分開算
  const { tripleHits: tripleHitsAdjusted } = buildPairTripleHits(recent, config.tripleLockWindow);
  // Phase 2.5：number-level exposure counts
  const exposureFive = buildExposureCounts(recent, config.numberExposureWindow, 'five_star');
  const exposureThree = buildExposureCounts(recent, config.coreGroupWindow, 'three_star');

  const meta: Record<number, NumberMetaVote> = {};
  let dominance_penalty_applied = 0;
  let pair_lock_penalty_applied = 0;
  let triple_lock_penalty_applied = 0;
  let exposure_penalty_applied = 0;
  let core_group_penalty_applied = 0;
  let hot_top10_penalty_applied = 0;
  let consensus_protected_count = 0;

  for (const n of ALL_NUMBERS) {
    const trend_vote = votes.trend.votes[n] ?? 0;
    const balance_vote = votes.balance.votes[n] ?? 0;
    const anti_concentration_vote = votes.anti_concentration.votes[n] ?? 0;
    const reversion_vote = votes.reversion.votes[n] ?? 0;
    const coverage_vote = votes.coverage.votes[n] ?? 0;

    const supportFlags = [
      trend_vote > 0,
      balance_vote > 0,
      anti_concentration_vote > 0,
      reversion_vote > 0,
      coverage_vote > 0,
    ];
    const support_strategy_count = supportFlags.filter(Boolean).length;
    const cross_strategy_consensus = support_strategy_count / 5;
    const trend_only = support_strategy_count === 1 && trend_vote > 0;

    const base_vote_score =
      config.strategyWeights.trend * trend_vote +
      config.strategyWeights.balance * balance_vote +
      config.strategyWeights.anti_concentration * anti_concentration_vote +
      config.strategyWeights.reversion * reversion_vote +
      config.strategyWeights.coverage * coverage_vote;

    // Dominance penalty：trend-only + 不滿足 minSupportStrategies
    let dominance_penalty = 1.0;
    if (trend_only && support_strategy_count < config.minSupportStrategies) {
      dominance_penalty = config.trendOnlyPenalty;
      dominance_penalty_applied++;
    }

    const pair_lock_penalty_raw = computePairLockPenalty(n, pairHits, config);
    const triple_lock_penalty_raw = computeTripleLockPenalty(n, tripleHitsAdjusted, config);

    // Phase 2.5：number-level exposure penalties
    const recent_number_exposure = exposureFive[n] ?? 0;
    const core_group_exposure = exposureThree[n] ?? 0;

    let exposure_penalty_raw = 1.0;
    if (recent_number_exposure > config.numberExposureMaxRepeat) {
      const overflow = recent_number_exposure - config.numberExposureMaxRepeat;
      exposure_penalty_raw = Math.pow(config.numberExposurePenalty, overflow);
    }
    let core_group_penalty_raw = 1.0;
    if (core_group_exposure > config.coreGroupMaxExposure) {
      const overflow = core_group_exposure - config.coreGroupMaxExposure;
      core_group_penalty_raw = Math.pow(config.coreGroupPenalty, overflow);
    }

    // 跨策略共識保護：support 多 → 即使曝光高也只減半（不是因為熱就被打掉）
    const ep = applyConsensusProtection(exposure_penalty_raw, support_strategy_count, config);
    const cp = applyConsensusProtection(core_group_penalty_raw, support_strategy_count, config);
    const plp = applyConsensusProtection(pair_lock_penalty_raw, support_strategy_count, config);
    const tlp = applyConsensusProtection(triple_lock_penalty_raw, support_strategy_count, config);

    const exposure_penalty = ep.penalty;
    const core_group_penalty = cp.penalty;
    const pair_lock_penalty = plp.penalty;
    const triple_lock_penalty = tlp.penalty;
    const consensus_protected = ep.protected || cp.protected || plp.protected || tlp.protected;

    if (exposure_penalty < 1.0) exposure_penalty_applied++;
    if (core_group_penalty < 1.0) core_group_penalty_applied++;
    if (pair_lock_penalty < 1.0) pair_lock_penalty_applied++;
    if (triple_lock_penalty < 1.0) triple_lock_penalty_applied++;
    if (consensus_protected) consensus_protected_count++;

    const final_vote_score =
      base_vote_score *
      dominance_penalty *
      pair_lock_penalty *
      triple_lock_penalty *
      exposure_penalty *
      core_group_penalty;

    meta[n] = {
      number: n,
      trend_vote,
      balance_vote,
      anti_concentration_vote,
      reversion_vote,
      coverage_vote,
      support_strategy_count,
      cross_strategy_consensus,
      trend_only,
      dominance_penalty,
      pair_lock_penalty,
      triple_lock_penalty,
      recent_number_exposure,
      core_group_exposure,
      exposure_penalty,
      core_group_penalty,
      hot_top10_penalty: 1.0,  // 後處理填入
      structure_factor: 1.0,    // 後處理填入（若啟用）
      dynamic_window_factor: 1.0,  // 後處理填入（若啟用）
      consensus_protected,
      base_vote_score,
      final_vote_score,
      final_vote_rank: 0,  // 下一步填入
    };
  }

  let ranking = rankNumbers(meta);

  // ── Structure Adjustment（輕量結構修正；soft 倍率）───────────────────
  // 在 base/penalty 計算結束、ranking 算完後，套一次乘性微調。
  // 預設關閉（W=0 或 ENABLED=false）；啟用時最多 ±W 倍率（W ≤ 0.5）。
  // 結構訊號全部從歷史 draws 與最近 prediction 推導，無任何 hardcoded 號碼。
  let structure_adjust_applied = 0;
  let structure_mean_factor = 1.0;
  let structureResult: StructureFactorResult | null = null;
  if (config.structureAdjustEnabled && config.structureAdjustWeight > 0 && draws && draws.length > 0) {
    structureResult = computeStructureFactor(draws, recent, config);
    structure_adjust_applied = structureResult.applied_count;
    structure_mean_factor = structureResult.mean_factor;
    for (const n of ALL_NUMBERS) {
      const factor = structureResult.factors[n] ?? 1.0;
      meta[n].structure_factor = factor;
      meta[n].final_vote_score *= factor;
    }
    ranking = rankNumbers(meta);
  } else {
    for (const n of ALL_NUMBERS) meta[n].structure_factor = 1.0;
  }

  // ── Dynamic Window soft re-weighting（v1）─────────────────────────────
  // 在 structure_adjust 之後、anti-dominance 之前。
  // 預設關閉（W=0 或 ENABLED=false 或 draws 不夠 → dormant no-op）。
  // 訊號從真實歷史開獎多視窗加權頻率推導，無 hardcoded 號碼、不使用隨機數。
  let dynamic_window_applied = 0;
  let dynamic_window_mean_factor = 1.0;
  let dynamic_window_dormant_reason: string | null = null;
  if (config.dynamicWindowEnabled && config.dynamicWindowWeight > 0 && draws && draws.length > 0) {
    const dwResult: DynamicWindowResult = computeDynamicWindowFactor(draws, config);
    dynamic_window_applied = dwResult.applied_count;
    dynamic_window_mean_factor = dwResult.mean_factor;
    dynamic_window_dormant_reason = dwResult.dormant_reason;
    if (!dwResult.dormant_reason) {
      for (const n of ALL_NUMBERS) {
        const factor = dwResult.factors[n] ?? 1.0;
        meta[n].dynamic_window_factor = factor;
        meta[n].final_vote_score *= factor;
      }
      ranking = rankNumbers(meta);
    }
  } else {
    dynamic_window_dormant_reason = 'feature disabled';
  }

  // Anti-Dominance 後處理：若 top10 中 trend-only 比例過高 → 對 trend-only 額外衰減 → 重排
  const top10 = ranking.slice(0, 10);
  let trend_only_count = top10.filter(n => meta[n].trend_only).length;
  let trend_only_ratio = trend_only_count / Math.max(1, top10.length);
  if (trend_only_ratio > config.maxTrendOnlyTop10Ratio) {
    for (const n of ALL_NUMBERS) {
      if (meta[n].trend_only) {
        const extra = config.trendOnlyPenalty;
        meta[n].dominance_penalty *= extra;
        meta[n].final_vote_score *= extra;
        dominance_penalty_applied++;
      }
    }
    ranking = rankNumbers(meta);
  }

  // Phase 2.5：hot_top10 後處理 — 若 final top10 中 trend-topK 號比例過高 → 對該些號套 soft penalty 再重排
  const trendTopK = new Set(votes.trend.topK);
  let hotTop10 = ranking.slice(0, 10);
  let hotCount = hotTop10.filter(n => trendTopK.has(n)).length;
  let hotRatio = hotCount / Math.max(1, hotTop10.length);
  if (hotRatio > config.hotTop10MaxRatio) {
    // 只對「current top10 中且屬於 trend topK 的號」套 hot_top10_penalty（受 consensus protection）
    for (const n of hotTop10) {
      if (!trendTopK.has(n)) continue;
      const hp = applyConsensusProtection(config.hotTop10Penalty, meta[n].support_strategy_count, config);
      meta[n].hot_top10_penalty = hp.penalty;
      meta[n].final_vote_score *= hp.penalty;
      hot_top10_penalty_applied++;
      if (hp.protected && !meta[n].consensus_protected) {
        meta[n].consensus_protected = true;
        consensus_protected_count++;
      }
    }
    ranking = rankNumbers(meta);
  }

  // 填入 final_vote_rank
  ranking.forEach((n, idx) => { meta[n].final_vote_rank = idx + 1; });

  // 重新統計 trend_only 在最終 top10
  const finalTop10 = ranking.slice(0, 10);
  trend_only_count = finalTop10.filter(n => meta[n].trend_only).length;
  trend_only_ratio = trend_only_count / Math.max(1, finalTop10.length);

  const five = ranking.slice(0, 5);
  const picks = {
    single: five[0],
    two_star: five.slice(0, 2),
    three_star: five.slice(0, 3),
    four_star: five.slice(0, 4),
    five_star: five.slice(0, 5),
  };

  const strategyVoteTable: Record<EnsembleStrategyName, PerNumberVotes> = {
    trend: votes.trend.votes,
    balance: votes.balance.votes,
    anti_concentration: votes.anti_concentration.votes,
    reversion: votes.reversion.votes,
    coverage: votes.coverage.votes,
  };

  const strategyConfidence: Record<EnsembleStrategyName, number> = {
    trend: votes.trend.confidence,
    balance: votes.balance.confidence,
    anti_concentration: votes.anti_concentration.confidence,
    reversion: votes.reversion.confidence,
    coverage: votes.coverage.confidence,
  };

  return {
    meta,
    ranking,
    picks,
    strategyVoteTable,
    strategyConfidence,
    trend_only_count,
    trend_only_ratio,
    dominance_penalty_applied,
    pair_lock_penalty_applied,
    triple_lock_penalty_applied,
    exposure_penalty_applied,
    core_group_penalty_applied,
    hot_top10_penalty_applied,
    consensus_protected_count,
    structure_adjust_applied,
    structure_mean_factor,
    dynamic_window_applied,
    dynamic_window_mean_factor,
    dynamic_window_dormant_reason,
  };
}
