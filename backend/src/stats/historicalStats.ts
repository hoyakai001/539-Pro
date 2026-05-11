import type { DrawRow } from '../db/database';
import { combinations, comboKey, sortNumbers } from '../utils/numbers';

export interface DrawStatEntry {
  draw_no: string;
  draw_date: string;
  numbers: number[];
}

export interface SingleNumberStat {
  number: number;
  count10: number;
  count30: number;
  count60: number;
  count100: number;
  rate100: number;
  currentGap: number;
  avgGap: number;
  maxGap: number;
  lastSeenDrawNo: string | null;
  lastSeenDate: string | null;
}

export interface TwoStarStat {
  numbers: number[];
  key: string;
  count30: number;
  count60: number;
  count100: number;
  gap: number | null;
  lastSeenDrawNo: string | null;
  lastSeenDate: string | null;
  drawNos: string[];
  hitRateTwo?: number;
}

export interface TailStat {
  tail: number;
  count10: number;
  count30: number;
  count60: number;
  count100: number;
}

export interface RepeatStats {
  distribution: Record<string, number>;
  latestOverlap: number;
  previousOverlap: number;
}

const WINDOWS = '10,30,60,100'.split(',').map(Number);

export function rowsToStatEntries(rows: DrawRow[]): DrawStatEntry[] {
  return rows.map(row => ({
    draw_no: row.draw_no,
    draw_date: row.draw_date,
    numbers: sortNumbers(JSON.parse(row.numbers_json)),
  }));
}

export function computeSingleStats(draws: DrawStatEntry[]): SingleNumberStat[] {
  const result: SingleNumberStat[] = [];
  for (let n = 1; n <= 39; n++) {
    const positions: number[] = [];
    draws.forEach((draw, index) => {
      if (draw.numbers.includes(n)) positions.push(index);
    });
    const gaps = positions.slice(1).map((pos, idx) => pos - positions[idx]);
    const recent100 = draws.slice(0, 100);
    const count100 = countInWindow(draws, n, 100);
    result.push({
      number: n,
      count10: countInWindow(draws, n, 10),
      count30: countInWindow(draws, n, 30),
      count60: countInWindow(draws, n, 60),
      count100,
      rate100: recent100.length ? count100 / recent100.length : 0,
      currentGap: positions.length ? positions[0] : draws.length,
      avgGap: gaps.length ? avg(gaps) : draws.length,
      maxGap: gaps.length ? Math.max(...gaps) : draws.length,
      lastSeenDrawNo: positions.length ? draws[positions[0]].draw_no : null,
      lastSeenDate: positions.length ? draws[positions[0]].draw_date : null,
    });
  }
  return result;
}

export function computeTwoStarStats(draws: DrawStatEntry[], top?: number): TwoStarStat[] {
  const map = new Map<string, TwoStarStat>();
  for (let a = 1; a <= 38; a++) {
    for (let b = a + 1; b <= 39; b++) {
      const key = comboKey([a, b]);
      map.set(key, {
        numbers: [a, b],
        key,
        count30: 0,
        count60: 0,
        count100: 0,
        gap: null,
        lastSeenDrawNo: null,
        lastSeenDate: null,
        drawNos: [],
      });
    }
  }

  draws.forEach((draw, index) => {
    for (const pair of combinations(draw.numbers, 2)) {
      const stat = map.get(comboKey(pair));
      if (!stat) continue;
      if (index < 30) stat.count30 += 1;
      if (index < 60) stat.count60 += 1;
      if (index < 100) stat.count100 += 1;
      if (stat.gap === null) {
        stat.gap = index;
        stat.lastSeenDrawNo = draw.draw_no;
        stat.lastSeenDate = draw.draw_date;
      }
      stat.drawNos.push(draw.draw_no);
    }
  });

  const sorted = [...map.values()].sort((a, b) =>
    b.count100 - a.count100 ||
    (a.gap ?? 999999) - (b.gap ?? 999999) ||
    a.key.localeCompare(b.key)
  );
  return top ? sorted.slice(0, top) : sorted;
}

export function getTwoStarStat(draws: DrawStatEntry[], numbers: number[]): TwoStarStat | null {
  const key = comboKey(numbers);
  return computeTwoStarStats(draws).find(row => row.key === key) ?? null;
}

export function computeTailStats(draws: DrawStatEntry[]): TailStat[] {
  return Array.from({ length: 10 }, (_, tail) => {
    const count = (window: number) => draws.slice(0, window).reduce((sum, d) => sum + d.numbers.filter(n => n % 10 === tail).length, 0);
    return {
      tail,
      count10: count(10),
      count30: count(30),
      count60: count(60),
      count100: count(100),
    };
  });
}

export function computeThreeStarStats(draws: DrawStatEntry[], top = 50) {
  const map = new Map<string, { numbers: number[]; key: string; count30: number; count60: number; count100: number; lastSeenDrawNo: string | null; lastSeenDate: string | null }>();
  draws.slice(0, 100).forEach((draw, index) => {
    for (const trio of combinations(draw.numbers, 3)) {
      const key = comboKey(trio);
      const current = map.get(key) ?? { numbers: trio, key, count30: 0, count60: 0, count100: 0, lastSeenDrawNo: null, lastSeenDate: null };
      if (index < 30) current.count30 += 1;
      if (index < 60) current.count60 += 1;
      if (index < 100) current.count100 += 1;
      if (!current.lastSeenDrawNo) {
        current.lastSeenDrawNo = draw.draw_no;
        current.lastSeenDate = draw.draw_date;
      }
      map.set(key, current);
    }
  });
  return [...map.values()].sort((a, b) => b.count100 - a.count100 || a.key.localeCompare(b.key)).slice(0, top);
}

export function computeRepeatStats(draws: DrawStatEntry[], prediction?: number[]): RepeatStats {
  const distribution: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  const recent = draws.slice(0, 100);
  for (let i = 0; i < recent.length - 1; i++) {
    const overlaps = recent[i].numbers.filter(n => recent[i + 1].numbers.includes(n)).length;
    distribution[String(overlaps)] = (distribution[String(overlaps)] ?? 0) + 1;
  }
  const latest = draws[0]?.numbers ?? [];
  const previous = draws[1]?.numbers ?? [];
  const pred = prediction ?? [];
  return {
    distribution,
    latestOverlap: pred.filter(n => latest.includes(n)).length,
    previousOverlap: pred.filter(n => previous.includes(n)).length,
  };
}

export function computeHistoryStats(draws: DrawStatEntry[]) {
  return {
    windows: WINDOWS,
    single: computeSingleStats(draws),
    twoStarTop: computeTwoStarStats(draws, 50),
    threeStarTop: computeThreeStarStats(draws, 50),
    tail: computeTailStats(draws),
    repeat: computeRepeatStats(draws),
  };
}

function countInWindow(draws: DrawStatEntry[], n: number, window: number): number {
  return draws.slice(0, window).filter(d => d.numbers.includes(n)).length;
}

function avg(values: number[]): number {
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}
