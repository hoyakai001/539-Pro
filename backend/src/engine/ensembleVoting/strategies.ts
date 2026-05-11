/**
 * ensembleVoting/strategies.ts — 5 個獨立 ranking 策略
 *
 * 與 multiStrategy/strategies.ts 的關鍵差異：
 *   - 每個 strategy 用自己的特徵建立完整 01-39 ranking，不再對 baseline 做乘法調整。
 *   - 每個 strategy 自己選 topK（config.topK，預設 10），這些號才會在 meta voting
 *     階段獲得票數；topK 之外票數為 0。
 *   - 票數採「reciprocal-rank-like」遞減：rank 1 = 1.0、rank K = 1/K（線性也可，
 *     我們選線性，因為 K 通常小，曲線差異不大，但線性更可解釋）。
 *
 * 共同契約：
 *   - 輸入：draws（歷史，最新在前）、recent（最近 N 期 prediction）、baseline（trend 用）、config
 *   - 輸出：EnsembleStrategyVote
 *   - 不可使用隨機 / 不可硬編碼禁號 / 不可黑名單
 *   - 全部 deterministic（相同輸入 → 相同 ranking、相同 tie-break）
 */

import type { DrawEntry } from '../features';
import type { EnsembleVotingConfig } from './config';
import type {
  EnsembleStrategyVote,
  PerNumberScores,
  PerNumberVotes,
  RecentRecommendation,
} from './types';

const ALL_NUMBERS = Array.from({ length: 39 }, (_, i) => i + 1);

function emptyScores(initial = 0): PerNumberScores {
  const m: PerNumberScores = {};
  for (const n of ALL_NUMBERS) m[n] = initial;
  return m;
}

/**
 * 由 raw scores 產生 deterministic ranking。
 * 排序：raw score DESC → secondary tie-break score DESC（若提供）→ 號碼 ASC。
 * 永遠回傳長度 39 的 unique array。
 *
 * Secondary tie-break 的設計目的：避免「策略 raw score 大量相同（例如 anti_concentration
 * 中所有沒被推薦過的號碼都 = 0）時，tie-break 落到號碼 ASC → 低號碼自動拿到高 rank → 拿到
 * 1.0 / 0.9 / 0.8 ... 的線性遞減投票權重 → meta voting 永遠把 01 / 02 / 03 推到前面」
 * 的 low-number bias 漏洞。
 */
function rankByScores(scores: PerNumberScores, secondary?: PerNumberScores): number[] {
  return [...ALL_NUMBERS].sort((a, b) => {
    const diff = (scores[b] ?? 0) - (scores[a] ?? 0);
    if (Math.abs(diff) > 1e-9) return diff;
    if (secondary) {
      const sdiff = (secondary[b] ?? 0) - (secondary[a] ?? 0);
      if (Math.abs(sdiff) > 1e-9) return sdiff;
    }
    return a - b;
  });
}

/**
 * 由 raw scores + ranking + topK 產生 vote map。
 *
 * 核心修正（vs Phase 2.5 之前）：
 *   原版單純用 rank position 決定 vote（rank 1 = 1.0、rank K = 1/K），這在「策略 raw score
 *   大量相同」時會產生 low-number bias bug：每個策略的 ranking 內 tie-break 落到號碼 ASC，
 *   低號碼自動拿到 1.0 / 0.9 / 0.8 …，meta voting 加總後 final_vote_rank 永遠把
 *   01 / 02 / 03 / 04 推到 single/two/three/four star。
 *
 * 新版：walk ranking，識別「raw score 在 1e-9 內相同」的 tied groups，把該 group
 * 內所有位置的權重總和（topK 內位置才算）**平均分配**給 tied 成員。tied group 內每個
 * 號碼拿到相同 vote weight，沒有 number-asc bias。
 *
 * Tied group 跨越 topK 邊界時：仍把 topK 內位置的總權重平均分給所有 tied 成員
 * （包含位置 > topK 的）— tied 就是 tied，沒有「剛好 topK 內」這種人為切割。
 */
function buildVotes(scores: PerNumberScores, ranking: number[], topK: number): PerNumberVotes {
  const votes: PerNumberVotes = emptyScores(0);
  const K = Math.max(1, Math.min(topK, ranking.length));

  let i = 0;
  while (i < ranking.length) {
    if (i >= K) break;  // 後續位置都在 topK 之外，貢獻 0 權重
    const baseScore = scores[ranking[i]] ?? 0;
    // tied group: ranking[i..j-1]，raw score 與 baseScore 相差 < 1e-9
    let j = i + 1;
    while (j < ranking.length && Math.abs((scores[ranking[j]] ?? 0) - baseScore) < 1e-9) j++;

    // 該 tied group 內位於 topK 的位置：[i, min(j, K))
    const inTopKEnd = Math.min(j, K);
    let totalWeightInTopK = 0;
    for (let p = i; p < inTopKEnd; p++) totalWeightInTopK += 1 - p / K;
    // 平均分配給整個 tied group（含 K 之外的 tied 成員 — 它們與內部成員 raw score 相同，應拿等票）
    const share = totalWeightInTopK / (j - i);
    for (let p = i; p < j; p++) {
      votes[ranking[p]] = Math.max(0, Math.min(1, share));
    }
    i = j;
  }
  return votes;
}

