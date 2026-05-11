import type { AdapterObservation } from '../db/adapters';
import { sortNumbers } from '../utils/numbers';

export interface StrategyPerformanceRecord {
  target_draw_no: string | null;
  target_date: string | null;
  single: number | null;
  two_star: number[];
  three_star: number[];
  four_star: number[];
  five_star: number[];
  actual_numbers: number[];
  hit_count: number;
  single_hit: boolean;
  two_star_hit: boolean;
  three_star_hit: boolean;
  four_star_hit: boolean;
  five_star_hit: boolean;
  three_star_hits: number;
  five_star_hits: number;
  advice: string | null;
  confidence: string | null;
}

export interface StrategyPerformance {
  window: number;
  sample_size: number;
  pending_count: number;
  hitRateSingle: number | null;
  hitRateTwo: number | null;
  hitRateThree: number | null;
  hitRateFour: number | null;
  hitRateFive: number | null;
  single_hit_count: number;
  two_star_hit_count: number;
  three_star_hit_count: number;
  four_star_hit_count: number;
  five_star_hit_count: number;
  avgHits: number | null;
  maxLoseStreak: number | null;
  byAdvice: Record<'STRONG' | 'SMALL' | 'WATCH' | 'AVOID', {
    sample_size: number;
    hitRateSingle: number | null;
    hitRateTwo: number | null;
    hitRateThree: number | null;
    hitRateFour: number | null;
    hitRateFive: number | null;
    avgHits: number | null;
  }>;
  periods: {
    week: StrategyPerformancePeriod;
    previous_week: StrategyPerformancePeriod;
    month: StrategyPerformancePeriod;
    previous_month: StrategyPerformancePeriod;
  };
  recent_records: StrategyPerformanceRecord[];
}

const ADVICE_KEYS = ['STRONG', 'SMALL', 'WATCH', 'AVOID'] as const;
type AdviceKey = typeof ADVICE_KEYS[number];

export interface StrategyPerformancePeriod {
  key: 'week' | 'previous_week' | 'month' | 'previous_month';
  label: '本週' | '上週' | '本月' | '上月';
  start_date: string;
  end_date: string;
  sample_size: number;
  status: '資料不足' | '樣本偏少，僅供參考' | 'OK';
  avgHits: number | null;
  maxHits: number | null;
  maxLoseStreak: number | null;
  single_hit_count: number;
  two_star_hit_count: number;
  three_star_hit_count: number;
  four_star_hit_count: number;
  five_star_hit_count: number;
  hitRateSingle: number | null;
  hitRateTwo: number | null;
  hitRateThree: number | null;
  hitRateFour: number | null;
  hitRateFive: number | null;
  byAdvice: Record<AdviceKey, {
    sample_size: number;
    hitRateSingle: number | null;
    hitRateTwo: number | null;
    hitRateThree: number | null;
    hitRateFour: number | null;
    hitRateFive: number | null;
    avgHits: number | null;
    maxHits: number | null;
  }>;
  recent_records: StrategyPerformanceRecord[];
}

export function computeStrategyPerformance(observations: AdapterObservation[], window: number): StrategyPerformance {
  const limited = observations.slice(0, window);
  const evaluated = limited.filter(row => Array.isArray(row.actual_numbers) && row.actual_numbers.length === 5 && row.three_star_hits !== null && row.three_star_hits !== undefined);
  const byAdvice = Object.fromEntries(ADVICE_KEYS.map(key => [key, computeAdviceMetrics(evaluated.filter(row => adviceKey(row) === key))])) as StrategyPerformance['byAdvice'];
  const periodSource = observations.slice(0, Math.max(window, 60)).filter(isEvaluatedObservation);
  return {
    window,
    sample_size: evaluated.length,
    pending_count: limited.length - evaluated.length,
    hitRateSingle: hitRate(evaluated, singleHit),
    hitRateTwo: hitRate(evaluated, twoStarHit),
    hitRateThree: hitRate(evaluated, threeStarHit),
    hitRateFour: hitRate(evaluated, fourStarHit),
    hitRateFive: hitRate(evaluated, fiveStarHit),
    single_hit_count: evaluated.filter(singleHit).length,
    two_star_hit_count: evaluated.filter(twoStarHit).length,
    three_star_hit_count: evaluated.filter(threeStarHit).length,
    four_star_hit_count: evaluated.filter(fourStarHit).length,
    five_star_hit_count: evaluated.filter(fiveStarHit).length,
    avgHits: evaluated.length ? round(evaluated.reduce((sum, row) => sum + Number(row.five_star_hits ?? row.three_star_hits ?? 0), 0) / evaluated.length) : null,
    maxLoseStreak: evaluated.length ? maxLoseStreak(evaluated) : null,
    byAdvice,
    periods: buildPeriodMetrics(periodSource),
    recent_records: evaluated.slice(0, Math.min(window, 10)).map(toPerformanceRecord),
  };
}

