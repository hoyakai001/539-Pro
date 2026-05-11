/**
 * 評分主模組 — 100 分制
 *
 * 策略分配（滿分 100）：
 *   hot_100  (近100期熱度)     → 15 分
 *   hot_30   (近30期短線熱度)  → 15 分
 *   hot_10   (近10期超短線)    → 10 分
 *   gap      (GAP遺漏值)       → 20 分
 *   tail     (尾數熱度)        → 10 分
 *   cooccur  (哥倆好共現)      →  8 分
 *   repeat   (上期留牌)        →  7 分
 *   balance  (奇偶/大小/區間)  →  5 分（平衡調整）
 *   backtest_adj (回測策略修正) → 10 分
 *
 * 注意：cooccur 是迭代計算，不能在純 scoreNumbers 裡完成
 * 本模組回傳不含 cooccur 的初始分數，buildPrediction 再疊加 cooccur
 */

import {
  DrawEntry,
  calcHotCold, hotScoreNormalized,
  calcGap, gapScoreNormalized,
  calcTailHot, tailScoreNormalized,
  calcRepeatRate, repeatScoreNormalized,
  balanceScore,
} from './features';
import { StrategyWeightRow } from '../db/database';

// ─── 權重配置（加權後各策略最高可貢獻分數）─────────────────────────────────

const BASE_WEIGHTS = {
  hot_100:      15,
  hot_30:       15,
  hot_10:       10,
  gap:          20,
  tail:         10,
  repeat:        7,
  balance:       5,
  backtest_adj: 10,
  // cooccur 由 buildPrediction 補充
  cooccurrence:  8,
};

export interface NumberScore {
  number: number;
  totalScore: number;
  breakdown: Record<string, number>;
}

export interface ScoreResult {
  scores: NumberScore[];
  featureRaw: {
    hotScore_100: Record<number, number>;
    hotScore_30: Record<number, number>;
    hotScore_10: Record<number, number>;
    gapScore: Record<number, number>;
    tailScore: Record<number, number>;
    repeatScore: Record<number, number>;
  };
}

export function scoreNumbers(
  draws: DrawEntry[],
  strategyWeights?: StrategyWeightRow[],
): ScoreResult {
  if (draws.length < 5) {
    throw new Error(`資料不足：至少需要 5 期，目前只有 ${draws.length} 期`);
  }

  // ── 動態策略權重乘數（回測後調整，預設 1.0）─────────────────────────────
  const weightMult = buildWeightMultipliers(strategyWeights);

  // ── 計算各特徵原始分 ───────────────────────────────────────────────────

  // 熱度
  const w100 = Math.min(100, draws.length);
  const w30  = Math.min(30, draws.length);
  const w10  = Math.min(10, draws.length);

  const hot100 = calcHotCold(draws, w100);
  const hot30  = calcHotCold(draws, w30);
  const hot10  = calcHotCold(draws, w10);

  const hotScore_100 = hotScoreNormalized(hot100.counts);
  const hotScore_30  = hotScoreNormalized(hot30.counts);
  const hotScore_10  = hotScoreNormalized(hot10.counts);

  // GAP
  const gapMap = calcGap(draws);
  const gapScore = gapScoreNormalized(gapMap);

  // 尾數（近5/10/30期）
  const tc5  = calcTailHot(draws, Math.min(5, draws.length));
  const tc10 = calcTailHot(draws, w10);
  const tc30 = calcTailHot(draws, w30);
  const tailScore = tailScoreNormalized(tc5, tc10, tc30);

  // 上期留牌
  const { repeatRate, lastDrawNumbers } = calcRepeatRate(draws, Math.min(20, draws.length));
  const repeatScore = repeatScoreNormalized(lastDrawNumbers, repeatRate);

  // ── 合成分數（不含 cooccur，不含 balance — 後者需先選出候選集才計算）────

  const scores: NumberScore[] = [];

  for (let n = 1; n <= 39; n++) {
    const breakdown: Record<string, number> = {
      hot_100:      (hotScore_100[n] ?? 0) * BASE_WEIGHTS.hot_100 * weightMult('hot_100'),
      hot_30:       (hotScore_30[n]  ?? 0) * BASE_WEIGHTS.hot_30  * weightMult('hot_30'),
      hot_10:       (hotScore_10[n]  ?? 0) * BASE_WEIGHTS.hot_10  * weightMult('hot_10'),
      gap:          (gapScore[n]     ?? 0) * BASE_WEIGHTS.gap      * weightMult('gap'),
      tail:         (tailScore[n]    ?? 0) * BASE_WEIGHTS.tail     * weightMult('tail'),
      repeat:       (repeatScore[n]  ?? 0) * BASE_WEIGHTS.repeat   * weightMult('repeat'),
      cooccurrence: 0,  // 稍後由 buildPrediction 填入
      balance:      0,  // 稍後由 buildPrediction 填入
      backtest_adj: 0,  // 稍後由 buildPrediction 填入
    };

    const totalScore = Object.values(breakdown).reduce((a, b) => a + b, 0);
    scores.push({ number: n, totalScore, breakdown });
  }

  return {
    scores,
    featureRaw: { hotScore_100, hotScore_30, hotScore_10, gapScore, tailScore, repeatScore },
  };
}

// ─── 工具 ──────────────────────────────────────────────────────────────────

function buildWeightMultipliers(rows?: StrategyWeightRow[]): (name: string) => number {
  if (!rows || rows.length === 0) return () => 1.0;
  const map: Record<string, number> = {};
  for (const r of rows) map[r.strategy_name] = r.weight;
  return (name: string) => map[name] ?? 1.0;
}

/** 加入 cooccur 分數（需先選出高分種子號碼） */
export function applyCoOccurrence(
  scores: NumberScore[],
  matrix: Record<number, Record<number, number>>,
  seedNums: number[],
  windowSize: number,
  weightMult: number = 1.0,
): void {
  const maxPossible = seedNums.length * (windowSize / 8);
  for (const s of scores) {
    if (seedNums.includes(s.number)) continue;
    let total = 0;
    for (const seed of seedNums) {
      total += matrix[s.number]?.[seed] ?? 0;
    }
    const coScore = maxPossible > 0 ? Math.min(1, total / maxPossible) : 0;
    const contrib = coScore * BASE_WEIGHTS.cooccurrence * weightMult;
    s.breakdown['cooccurrence'] = contrib;
    s.totalScore += contrib;
  }
}

/** 加入平衡修正分（在最終選出 top5 前做細調） */
export function applyBalanceCorrection(
  scores: NumberScore[],
  selected: number[],
  weightMult: number = 1.0,
): void {
  for (const s of scores) {
    if (selected.includes(s.number)) continue;
    const bScore = balanceScore(selected, s.number);
    const contrib = bScore * BASE_WEIGHTS.balance * weightMult;
    s.breakdown['balance'] = contrib;
    s.totalScore += contrib;
  }
}

/** 加入回測調整分（全局偏移） */
export function applyBacktestAdjustment(
  scores: NumberScore[],
  adjustments: Record<number, number>,
  weightMult: number = 1.0,
): void {
  for (const s of scores) {
    const adj = (adjustments[s.number] ?? 0) * BASE_WEIGHTS.backtest_adj * weightMult;
    s.breakdown['backtest_adj'] = adj;
    s.totalScore += adj;
  }
}