/**
 * Strategy self-confidence：用 topK 內 score 的相對落差衡量。
 * 落差越大 → confidence 越高（表示該 strategy「分得清楚」）；
 * 落差小 → confidence 低（topK 內幾乎打平，這個 strategy 對排序沒把握）。
 */
function strategyConfidence(scores: PerNumberScores, ranking: number[], topK: number): number {
  const K = Math.max(1, Math.min(topK, ranking.length));
  const topScore = scores[ranking[0]] ?? 0;
  const tailScore = scores[ranking[K - 1]] ?? 0;
  const restScore = scores[ranking[Math.min(ranking.length - 1, K)]] ?? 0;
  const spreadInTop = Math.max(0, topScore - tailScore);
  const spreadOverall = Math.max(1e-9, topScore - restScore);
  // 0-1 之間；topK 內落差 / (整體可區分空間)
  return Math.max(0, Math.min(1, spreadInTop / (spreadInTop + spreadOverall + 1e-9)));
}

// ─── 1. Trend Strategy ─────────────────────────────────────────────────
// 完全沿用 baseline normalized_score 作為 ranking。
// 這是合理的：「trend」本來就是 baseline 的熱度語意；其他 4 個 strategy
// 才是反向 / 平衡 / 多樣化角度。
export function trendStrategy(
  baseline: PerNumberScores,
  config: EnsembleVotingConfig,
): EnsembleStrategyVote {
  const scores: PerNumberScores = emptyScores();
  for (const n of ALL_NUMBERS) scores[n] = baseline[n] ?? 0;

  const ranking = rankByScores(scores);
  const topK = ranking.slice(0, config.topK);
  const votes = buildVotes(scores, ranking, config.topK);
  const confidence = strategyConfidence(scores, ranking, config.topK);

  return {
    name: 'trend',
    ranking,
    topK,
    votes,
    confidence,
    rawScores: scores,
    diagnostic: {
      source: 'baseline_normalized_score',
      topK_size: topK.length,
      confidence: round(confidence),
    },
  };
}

// ─── 2. Balance Strategy ───────────────────────────────────────────────
// 獨立 ranking：以「最近 60 期出現次數與期望值的接近程度」排序。
// 越接近期望（既不偏熱也不偏冷）→ 越高分。
// 完全不引用 baseline，純粹從歷史頻率分布出發。
export function balanceStrategy(
  draws: DrawEntry[],
  config: EnsembleVotingConfig,
  baseline: PerNumberScores,
  windowSize = 60,
): EnsembleStrategyVote {
  const window = draws.slice(0, Math.min(windowSize, draws.length));
  const totalSlots = window.length * 5;
  const expected = totalSlots / 39;
  const counts: Record<number, number> = {};
  for (const n of ALL_NUMBERS) counts[n] = 0;
  for (const d of window) for (const n of d.numbers) counts[n] = (counts[n] ?? 0) + 1;

  // 接近期望 → 高分（用負距離；deterministic）
  // 同時略偏好稍微低於期望的號（mid-cold 補位），透過 alpha 控制
  const scores: PerNumberScores = emptyScores();
  for (const n of ALL_NUMBERS) {
    const c = counts[n] ?? 0;
    const diff = Math.abs(c - expected);
    // 線性負距離（最大期望可能 ~7.7，diff 範圍小）；再對 c<expected 加微量偏好
    const score = -diff + (c < expected ? 0.05 * (expected - c) : 0);
    scores[n] = score;
  }

  const ranking = rankByScores(scores, baseline);
  const topK = ranking.slice(0, config.topK);
  const votes = buildVotes(scores, ranking, config.topK);
  const confidence = strategyConfidence(scores, ranking, config.topK);

  return {
    name: 'balance',
    ranking,
    topK,
    votes,
    confidence,
    rawScores: scores,
    diagnostic: {
      window: window.length,
      expected_per_number: round(expected),
      topK_size: topK.length,
      confidence: round(confidence),
    },
  };
}

