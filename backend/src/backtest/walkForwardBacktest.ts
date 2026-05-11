import { DrawEntry } from '../engine/features';
import { sortNumbers } from '../utils/numbers';
import { computeSingleStats, computeTwoStarStats, rowsToStatEntries } from '../stats/historicalStats';

export interface BacktestRecord {
  target_draw_no: string;
  target_draw_date: string;
  latest_used_draw_no: string;
  latest_used_draw_date: string;
  prediction: {
    two_star: number[];
    three_star: number[];
    four_star: number[];
    five_star: number[];
  };
  actual_numbers: number[];
  hits: {
    two: number;
    three: number;
    four: number;
    five: number;
  };
}

export interface BacktestMetrics {
  windowSize: number;
  strategyName: string;
  hitRateSingle: number;
  hitRateTwo: number;
  hitRateThree: number;
  hitRateFour: number;
  hitRateFive: number;
  avgTwoHits: number;
  avgHitsThree: number;
  avgHitsFour: number;
  avgHitsFive: number;
  avgThreeHits: number;
  avgFourHits: number;
  avgFiveHits: number;
  avgHits: number;
  maxLoseStreakTwo: number;
  maxLoseStreakThree: number;
  maxLoseStreakFour: number;
  maxLoseStreakFive: number;
  maxLoseStreak: number;
  maxLosingStreak: number;
  hitRate1plus_five: number;
  hitRate2plus_five: number;
  totalPredictions: number;
  sample_size: number;
  tested_draws: number;
  audit_status: string;
  records: BacktestRecord[];
  score: number;
}

const WINDOW_SIZES = '30,60,100'.split(',').map(Number);

export function runBacktest(allDraws: DrawEntry[], auditStatus = 'WARN'): BacktestMetrics[] {
  if (auditStatus === 'FAIL') return [];
  if (allDraws.length < 31) return [];

  const windows = WINDOW_SIZES;
  return windows
    .filter(windowSize => allDraws.length > windowSize + 1)
    .map(windowSize => backtestWindow(allDraws, windowSize, windowSize === allDraws.length - 1 ? 'all_history' : `window_${windowSize}`, auditStatus))
    .filter((m): m is BacktestMetrics => !!m);
}

function backtestWindow(allDraws: DrawEntry[], windowSize: number, strategyName: string, auditStatus: string): BacktestMetrics | null {
  const maxPredict = Math.min(100, allDraws.length - windowSize - 1);
  const records: BacktestRecord[] = [];

  for (let i = 0; i < maxPredict; i++) {
    const targetDraw = allDraws[i];
    const trainingDraws = allDraws.slice(i + 1, i + 1 + windowSize);
    if (trainingDraws.length < 30) continue;
    const prediction = predictFromHistory(trainingDraws);
    const actual = sortNumbers(targetDraw.numbers);
    const two = prediction.two_star.every(n => actual.includes(n)) ? 1 : 0;
    const three = prediction.three_star.filter(n => actual.includes(n)).length;
    const four = prediction.four_star.filter(n => actual.includes(n)).length;
    const five = prediction.five_star.filter(n => actual.includes(n)).length;
    records.push({
      target_draw_no: targetDraw.draw_no,
      target_draw_date: targetDraw.draw_date,
      latest_used_draw_no: trainingDraws[0].draw_no,
      latest_used_draw_date: trainingDraws[0].draw_date,
      prediction,
      actual_numbers: actual,
      hits: { two, three, four, five },
    });
  }

  if (!records.length) return null;
  const sample = records.length;
  const hitTwo = records.filter(r => r.hits.two > 0).length;
  const hitThree = records.filter(r => r.hits.three > 0).length;
  const hitFour = records.filter(r => r.hits.four > 0).length;
  const hitFive = records.filter(r => r.hits.five > 0).length;
  const avgTwo = records.reduce((sum, r) => sum + r.hits.two, 0) / sample;
  const avgThree = records.reduce((sum, r) => sum + r.hits.three, 0) / sample;
  const avgFour = records.reduce((sum, r) => sum + r.hits.four, 0) / sample;
  const avgFive = records.reduce((sum, r) => sum + r.hits.five, 0) / sample;

  const metrics: BacktestMetrics = {
    windowSize,
    strategyName,
    hitRateSingle: 0,
    hitRateTwo: hitTwo / sample,
    hitRateThree: hitThree / sample,
    hitRateFour: hitFour / sample,
    hitRateFive: hitFive / sample,
    avgTwoHits: avgTwo,
    avgHitsThree: avgThree,
    avgHitsFour: avgFour,
    avgHitsFive: avgFive,
    avgThreeHits: avgThree,
    avgFourHits: avgFour,
    avgFiveHits: avgFive,
    avgHits: avgFive,
    maxLoseStreakTwo: maxLoseStreak(records, 'two'),
    maxLoseStreakThree: maxLoseStreak(records, 'three'),
    maxLoseStreakFour: maxLoseStreak(records, 'four'),
    maxLoseStreakFive: maxLoseStreak(records, 'five'),
    maxLoseStreak: maxLoseStreak(records, 'five'),
    maxLosingStreak: maxLoseStreak(records, 'five'),
    hitRate1plus_five: hitFive / sample,
    hitRate2plus_five: records.filter(r => r.hits.five >= 2).length / sample,
    totalPredictions: sample,
    sample_size: sample,
    tested_draws: sample,
    audit_status: auditStatus,
    records,
    score: 0,
  };
  metrics.score = metrics.hitRateTwo * 0.35 + metrics.hitRateThree * 0.25 + metrics.hitRateFour * 0.2 + metrics.hitRateFive * 0.2;
  return metrics;
}

function predictFromHistory(draws: DrawEntry[]) {
  const rows = rowsToStatEntries(draws.map((d, index) => ({
    id: index,
    draw_no: d.draw_no,
    draw_date: d.draw_date,
    numbers_json: JSON.stringify(sortNumbers(d.numbers)),
    source: 'verified_db',
    source_url: null,
    verified: 1,
    verified_by_pilio: 0,
    audit_status: 'PASS',
    created_at: '',
    updated_at: '',
  })));
  const single = computeSingleStats(rows)
    .map(s => ({ n: s.number, score: s.count30 * 3 + s.count60 * 1.5 + s.count100 + Math.min(s.currentGap, 20) * 0.25 }))
    .sort((a, b) => b.score - a.score || a.n - b.n)
    .map(s => s.n);
  const two = computeTwoStarStats(rows.slice(0, 100), 1)[0]?.numbers ?? sortNumbers(single.slice(0, 2));
  const selected = sortNumbers(single.slice(0, 5));
  return {
    two_star: sortNumbers(two),
    three_star: sortNumbers(selected.slice(0, 3)),
    four_star: sortNumbers(selected.slice(0, 4)),
    five_star: selected,
  };
}

function maxLoseStreak(records: BacktestRecord[], key: keyof BacktestRecord['hits']): number {
  let current = 0;
  let max = 0;
  for (const record of records) {
    if (record.hits[key] > 0) {
      current = 0;
    } else {
      current++;
      max = Math.max(max, current);
    }
  }
  return max;
}