function buildPeriodMetrics(rows: AdapterObservation[]): StrategyPerformance['periods'] {
  const today = taipeiTodayIso();
  const weekStart = startOfWeekIso(today);
  const weekEnd = addDaysIso(weekStart, 6);
  const previousWeekStart = addDaysIso(weekStart, -7);
  const previousWeekEnd = addDaysIso(weekStart, -1);
  const monthStart = today.slice(0, 7) + '-01';
  const nextMonthStart = addMonthsIso(monthStart, 1);
  const previousMonthStart = addMonthsIso(monthStart, -1);
  const previousMonthEnd = addDaysIso(monthStart, -1);
  return {
    week: computePeriod('week', '本週', rows, weekStart, weekEnd),
    previous_week: computePeriod('previous_week', '上週', rows, previousWeekStart, previousWeekEnd),
    month: computePeriod('month', '本月', rows, monthStart, addDaysIso(nextMonthStart, -1)),
    previous_month: computePeriod('previous_month', '上月', rows, previousMonthStart, previousMonthEnd),
  };
}

function computePeriod(
  key: StrategyPerformancePeriod['key'],
  label: StrategyPerformancePeriod['label'],
  rows: AdapterObservation[],
  startDate: string,
  endDate: string,
): StrategyPerformancePeriod {
  const scoped = rows
    .filter(row => {
      const date = normalizeIsoDate(row.target_date);
      return date !== null && date >= startDate && date <= endDate;
    })
    .sort((a, b) => String(b.target_date ?? '').localeCompare(String(a.target_date ?? '')));
  const hitValues = scoped.map(row => Number(row.five_star_hits ?? row.three_star_hits ?? 0));
  const byAdvice = Object.fromEntries(ADVICE_KEYS.map(advice => {
    const group = scoped.filter(row => adviceKey(row) === advice);
    const groupHits = group.map(row => Number(row.five_star_hits ?? row.three_star_hits ?? 0));
    return [advice, {
      sample_size: group.length,
      hitRateSingle: hitRate(group, singleHit),
      hitRateTwo: hitRate(group, twoStarHit),
      hitRateThree: hitRate(group, threeStarHit),
      hitRateFour: hitRate(group, fourStarHit),
      hitRateFive: hitRate(group, fiveStarHit),
      avgHits: group.length ? round(groupHits.reduce((sum, n) => sum + n, 0) / group.length) : null,
      maxHits: group.length ? Math.max(...groupHits) : null,
    }];
  })) as StrategyPerformancePeriod['byAdvice'];
  return {
    key,
    label,
    start_date: startDate,
    end_date: endDate,
    sample_size: scoped.length,
    status: scoped.length === 0 ? '資料不足' : scoped.length < 5 ? '樣本偏少，僅供參考' : 'OK',
    avgHits: scoped.length ? round(hitValues.reduce((sum, n) => sum + n, 0) / scoped.length) : null,
    maxHits: scoped.length ? Math.max(...hitValues) : null,
    maxLoseStreak: scoped.length ? maxLoseStreak(scoped) : null,
    hitRateSingle: hitRate(scoped, singleHit),
    hitRateTwo: hitRate(scoped, twoStarHit),
    hitRateThree: hitRate(scoped, threeStarHit),
    hitRateFour: hitRate(scoped, fourStarHit),
    hitRateFive: hitRate(scoped, fiveStarHit),
    single_hit_count: scoped.filter(singleHit).length,
    two_star_hit_count: scoped.filter(twoStarHit).length,
    three_star_hit_count: scoped.filter(threeStarHit).length,
    four_star_hit_count: scoped.filter(fourStarHit).length,
    five_star_hit_count: scoped.filter(fiveStarHit).length,
    byAdvice,
    recent_records: scoped.slice(0, 10).map(toPerformanceRecord),
  };
}

function toPerformanceRecord(row: AdapterObservation): StrategyPerformanceRecord {
  return {
    target_draw_no: row.target_draw_no ?? null,
    target_date: row.target_date ?? null,
    single: row.selected_single === null || row.selected_single === undefined ? null : Number(row.selected_single),
    two_star: sortNumbers(row.selected_two_star ?? []),
    three_star: sortNumbers(row.selected_three_star ?? row.three_star ?? []),
    four_star: sortNumbers(row.selected_four_star ?? []),
    five_star: sortNumbers(row.selected_five_star ?? []),
    actual_numbers: sortNumbers(row.actual_numbers ?? []),
    hit_count: Number(row.five_star_hits ?? row.three_star_hits ?? 0),
    single_hit: singleHit(row),
    two_star_hit: twoStarHit(row),
    three_star_hit: threeStarHit(row),
    four_star_hit: fourStarHit(row),
    five_star_hit: fiveStarHit(row),
    three_star_hits: Number(row.three_star_hits ?? 0),
    five_star_hits: Number(row.five_star_hits ?? row.three_star_hits ?? 0),
    advice: row.advice_label ?? row.advice ?? null,
    confidence: row.confidence ?? null,
  };
}

