/**
 * 根據回測結果動態調整策略權重
 *
 * 規則：
 *   - 近30期表現好 → 升權（但每次不超過 +0.15）
 *   - 近30期表現差 → 降權（但每次不超過 -0.15）
 *   - 權重下限 0.3，上限 2.0
 *   - 避免單日暴衝
 */

import { BacktestMetrics } from './walkForwardBacktest';
import { updateStrategyWeight, getStrategyWeights } from '../db/database';

const WEIGHT_MIN = 0.3;
const WEIGHT_MAX = 2.0;
const MAX_DELTA = 0.15;

// 隨機命中 1 碼的基準線（5/39）
const BASELINE_HIT1 = 5 / 39;

export function updateWeightsFromBacktest(metrics: BacktestMetrics[]): void {
  const current = getStrategyWeights();
  const currentMap: Record<string, number> = {};
  for (const r of current) currentMap[r.strategy_name] = r.weight;

  // 用近 30 期視窗的回測結果評估
  const window30 = metrics.find(m => m.windowSize === 30 || m.strategyName.includes('30'));
  if (!window30) {
    console.log('[weights] 無 window=30 回測資料，跳過權重更新');
    return;
  }

  // 計算整體策略表現分數 (-1 ~ +1)
  const performanceScore = calcPerformanceScore(window30);

  // 根據表現調整各策略的權重
  // 這裡的邏輯是：若整體表現好，稍微升高所有策略的權重
  // 未來可以進一步做逐策略的 A/B 分析

  const strategyNames = [
    'hot_100', 'hot_30', 'hot_10', 'gap', 'tail',
    'cooccurrence', 'repeat', 'balance', 'backtest_adj',
  ];

  for (const name of strategyNames) {
    const oldWeight = currentMap[name] ?? 1.0;
    const delta = calcDelta(name, performanceScore);
    const newWeight = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, oldWeight + delta));

    if (Math.abs(newWeight - oldWeight) > 0.005) {
      updateStrategyWeight(name, newWeight, window30.score);
      console.log(`[weights] ${name}: ${oldWeight.toFixed(3)} → ${newWeight.toFixed(3)} (perf=${performanceScore.toFixed(3)})`);
    }
  }
}

function calcPerformanceScore(m: BacktestMetrics): number {
  if (m.totalPredictions === 0) return 0;

  // 超越基準線才算正分
  const excess1 = m.hitRate1plus_five - BASELINE_HIT1;
  const excess2 = m.hitRate2plus_five - (BASELINE_HIT1 * 1.5);
  const excessAvg = m.avgHitsFive - (5 * BASELINE_HIT1);

  return (excess1 * 0.4 + excess2 * 0.4 + excessAvg * 0.2) * 3;
}

function calcDelta(strategyName: string, performanceScore: number): number {
  // 不同策略對整體表現的敏感度不同
  const sensitivity: Record<string, number> = {
    gap:         1.2,
    hot_30:      1.1,
    hot_10:      1.0,
    tail:        0.9,
    cooccurrence: 0.8,
    hot_100:     0.7,
    repeat:      0.6,
    balance:     0.5,
    backtest_adj: 0.5,
  };

  const s = sensitivity[strategyName] ?? 0.7;
  const rawDelta = performanceScore * s * 0.1; // 0.1 為學習率
  return Math.max(-MAX_DELTA, Math.min(MAX_DELTA, rawDelta));
}
