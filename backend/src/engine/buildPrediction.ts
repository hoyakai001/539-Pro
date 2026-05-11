/**
 * buildPrediction — 整合所有特徵分數，產生本日抓牌建議
 *
 * 流程：
 *   1. 取得所有歷史 DrawEntry
 *   2. 基礎評分（hot/gap/tail/repeat）
 *   3. 初步排序取 Top 10 為種子
 *   4. 計算 cooccur 分
 *   5. 加入平衡修正
 *   6. 加入回測調整
 *   7. 最終排序，取 Top 5
 *   8. 決定 recommendation / confidence_label
 */

import {
  DrawEntry,
  calcCoOccurrence,
  buildFeatureSummary,
} from './features';
import {
  scoreNumbers,
  applyCoOccurrence,
  applyBalanceCorrection,
  NumberScore,
} from './scoreNumbers';
import { StrategyWeightRow } from '../db/database';

export interface PredictionResult {
  target_date: string;
  latest_used_draw_no: string;
  latest_used_draw_date: string;
  single_number: number;
  three_star: number[];
  four_star: number[];
  five_star: number[];
  number_scores: Record<number, number>;
  strategy_scores: Record<string, number>;
  confidence_label: string;
  recommendation: string;
  data_status: 'VALID';
  reasons: Record<number, string>;
  featureSummary: ReturnType<typeof buildFeatureSummary>;
}

export function buildPrediction(
  draws: DrawEntry[],
  targetDate: string,
  strategyWeights?: StrategyWeightRow[],
  recentBacktestScore?: number,
): PredictionResult {
  if (draws.length < 10) {
    throw new Error(`資料不足：需至少 10 期，目前 ${draws.length} 期`);
  }

  // ── Step 1: 基礎評分 ─────────────────────────────────────────────────────
  const { scores, featureRaw } = scoreNumbers(draws, strategyWeights);

  // ── Step 2: 取 Top 10 作為共現種子 ───────────────────────────────────────
  const sorted1 = [...scores].sort((a, b) => b.totalScore - a.totalScore);
  const seedNums = sorted1.slice(0, 10).map(s => s.number);

  // ── Step 3: 計算共現分 ────────────────────────────────────────────────────
  const coMatrix = calcCoOccurrence(draws, Math.min(200, draws.length));
  const coMult = getWeightMult(strategyWeights, 'cooccurrence');
  applyCoOccurrence(scores, coMatrix, seedNums, Math.min(200, draws.length), coMult);

  // ── Step 4: 重新排序，選初步 Top 5 ────────────────────────────────────────
  const sorted2 = [...scores].sort((a, b) => b.totalScore - a.totalScore);
  const top5Initial = sorted2.slice(0, 5).map(s => s.number);

  // ── Step 5: 平衡修正 ──────────────────────────────────────────────────────
  const balMult = getWeightMult(strategyWeights, 'balance');
  applyBalanceCorrection(scores, top5Initial, balMult);

  // ── Step 6: 最終排序 ──────────────────────────────────────────────────────
  const finalSorted = [...scores].sort((a, b) => b.totalScore - a.totalScore);

  // ── Step 7: 取 Top 5，確保平衡（區間不全在同一區）──────────────────────────
  const top5 = pickBalanced(finalSorted, 5);
  const top4 = top5.slice(0, 4);
  const top3 = top5.slice(0, 3);

  // ── Step 8: 建立輸出結構 ──────────────────────────────────────────────────
  const number_scores: Record<number, number> = {};
  const strategy_scores: Record<string, number> = {};

  for (const s of finalSorted.slice(0, 10)) {
    number_scores[s.number] = Math.round(s.totalScore * 10) / 10;
    for (const [k, v] of Object.entries(s.breakdown)) {
      strategy_scores[k] = (strategy_scores[k] ?? 0) + v;
    }
  }

  // ── Step 9: 推薦建議與信心標籤 ────────────────────────────────────────────
  const { recommendation, confidence_label } = buildRecommendation(
    finalSorted,
    recentBacktestScore,
  );

  // ── Step 10: 建立分析原因 ─────────────────────────────────────────────────
  const reasons = buildReasons(top5, finalSorted, featureRaw, draws);

  const featureSummary = buildFeatureSummary(draws);

  return {
    target_date: targetDate,
    latest_used_draw_no: draws[0].draw_no,
    latest_used_draw_date: draws[0].draw_date,
    single_number: top5[0],
    three_star: top3,
    four_star: top4,
    five_star: top5,
    number_scores,
    strategy_scores,
    confidence_label,
    recommendation,
    data_status: 'VALID',
    reasons,
    featureSummary,
  };
}

// ─── 平衡選號（避免5個全在同一區）────────────────────────────────────────────

