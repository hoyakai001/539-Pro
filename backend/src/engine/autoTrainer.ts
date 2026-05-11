/**
 * autoTrainer — 開獎後自動評估預測 + 更新策略權重
 *
 * 流程：
 *   1. 取出所有尚未評估的 VALID 預測（無 prediction_audit_logs 記錄）
 *   2. 對每筆預測，查找對應的真實開獎資料
 *   3. 計算命中率，寫入 prediction_audit_logs
 *   4. 觸發 walkForwardBacktest + updateStrategyWeights
 *
 * 呼叫時機：每日開獎後（cron 21:30 台灣時間，或手動 POST /api/train）
 * 安全保護：只在有真實新開獎資料時才執行
 */

import { DrawEntry } from './features';
import {
  getDraws, getLatestDraw, getUnevaluatedPredictions,
  savePredictionAudit, saveBacktest,
} from '../db/database';
import { runBacktest } from '../backtest/walkForwardBacktest';
import { updateWeightsFromBacktest } from '../backtest/updateStrategyWeights';

export interface TrainResult {
  evaluated: number;
  skipped: number;
  backtestRan: boolean;
  message: string;
}

export async function runAutoTrainer(): Promise<TrainResult> {
  const result: TrainResult = {
    evaluated: 0,
    skipped: 0,
    backtestRan: false,
    message: '',
  };

  const latest = getLatestDraw();
  if (!latest) {
    result.message = '無開獎資料，跳過訓練';
    return result;
  }

  // 取出待評估的預測
  const pending = getUnevaluatedPredictions();
  if (pending.length === 0) {
    result.message = '無待評估預測';
  }

  const allDraws = getDraws();
  const drawMap = new Map(allDraws.map(d => [d.draw_date, d]));

  for (const pred of pending) {
    if (!pred.target_date) { result.skipped++; continue; }

    const actualDraw = drawMap.get(pred.target_date);
    if (!actualDraw) {
      result.skipped++;
      continue;
    }

    const actualNums: number[] = JSON.parse(actualDraw.numbers_json);
    const singleNum = pred.single_number;
    const threeStar: number[] = pred.three_star_json ? JSON.parse(pred.three_star_json) : [];
    const fourStar: number[]  = pred.four_star_json  ? JSON.parse(pred.four_star_json)  : [];
    const fiveStar: number[]  = pred.five_star_json  ? JSON.parse(pred.five_star_json)  : [];

    const singleHit = singleNum !== null && actualNums.includes(singleNum);
    const threeHits = threeStar.filter(n => actualNums.includes(n)).length;
    const fourHits  = fourStar.filter(n => actualNums.includes(n)).length;
    const fiveHits  = fiveStar.filter(n => actualNums.includes(n)).length;

    savePredictionAudit({
      prediction_id:  pred.id,
      actual_draw_no: actualDraw.draw_no,
      actual_numbers: actualNums,
      single_hit:     singleHit,
      three_star_hits: threeHits,
      four_star_hits:  fourHits,
      five_star_hits:  fiveHits,
    });

    result.evaluated++;
    console.log(
      `[autoTrainer] 評估 pred#${pred.id} (${pred.target_date}): ` +
      `single=${singleHit ? 'HIT' : 'miss'}, 3★=${threeHits}/3, 4★=${fourHits}/4, 5★=${fiveHits}/5`
    );
  }

  // 只在有足夠資料時才跑回測
  if (allDraws.length >= 30) {
    const draws: DrawEntry[] = allDraws.map(d => ({
      draw_no: d.draw_no,
      draw_date: d.draw_date,
      numbers: JSON.parse(d.numbers_json),
    }));

    const today = new Date().toISOString().split('T')[0].replace(/-/g, '/');
    const metrics = runBacktest(draws);

    for (const m of metrics) {
      saveBacktest({
        run_date: today,
        window_size: m.windowSize,
        strategy_name: m.strategyName,
        hit_rate_single: m.hitRateSingle,
        hit_rate_three: m.hitRateThree,
        hit_rate_four: m.hitRateFour,
        hit_rate_five: m.hitRateFive,
        avg_hits_three: m.avgHitsThree,
        avg_hits_four: m.avgHitsFour,
        avg_hits_five: m.avgHitsFive,
        max_losing_streak: m.maxLosingStreak,
        score: m.score,
      });
    }

    updateWeightsFromBacktest(metrics);
    result.backtestRan = true;
    console.log('[autoTrainer] 回測與權重更新完成');
  }

  result.message =
    `評估 ${result.evaluated} 筆預測，跳過 ${result.skipped} 筆` +
    (result.backtestRan ? '，回測已更新' : '');

  return result;
}
