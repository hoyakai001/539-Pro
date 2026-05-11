import type { DrawStatEntry } from '../stats/historicalStats';
import { sortNumbers } from '../utils/numbers';

export interface BalanceDistribution {
  oddEven: Record<string, number>;
  bigSmall: Record<string, number>;
  zones: Record<string, number>;
  tailSpread: Record<string, number>;
  consecutive: Record<string, number>;
  repeatOverlap: Record<string, number>;
}

export interface BalanceEvaluation {
  odd_even_balance_score: number;
  big_small_balance_score: number;
  zone_balance_score: number;
  tail_balance_score: number;
  consecutive_score: number;
  repeat_overlap_score: number;
  total_balance_score: number;
  balance_reason_text: string;
  summary: {
    oddEven: string;
    bigSmall: string;
    zones: string;
    tails: string;
    consecutivePairs: number;
    repeatWithLatest: number;
    commonPattern: boolean;
    odd_even: string;
    big_small: string;
    tail_pattern: string;
    consecutive_pairs: number;
    repeat_with_latest: number;
    hot_stable_cold_mix: string;
    reason_text: string;
  };
}

export function buildBalanceDistribution(draws: DrawStatEntry[]): BalanceDistribution {
  const recent = draws.slice(0, 100);
  const dist: BalanceDistribution = {
    oddEven: initKeys(0, 5),
    bigSmall: initKeys(0, 5),
    zones: {},
    tailSpread: { dispersed: 0, twoSameTail: 0, threePlusSameTail: 0 },
    consecutive: { none: 0, onePair: 0, twoPlusPairs: 0 },
    repeatOverlap: initKeys(0, 5),
  };

  recent.forEach((draw, index) => {
    const nums = sortNumbers(draw.numbers);
    dist.oddEven[String(nums.filter(n => n % 2 === 1).length)]++;
    dist.bigSmall[String(nums.filter(n => n <= 19).length)]++;
    const zKey = zoneKey(nums);
    dist.zones[zKey] = (dist.zones[zKey] ?? 0) + 1;
    dist.tailSpread[tailSpreadKey(nums)]++;
    dist.consecutive[consecutiveKey(nums)]++;
    if (recent[index + 1]) {
      const overlap = nums.filter(n => recent[index + 1].numbers.includes(n)).length;
      dist.repeatOverlap[String(overlap)]++;
    }
  });
  return dist;
}

export function evaluateBalance(candidate: number[], draws: DrawStatEntry[]): BalanceEvaluation {
  const nums = sortNumbers(candidate);
  const latest = draws[0]?.numbers ?? [];
  const dist = buildBalanceDistribution(draws);
  const odd = nums.filter(n => n % 2 === 1).length;
  const small = nums.filter(n => n <= 19).length;
  const zKey = zoneKey(nums);
  const tailKey = tailSpreadKey(nums);
  const conKey = consecutiveKey(nums);
  const repeat = nums.filter(n => latest.includes(n)).length;

  const oddScore = distributionScore(dist.oddEven, String(odd));
  const bigScore = distributionScore(dist.bigSmall, String(small));
  const zoneScore = distributionScore(dist.zones, zKey);
  const tailScore = distributionScore(dist.tailSpread, tailKey);
  const consecutiveScore = distributionScore(dist.consecutive, conKey);
  const repeatScore = distributionScore(dist.repeatOverlap, String(repeat));
  const total = oddScore + bigScore + zoneScore + tailScore + consecutiveScore + repeatScore;
  const commonPattern = [oddScore, bigScore, zoneScore, tailScore, consecutiveScore, repeatScore].filter(s => s >= 0).length >= 4;
  const reason = commonPattern
    ? '本組分布接近近100期常見型態。'
    : '本組有部分分布偏離近100期常見型態。';

  return {
    odd_even_balance_score: round(oddScore),
    big_small_balance_score: round(bigScore),
    zone_balance_score: round(zoneScore),
    tail_balance_score: round(tailScore),
    consecutive_score: round(consecutiveScore),
    repeat_overlap_score: round(repeatScore),
    total_balance_score: round(total),
    balance_reason_text: `近100期平衡: 奇偶=${odd}:${5 - odd}, 大小=${small}:${5 - small}, 區間=${zKey}, 尾數=${tailKey}, 連號=${conKey}, 重複=${repeat}`,
    summary: {
      oddEven: `${odd}:${5 - odd}`,
      bigSmall: `${small}:${5 - small}`,
      zones: zKey,
      tails: tailKey,
      consecutivePairs: consecutiveCount(nums),
      repeatWithLatest: repeat,
      commonPattern,
      odd_even: `${odd}:${5 - odd}`,
      big_small: `${small}:${5 - small}`,
      tail_pattern: tailKey,
      consecutive_pairs: consecutiveCount(nums),
      repeat_with_latest: repeat,
      hot_stable_cold_mix: 'computed_by_prediction_model',
      reason_text: reason,
    },
  };
}

function distributionScore(dist: Record<string, number>, key: string): number {
  const values = Object.values(dist);
  const total = values.reduce((sum, n) => sum + n, 0);
  if (!total) return 0;
  const rate = (dist[key] ?? 0) / total;
  const maxRate = Math.max(...values) / total;
  if (rate === 0) return -6;
  if (rate >= maxRate * 0.75) return 4;
  if (rate >= maxRate * 0.4) return 1.5;
  return -3;
}

function zoneKey(nums: number[]): string {
  const zones = [0, 0, 0];
  for (const n of nums) {
    if (n <= 13) zones[0]++;
    else if (n <= 26) zones[1]++;
    else zones[2]++;
  }
  return zones.join('-');
}

function tailSpreadKey(nums: number[]): 'dispersed' | 'twoSameTail' | 'threePlusSameTail' {
  const counts = new Map<number, number>();
  nums.forEach(n => counts.set(n % 10, (counts.get(n % 10) ?? 0) + 1));
  const max = Math.max(...counts.values());
  if (max >= 3) return 'threePlusSameTail';
  if (max === 2) return 'twoSameTail';
  return 'dispersed';
}

function consecutiveKey(nums: number[]): 'none' | 'onePair' | 'twoPlusPairs' {
  const count = consecutiveCount(nums);
  if (count === 0) return 'none';
  if (count === 1) return 'onePair';
  return 'twoPlusPairs';
}

function consecutiveCount(nums: number[]): number {
  let count = 0;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] - nums[i - 1] === 1) count++;
  }
  return count;
}

function initKeys(min: number, max: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = min; i <= max; i++) out[String(i)] = 0;
  return out;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