function pickBalanced(sorted: NumberScore[], count: number): number[] {
  const selected: number[] = [];
  const remaining = [...sorted];

  // 先貪心選分最高的，但避免全在同一區間
  for (const s of remaining) {
    if (selected.length >= count) break;
    selected.push(s.number);
  }

  // 檢查區間分布
  const zones = selected.map(n => Math.ceil(n / 10));
  const zoneCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const z of zones) zoneCounts[z]++;

  // 若有 4 個在同一區，嘗試換一個低分的
  const dominantZone = Object.entries(zoneCounts).find(([, c]) => c >= 4);
  if (dominantZone) {
    const zoneNum = parseInt(dominantZone[0]);
    // 找出最低分的同區號碼
    const worstInZone = [...selected]
      .filter(n => Math.ceil(n / 10) === zoneNum)
      .sort((a, b) => {
        const sa = sorted.find(s => s.number === a)?.totalScore ?? 0;
        const sb = sorted.find(s => s.number === b)?.totalScore ?? 0;
        return sa - sb;
      })[0];

    // 找一個不在該區的替補
    const replacement = remaining.find(
      s => !selected.includes(s.number) && Math.ceil(s.number / 10) !== zoneNum
    );
    if (worstInZone && replacement) {
      const idx = selected.indexOf(worstInZone);
      selected[idx] = replacement.number;
    }
  }

  return selected.sort((a, b) => {
    const sa = sorted.find(s => s.number === a)?.totalScore ?? 0;
    const sb = sorted.find(s => s.number === b)?.totalScore ?? 0;
    return sb - sa;
  });
}

// ─── 推薦建議 ──────────────────────────────────────────────────────────────

function buildRecommendation(
  sorted: NumberScore[],
  recentBacktestScore?: number,
): { recommendation: string; confidence_label: string } {
  const top5Scores = sorted.slice(0, 5).map(s => s.totalScore);
  const avgScore = top5Scores.reduce((a, b) => a + b, 0) / 5;
  const spread = top5Scores[0] - top5Scores[4];

  // 信心標籤
  let confidence_label: string;
  if (avgScore >= 70) confidence_label = '高';
  else if (avgScore >= 55) confidence_label = '中';
  else if (avgScore >= 40) confidence_label = '偏低';
  else confidence_label = '低';

  // 推薦建議
  let recommendation: string;

  if (recentBacktestScore === undefined) {
    recommendation = '觀察'; // 尚無回測資料
  } else if (recentBacktestScore >= 0.35 && avgScore >= 65 && spread < 20) {
    recommendation = '強攻';
  } else if (recentBacktestScore >= 0.28 && avgScore >= 55) {
    recommendation = '小攻';
  } else if (recentBacktestScore >= 0.20 && avgScore >= 45) {
    recommendation = '觀察';
  } else if (recentBacktestScore < 0.15) {
    recommendation = '縮手';
  } else {
    recommendation = '觀察';
  }

  return { recommendation, confidence_label };
}

// ─── 分析原因生成 ──────────────────────────────────────────────────────────

function buildReasons(
  top5: number[],
  sorted: NumberScore[],
  featureRaw: ReturnType<typeof scoreNumbers>['featureRaw'],
  draws: DrawEntry[],
): Record<number, string> {
  const reasons: Record<number, string> = {};

  for (const n of top5) {
    const parts: string[] = [];
    const s = sorted.find(x => x.number === n);
    if (!s) continue;

    const bd = s.breakdown;

    if ((bd['hot_30'] ?? 0) > 8) parts.push('近30期熱度高');
    else if ((bd['hot_100'] ?? 0) > 8) parts.push('近100期熱度穩定');

    if ((bd['hot_10'] ?? 0) > 6) parts.push('近10期超短線熱');

    if ((bd['gap'] ?? 0) > 12) parts.push('GAP遺漏大');
    else if ((bd['gap'] ?? 0) > 8) parts.push('GAP補牌訊號');

    const tail = n % 10;
    if ((bd['tail'] ?? 0) > 6) parts.push(`${tail}尾強`);

    if ((bd['cooccurrence'] ?? 0) > 4) parts.push('共現加分');
    if ((bd['repeat'] ?? 0) > 3) parts.push('上期留牌');
    if ((bd['balance'] ?? 0) > 2) parts.push('區間平衡補位');

    reasons[n] = parts.length > 0 ? parts.join('、') : '綜合分數穩定';
  }

  return reasons;
}

// ─── 工具 ──────────────────────────────────────────────────────────────────

function getWeightMult(rows: StrategyWeightRow[] | undefined, name: string): number {
  if (!rows) return 1.0;
  return rows.find(r => r.strategy_name === name)?.weight ?? 1.0;
}
