/**
 * 特徵計算模組
 * 今彩539：號碼 01~39，每期開出 5 個
 * 所有計算均基於傳入的歷史資料，不直接存取 DB（方便測試與回測）
 */

export interface DrawEntry {
  draw_no: string;
  draw_date: string;
  numbers: number[];
}

// ─── 1. 熱度模型 ──────────────────────────────────────────────────────────
// 計算各視窗下每個號碼出現次數，用於 hot_100 / hot_30 / hot_10

export interface HotColdResult {
  counts: Record<number, number>;    // 號碼 → 出現次數
  maxCount: number;
  avgCount: number;
}

export function calcHotCold(draws: DrawEntry[], windowSize: number): HotColdResult {
  const window = draws.slice(0, windowSize);
  const counts: Record<number, number> = {};
  for (let n = 1; n <= 39; n++) counts[n] = 0;

  for (const d of window) {
    for (const n of d.numbers) counts[n]++;
  }

  const vals = Object.values(counts);
  const maxCount = Math.max(...vals);
  const avgCount = vals.reduce((a, b) => a + b, 0) / 39;

  return { counts, maxCount, avgCount };
}

/**
 * 轉換成 0~1 的正規化分數
 * 使用 rank-based softmax 而非 linear，避免少數超熱號碼壟斷全部分數
 */
export function hotScoreNormalized(counts: Record<number, number>): Record<number, number> {
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const n = sorted.length;
  const result: Record<number, number> = {};
  sorted.forEach(([num], rank) => {
    // 排名越前越高，使用線性遞減：rank 0 = 1.0, rank 38 = 0.0
    result[Number(num)] = (n - 1 - rank) / (n - 1);
  });
  return result;
}

// ─── 2. GAP 遺漏值模型 ────────────────────────────────────────────────────

export interface GapInfo {
  lastSeenIndex: number;   // 在 draws 陣列中最後一次出現的 index（0 = 最新）
  currentGap: number;      // 已經隔了幾期沒出現（基於傳入的 draws 長度）
  averageGap: number;      // 平均遺漏間隔
  maxGap: number;          // 歷史最大遺漏
  appearances: number;     // 出現次數
}

export function calcGap(draws: DrawEntry[]): Record<number, GapInfo> {
  const result: Record<number, GapInfo> = {};

  for (let n = 1; n <= 39; n++) {
    let lastSeenIndex = -1;
    const gaps: number[] = [];
    let prevSeenIndex = -1;

    for (let i = 0; i < draws.length; i++) {
      if (draws[i].numbers.includes(n)) {
        if (prevSeenIndex >= 0) {
          gaps.push(i - prevSeenIndex);
        }
        if (lastSeenIndex < 0) lastSeenIndex = i;
        prevSeenIndex = i;
      }
    }

    const appearances = draws.filter(d => d.numbers.includes(n)).length;
    const currentGap = lastSeenIndex >= 0 ? lastSeenIndex : draws.length;
    const averageGap = appearances > 0 ? draws.length / appearances : draws.length;
    const maxGap = gaps.length > 0 ? Math.max(...gaps) : averageGap * 2;

    result[n] = { lastSeenIndex, currentGap, averageGap, maxGap, appearances };
  }

  return result;
}

/**
 * GAP 評分：
 * - currentGap ≥ 2× averageGap → 最高分（號碼「欠開」）
 * - currentGap ≈ averageGap → 中等分
 * - currentGap < 0.5× averageGap（剛開過）→ 低分
 * - 有上限，避免極冷號碼無限加分
 */
export function gapScoreNormalized(gapMap: Record<number, GapInfo>): Record<number, number> {
  const scores: Record<number, number> = {};

  for (let n = 1; n <= 39; n++) {
    const g = gapMap[n];
    if (!g || g.appearances === 0) {
      scores[n] = 0.3; // 從未出現 → 給基礎分，但不過高
      continue;
    }

    const ratio = g.currentGap / g.averageGap;

    let score: number;
    if (ratio >= 3.0) {
      score = 0.95; // 極度遺漏，上限 0.95
    } else if (ratio >= 2.0) {
      score = 0.75 + (ratio - 2.0) * 0.2;
    } else if (ratio >= 1.2) {
      score = 0.5 + (ratio - 1.2) * (0.25 / 0.8);
    } else if (ratio >= 0.8) {
      score = 0.3 + (ratio - 0.8) * (0.2 / 0.4);
    } else {
      // 剛剛出現過
      score = Math.max(0.05, ratio * 0.375);
    }

    scores[n] = Math.min(0.95, score);
  }

  return scores;
}