// ─── 3. Anti-Concentration Strategy ────────────────────────────────────
// 獨立 ranking：以「最近 N 期 prediction 推薦頻率」反向排序。
// 完全沒被推薦過 → 最高分；越常被推薦 → 越低分。
// 這個 strategy 完全不看 baseline，純粹反集中。
export function antiConcentrationStrategy(
  recent: RecentRecommendation[],
  config: EnsembleVotingConfig,
  baseline: PerNumberScores,
): EnsembleStrategyVote {
  const window = recent.slice(0, config.dominanceWindow);
  const hits: Record<number, number> = {};
  for (const n of ALL_NUMBERS) hits[n] = 0;
  for (const r of window) {
    for (const n of new Set(r.five_star)) hits[n] = (hits[n] ?? 0) + 1;
  }

  // score = -hits（越少被推薦越高）；tie-break 由 rankByScores 處理（號碼小者前）
  const scores: PerNumberScores = emptyScores();
  for (const n of ALL_NUMBERS) scores[n] = -(hits[n] ?? 0);

  const ranking = rankByScores(scores, baseline);
  const topK = ranking.slice(0, config.topK);
  const votes = buildVotes(scores, ranking, config.topK);
  const confidence = strategyConfidence(scores, ranking, config.topK);

  return {
    name: 'anti_concentration',
    ranking,
    topK,
    votes,
    confidence,
    rawScores: scores,
    diagnostic: {
      window: window.length,
      max_hits: Math.max(0, ...Object.values(hits)),
      topK_size: topK.length,
      confidence: round(confidence),
    },
  };
}

// ─── 4. Reversion Strategy ─────────────────────────────────────────────
// 獨立 ranking：以「均值回歸 z-score」排序。
// 計算近 100 期出現次數的 z-score，越偏低（負 z 越大）→ 越應該回補 → 越高分。
// 完全不依賴 baseline；以歷史長期分布為基準。
export function reversionStrategy(
  draws: DrawEntry[],
  config: EnsembleVotingConfig,
  baseline: PerNumberScores,
  longWindow = 100,
): EnsembleStrategyVote {
  const window = draws.slice(0, Math.min(longWindow, draws.length));
  const counts: Record<number, number> = {};
  for (const n of ALL_NUMBERS) counts[n] = 0;
  for (const d of window) for (const n of d.numbers) counts[n] = (counts[n] ?? 0) + 1;

  const values = ALL_NUMBERS.map(n => counts[n] ?? 0);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / values.length;
  const stdev = Math.sqrt(variance) || 1;

  const scores: PerNumberScores = emptyScores();
  for (const n of ALL_NUMBERS) {
    const z = ((counts[n] ?? 0) - mean) / stdev;
    // 越偏冷（z 越負）→ 越該回補 → score 越大
    scores[n] = -z;
  }

  const ranking = rankByScores(scores, baseline);
  const topK = ranking.slice(0, config.topK);
  const votes = buildVotes(scores, ranking, config.topK);
  const confidence = strategyConfidence(scores, ranking, config.topK);

  return {
    name: 'reversion',
    ranking,
    topK,
    votes,
    confidence,
    rawScores: scores,
    diagnostic: {
      window: window.length,
      mean: round(mean),
      stdev: round(stdev),
      topK_size: topK.length,
      confidence: round(confidence),
    },
  };
}

// ─── 5. Coverage Strategy ──────────────────────────────────────────────
// 獨立 ranking：以「對最近 N 期 prediction 五星 pool 的距離」排序。
// 對 pool 越陌生 → 越能擴大 01-39 覆蓋 → 越高分。
// pool 命中過的號碼分數會低，但不是 0；用線性距離 + 小擾動（取 number 倒位次）
// 讓 ranking 完整 deterministic 且不出現大量同分。
export function coverageStrategy(
  recent: RecentRecommendation[],
  config: EnsembleVotingConfig,
  baseline: PerNumberScores,
): EnsembleStrategyVote {
  const window = recent.slice(0, config.dominanceWindow);
  const poolHits: Record<number, number> = {};
  for (const n of ALL_NUMBERS) poolHits[n] = 0;
  for (const r of window) {
    for (const n of new Set(r.five_star)) poolHits[n] = (poolHits[n] ?? 0) + 1;
  }

  const scores: PerNumberScores = emptyScores();
  for (const n of ALL_NUMBERS) {
    // 主要訊號：未被 pool 覆蓋 → 高分（每次出現衰減一個固定量）
    scores[n] = -(poolHits[n] ?? 0);
  }

  const ranking = rankByScores(scores, baseline);
  const topK = ranking.slice(0, config.topK);
  const votes = buildVotes(scores, ranking, config.topK);
  const confidence = strategyConfidence(scores, ranking, config.topK);

  const distinctCovered = ALL_NUMBERS.filter(n => (poolHits[n] ?? 0) === 0).length;

  return {
    name: 'coverage',
    ranking,
    topK,
    votes,
    confidence,
    rawScores: scores,
    diagnostic: {
      window: window.length,
      pool_uncovered_count: distinctCovered,
      coverage_target: config.coverageTarget,
      topK_size: topK.length,
      confidence: round(confidence),
    },
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