function computeAdviceMetrics(rows: AdapterObservation[]) {
  return {
    sample_size: rows.length,
    hitRateSingle: hitRate(rows, singleHit),
    hitRateTwo: hitRate(rows, twoStarHit),
    hitRateThree: hitRate(rows, threeStarHit),
    hitRateFour: hitRate(rows, fourStarHit),
    hitRateFive: hitRate(rows, fiveStarHit),
    avgHits: rows.length ? round(rows.reduce((sum, row) => sum + Number(row.five_star_hits ?? row.three_star_hits ?? 0), 0) / rows.length) : null,
  };
}

function isEvaluatedObservation(row: AdapterObservation): boolean {
  return Array.isArray(row.actual_numbers) &&
    row.actual_numbers.length === 5 &&
    row.three_star_hits !== null &&
    row.three_star_hits !== undefined;
}

function hitRate(rows: AdapterObservation[], predicate: (row: AdapterObservation) => boolean): number | null {
  return rows.length ? round(rows.filter(predicate).length / rows.length) : null;
}

function singleHit(row: AdapterObservation): boolean {
  if (row.single_hit !== null && row.single_hit !== undefined) return Boolean(Number(row.single_hit));
  const single = row.selected_single;
  const actual = actualNumberSet(row);
  return typeof single === 'number' && actual.has(single);
}

function twoStarHit(row: AdapterObservation): boolean {
  if (row.two_star_hit !== null && row.two_star_hit !== undefined) return Boolean(Number(row.two_star_hit));
  const actual = actualNumberSet(row);
  const pick = normalizedNumbers(row.selected_two_star);
  return pick.length === 2 && pick.every(n => actual.has(n));
}

function threeStarHit(row: AdapterObservation): boolean {
  const pick = normalizedNumbers(row.selected_three_star ?? row.three_star);
  if (pick.length === 3) {
    const actual = actualNumberSet(row);
    return pick.every(n => actual.has(n));
  }
  return Number(row.three_star_hits ?? 0) >= 3;
}

function fourStarHit(row: AdapterObservation): boolean {
  const pick = normalizedNumbers(row.selected_four_star);
  if (pick.length === 4) {
    const actual = actualNumberSet(row);
    return pick.every(n => actual.has(n));
  }
  return Number(row.four_star_hits ?? 0) >= 4;
}

function fiveStarHit(row: AdapterObservation): boolean {
  const pick = normalizedNumbers(row.selected_five_star);
  if (pick.length === 5) {
    const actual = actualNumberSet(row);
    return pick.every(n => actual.has(n));
  }
  return Number(row.five_star_hits ?? 0) >= 5;
}

function actualNumberSet(row: AdapterObservation): Set<number> {
  return new Set(normalizedNumbers(row.actual_numbers ?? []));
}

function normalizedNumbers(value: unknown): number[] {
  return Array.isArray(value)
    ? sortNumbers(value.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 39))
    : [];
}

function adviceKey(row: AdapterObservation): 'STRONG' | 'SMALL' | 'WATCH' | 'AVOID' {
  const raw = String(row.advice_level ?? row['level'] ?? '').toUpperCase();
  if (ADVICE_KEYS.includes(raw as typeof ADVICE_KEYS[number])) return raw as 'STRONG' | 'SMALL' | 'WATCH' | 'AVOID';
  const label = String(row.advice_label ?? row.advice ?? '');
  if (label === '強攻') return 'STRONG';
  if (label === '小攻') return 'SMALL';
  if (label === '不建議') return 'AVOID';
  return 'WATCH';
}

function maxLoseStreak(rows: AdapterObservation[]): number {
  let current = 0;
  let max = 0;
  for (const row of rows) {
    if (threeStarHit(row)) {
      current = 0;
    } else {
      current++;
      max = Math.max(max, current);
    }
  }
  return max;
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function taipeiTodayIso(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function startOfWeekIso(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const diff = (date.getUTCDay() + 6) % 7;
  return addDaysIso(iso, -diff);
}

function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function addMonthsIso(iso: string, months: number): string {
  const [year, month] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return date.toISOString().slice(0, 10);
}

function normalizeIsoDate(value: unknown): string | null {
  const raw = String(value ?? '').trim().replace(/\//g, '-');
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}