// ─── 3. 尾數模型 ──────────────────────────────────────────────────────────

/** 取得號碼的尾數（個位數，10/20/30 尾數為 0） */
export function getTail(n: number): number {
  return n % 10;
}

export function calcTailHot(draws: DrawEntry[], windowSize: number): Record<number, number> {
  const window = draws.slice(0, windowSize);
  const tailCounts: Record<number, number> = {};
  for (let t = 0; t <= 9; t++) tailCounts[t] = 0;

  for (const d of window) {
    for (const n of d.numbers) tailCounts[getTail(n)]++;
  }

  return tailCounts;
}

export function tailScoreNormalized(
  tailCounts5: Record<number, number>,
  tailCounts10: Record<number, number>,
  tailCounts30: Record<number, number>,
): Record<number, number> {
  const combined: Record<number, number> = {};
  for (let t = 0; t <= 9; t++) {
    combined[t] = tailCounts5[t] * 0.5 + tailCounts10[t] * 0.3 + tailCounts30[t] * 0.2;
  }

  const maxVal = Math.max(...Object.values(combined));
  const scores: Record<number, number> = {};

  for (let n = 1; n <= 39; n++) {
    const tail = getTail(n);
    scores[n] = maxVal > 0 ? combined[tail] / maxVal : 0;
  }

  return scores;
}

// ─── 4. 哥倆好共現模型 ────────────────────────────────────────────────────

export function calcCoOccurrence(
  draws: DrawEntry[],
  windowSize: number,
): Record<number, Record<number, number>> {
  const window = draws.slice(0, windowSize);
  const matrix: Record<number, Record<number, number>> = {};

  for (let i = 1; i <= 39; i++) {
    matrix[i] = {};
    for (let j = 1; j <= 39; j++) {
      if (i !== j) matrix[i][j] = 0;
    }
  }

  for (const d of window) {
    const nums = d.numbers;
    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        matrix[nums[i]][nums[j]]++;
        matrix[nums[j]][nums[i]]++;
      }
    }
  }

  return matrix;
}

/**
 * 給定一組已選高分號碼，計算其他號碼與它們的共現加分
 * topNums：已選的高分號碼集合
 */
export function coOccurrenceScore(
  matrix: Record<number, Record<number, number>>,
  topNums: number[],
  windowSize: number,
): Record<number, number> {
  const scores: Record<number, number> = {};
  const maxPossible = topNums.length * (windowSize / 8); // 期望共現次數上限估算

  for (let n = 1; n <= 39; n++) {
    if (topNums.includes(n)) { scores[n] = 0; continue; }
    let total = 0;
    for (const t of topNums) {
      total += matrix[n]?.[t] ?? 0;
    }
    scores[n] = maxPossible > 0 ? Math.min(1, total / maxPossible) : 0;
  }

  return scores;
}

// ─── 5. 上期留牌模型 ──────────────────────────────────────────────────────

/**
 * 統計近 N 期中有幾期包含「與上一期相同的號碼」
 * 回傳：repeatRate（0~1），上一期號碼清單
 */
export function calcRepeatRate(draws: DrawEntry[], lookback: number): {
  repeatRate: number;
  lastDrawNumbers: number[];
} {
  if (draws.length < 2) return { repeatRate: 0.15, lastDrawNumbers: [] };

  const lastDrawNumbers = draws[0].numbers;
  let repeatCount = 0;

  const window = draws.slice(1, lookback + 1);
  for (const d of window) {
    const shared = d.numbers.filter(n => lastDrawNumbers.includes(n));
    if (shared.length >= 1) repeatCount++;
  }

  const repeatRate = window.length > 0 ? repeatCount / window.length : 0.15;
  return { repeatRate, lastDrawNumbers };
}

export function repeatScoreNormalized(
  lastDrawNumbers: number[],
  repeatRate: number,
): Record<number, number> {
  const scores: Record<number, number> = {};
  // repeatRate 越高，留牌加分越重，但上限 0.6（不能壓過整體）
  const bonus = Math.min(0.6, repeatRate * 1.2);

  for (let n = 1; n <= 39; n++) {
    scores[n] = lastDrawNumbers.includes(n) ? bonus : 0;
  }

  return scores;
}

// ─── 6. 平衡模型 ──────────────────────────────────────────────────────────

/**
 * 平衡評分：給候選號碼的集合打分
 * 考量奇偶、大小（01-19小、20-39大）、區間（01-10/11-20/21-30/31-39）
 * 輸入：已選的號碼（最多5個），候選號碼 n
 * 回傳：加分（0~1）
 */
export function balanceScore(
  selected: number[],
  candidate: number,
): number {
  const all = [...selected, candidate];

  const oddCount = all.filter(n => n % 2 !== 0).length;
  const evenCount = all.length - oddCount;
  const smallCount = all.filter(n => n <= 19).length;
  const largeCount = all.length - smallCount;

  // 理想：奇偶接近 3:2 或 2:3，大小類似
  const oddEvenBalance = 1 - Math.abs(oddCount - evenCount) / all.length;
  const sizeBalance = 1 - Math.abs(smallCount - largeCount) / all.length;

  // 區間分布
  const zones = [0, 0, 0, 0];
  for (const n of all) {
    if (n <= 10) zones[0]++;
    else if (n <= 20) zones[1]++;
    else if (n <= 30) zones[2]++;
    else zones[3]++;
  }
  const maxZone = Math.max(...zones);
  const zoneBalance = 1 - (maxZone - 1) / all.length; // 懲罰集中在單一區間

  return (oddEvenBalance * 0.3 + sizeBalance * 0.3 + zoneBalance * 0.4);
}

// ─── 綜合特徵摘要（供 UI 顯示用） ─────────────────────────────────────────

export interface FeatureSummary {
  hotNumbers_30: number[];
  shortHotNumbers_10: number[];
  hotTails: number[];
  highGapNumbers: number[];
  lastDrawNumbers: number[];
  oddCount: number;
  evenCount: number;
  smallCount: number;
  largeCount: number;
  zoneDistribution: [number, number, number, number];
}

export function buildFeatureSummary(draws: DrawEntry[]): FeatureSummary {
  if (draws.length === 0) {
    return {
      hotNumbers_30: [], shortHotNumbers_10: [], hotTails: [], highGapNumbers: [],
      lastDrawNumbers: [], oddCount: 0, evenCount: 0, smallCount: 0, largeCount: 0,
      zoneDistribution: [0, 0, 0, 0],
    };
  }

  const hot30 = calcHotCold(draws, Math.min(30, draws.length));
  const sorted30 = Object.entries(hot30.counts).sort((a, b) => b[1] - a[1]);
  const hotNumbers_30 = sorted30.slice(0, 8).map(([n]) => Number(n));

  const hot10 = calcHotCold(draws, Math.min(10, draws.length));
  const sorted10 = Object.entries(hot10.counts).sort((a, b) => b[1] - a[1]);
  const shortHotNumbers_10 = sorted10.slice(0, 5).map(([n]) => Number(n));

  const tail5 = calcTailHot(draws, 5);
  const tail10 = calcTailHot(draws, Math.min(10, draws.length));
  const tail30 = calcTailHot(draws, Math.min(30, draws.length));
  const tailCombined: Record<number, number> = {};
  for (let t = 0; t <= 9; t++) {
    tailCombined[t] = tail5[t] * 0.5 + tail10[t] * 0.3 + tail30[t] * 0.2;
  }
  const sortedTails = Object.entries(tailCombined).sort((a, b) => b[1] - a[1]);
  const hotTails = sortedTails.slice(0, 3).map(([t]) => Number(t));

  const gapMap = calcGap(draws);
  const highGapNumbers = Object.entries(gapMap)
    .filter(([, g]) => g.currentGap >= g.averageGap * 1.5)
    .sort((a, b) => (b[1].currentGap / b[1].averageGap) - (a[1].currentGap / a[1].averageGap))
    .slice(0, 6)
    .map(([n]) => Number(n));

  const lastDrawNumbers = draws[0].numbers;

  return {
    hotNumbers_30, shortHotNumbers_10, hotTails, highGapNumbers, lastDrawNumbers,
    oddCount: 0, evenCount: 0, smallCount: 0, largeCount: 0, zoneDistribution: [0, 0, 0, 0],
  };
}
