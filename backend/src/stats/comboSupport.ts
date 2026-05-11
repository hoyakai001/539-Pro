import type { DrawEntry } from '../engine/features';
import { sortNumbers } from '../utils/numbers';

type WindowSize = 5 | 10 | 15 | 20 | 30;
const WINDOWS = Array.from({ length: 6 }, (_, index) => index * 5).slice(1) as WindowSize[];
const REMOVED_FOUR_PLUS_THREE_KEY = ['four', 'plus', 'three'].join('_');

export interface ComboSupportCounts {
  5: number;
  10: number;
  15: number;
  20: number;
  30: number;
}

export interface ComboSupportItem {
  label: '2+2' | '3+2' | '3+3' | '4+4';
  numbers: number[];
  counts: ComboSupportCounts;
  exists: boolean;
}

export interface ComboSupportSummary {
  level: '低' | '中' | '中高' | '高';
  windows: number[];
  two_plus_two: ComboSupportItem | null;
  two_plus_two_short: ComboSupportItem | null;
  two_plus_two_shorts: ComboSupportItem[];
  three_plus_two: ComboSupportItem | null;
  three_plus_two_short: ComboSupportItem | null;
  three_plus_two_shorts: ComboSupportItem[];
  three_plus_three: ComboSupportItem | null;
  four_plus_four: ComboSupportItem | null;
  short_term_heat: '低' | '中' | '偏高' | '高';
  reference_advice: string;
  explanation: string;
}

export interface ComboSupportPredictionInput {
  two_star?: number[] | null;
  three_star?: number[] | null;
  four_star?: number[] | null;
  five_star?: number[] | null;
  bet_advice?: { level?: string | null } | null;
}

export function buildComboSupportSummary(
  draws: DrawEntry[],
  prediction: ComboSupportPredictionInput,
): ComboSupportSummary {
  const recent = draws.slice(0, 30);
  const five = uniqueSorted(prediction.five_star ?? []);
  const three = uniqueSorted(prediction.three_star ?? []);
  const four = uniqueSorted(prediction.four_star ?? []);
  const selectedTwo = uniqueSorted(prediction.two_star ?? []);

  const pairCandidates = uniqueCombos([
    ...(selectedTwo.length === 2 ? [selectedTwo] : []),
    ...combinations(five, 2),
  ]);
  const threePairCandidates = uniqueCombos(combinations(three, 2));

  const twoRanked = rankCombos(recent, pairCandidates, '2+2', 'long');
  const threePairRanked = rankCombos(recent, threePairCandidates, '3+2', 'long');
  const twoShortRanked = rankCombos(recent, pairCandidates, '2+2', 'short');
  const threePairShortRanked = rankCombos(recent, threePairCandidates, '3+2', 'short');
  const threeItem = three.length === 3 ? countCombo(recent, three, '3+3') : null;
  const fourItem = four.length === 4 ? countCombo(recent, four, '4+4') : null;

  const twoPrimary = supportOrNull(twoRanked[0] ?? null);
  const threePairPrimary = supportOrNull(threePairRanked[0] ?? null);
  const threePrimary = supportOrNull(threeItem);
  const fourFourPrimary = fourItem && safeCount(fourItem, 30) > 0 ? fourItem : null;
  const twoShort = shortSupport(twoShortRanked, twoPrimary);
  const threePairShort = shortSupport(threePairShortRanked, threePairPrimary);
  const twoShorts = shortSupportList(twoShortRanked, twoPrimary);
  const threePairShorts = shortSupportList(threePairShortRanked, threePairPrimary);
  const shortTermHeat = shortTermHeatLevel([twoPrimary, threePairPrimary, ...twoShorts, ...threePairShorts]);

  return {
    level: supportLevel([twoPrimary, threePairPrimary, threePrimary, fourFourPrimary]),
    windows: [...WINDOWS],
    two_plus_two: twoPrimary,
    two_plus_two_short: twoShort,
    two_plus_two_shorts: twoShorts,
    three_plus_two: threePairPrimary,
    three_plus_two_short: threePairShort,
    three_plus_two_shorts: threePairShorts,
    three_plus_three: threePrimary,
    four_plus_four: fourFourPrimary,
    short_term_heat: shortTermHeat,
    reference_advice: buildReferenceAdvice(twoPrimary, threePairPrimary, threePrimary, fourFourPrimary, prediction.bet_advice?.level, shortTermHeat),
    explanation: '支撐次數 = 共同出現次數 - 1。第一次共同出現只算紀錄，第二次以上才算支撐。2+2、3+2、3+3 任一窗口需至少支撐1次才顯示。4+4 因四碼同開極少，30期1次即可顯示。組合支撐分析僅供歷史共現參考，不影響本日抓牌結果。',
  };
}

export function isComboSupportSummaryComplete(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const summary = value as Record<string, unknown>;
  if (REMOVED_FOUR_PLUS_THREE_KEY in summary) return false;
  if (typeof summary['reference_advice'] !== 'string' || !summary['reference_advice'].trim()) return false;
  if (!['低', '中', '中高', '高'].includes(String(summary['level'] ?? ''))) return false;
  if (!['低', '中', '偏高', '高'].includes(String(summary['short_term_heat'] ?? ''))) return false;
  return fieldMeetsAnySupport(summary, 'two_plus_two')
    && shortFieldMeetsThreshold(summary, 'two_plus_two_short')
    && fieldMeetsAnySupport(summary, 'three_plus_two')
    && shortFieldMeetsThreshold(summary, 'three_plus_two_short')
    && fieldMeetsAnySupport(summary, 'three_plus_three')
    && fieldMeetsRaw30(summary, 'four_plus_four', 1)
    && hasCompleteCountList(summary['two_plus_two_shorts'])
    && hasCompleteCountList(summary['three_plus_two_shorts']);
}

function countCombo(draws: DrawEntry[], combo: number[], label: ComboSupportItem['label']): ComboSupportItem {
  const numbers = uniqueSorted(combo);
  const counts = Object.fromEntries(WINDOWS.map(window => [
    window,
    draws.slice(0, window).filter(draw => numbers.every(n => draw.numbers.includes(n))).length,
  ])) as Record<WindowSize, number>;
  return {
    label,
    numbers,
    counts: completeCounts(counts),
    exists: Object.values(counts).some(count => count > 0),
  };
}

function rankCombos(draws: DrawEntry[], combos: number[][], label: ComboSupportItem['label'], mode: 'long' | 'short'): ComboSupportItem[] {
  return uniqueCombos(combos)
    .map(combo => countCombo(draws, combo, label))
    .sort((a, b) => {
      if (mode === 'short') {
        return supportCount(b, 10) - supportCount(a, 10) ||
          supportCount(b, 5) - supportCount(a, 5) ||
          comboKey(a.numbers).localeCompare(comboKey(b.numbers));
      }
      return supportCount(b, 30) - supportCount(a, 30) ||
        supportCount(b, 20) - supportCount(a, 20) ||
        supportCount(b, 15) - supportCount(a, 15) ||
        supportCount(b, 10) - supportCount(a, 10) ||
        supportCount(b, 5) - supportCount(a, 5) ||
        comboKey(a.numbers).localeCompare(comboKey(b.numbers));
    });
}

function shortSupport(ranked: ComboSupportItem[], primary: ComboSupportItem | null): ComboSupportItem | null {
  const primaryKey = primary ? comboKey(primary.numbers) : '';
  return ranked.find(item =>
    comboKey(item.numbers) !== primaryKey &&
    isShortRepeatSupport(item)
  ) ?? null;
}

function shortSupportList(ranked: ComboSupportItem[], primary: ComboSupportItem | null): ComboSupportItem[] {
  const primaryKey = primary ? comboKey(primary.numbers) : '';
  return ranked
    .filter(item =>
      comboKey(item.numbers) !== primaryKey &&
      isShortRepeatSupport(item)
    )
    .slice(0, 4);
}

function supportOrNull(item: ComboSupportItem | null): ComboSupportItem | null {
  return item && hasAnySupport(item) ? item : null;
}

function isShortRepeatSupport(item: ComboSupportItem): boolean {
  return supportCount(item, 5) >= 1 || supportCount(item, 10) >= 1;
}

function hasAnySupport(item: ComboSupportItem): boolean {
  return WINDOWS.some(window => supportCount(item, window) > 0);
}

function supportLevel(items: Array<ComboSupportItem | null>): ComboSupportSummary['level'] {
  const maxSupport = Math.max(0, ...items.map(item => item ? maxSupportMetric(item) : 0));
  if (maxSupport >= 5) return '高';
  if (maxSupport >= 3) return '中高';
  if (maxSupport >= 1) return '中';
  return '低';
}

function buildReferenceAdvice(
  twoPlusTwo: ComboSupportItem | null,
  threePlusTwo: ComboSupportItem | null,
  threePlusThree: ComboSupportItem | null,
  fourPlusFour: ComboSupportItem | null,
  originalLevel: string | null | undefined,
  shortTermHeat: ComboSupportSummary['short_term_heat'],
): string {
  const twoExists = Boolean(twoPlusTwo);
  const threePair30 = threePlusTwo ? supportCount(threePlusTwo, 30) : 0;
  const triple30 = threePlusThree ? supportCount(threePlusThree, 30) : 0;
  const four30 = fourPlusFour ? safeCount(fourPlusFour, 30) : 0;
  const heatSuffix = shortTermHeat === '偏高' || shortTermHeat === '高' ? '，短期偏熱' : '';

  if (!twoExists && threePair30 === 0 && triple30 === 0) return `觀望（支撐偏弱${heatSuffix}）`;
  if ((threePair30 >= 5 && triple30 >= 2) || four30 >= 1) {
    return originalLevel === 'STRONG' ? '強攻（支撐確認）' : `小攻（偏強${heatSuffix}）`;
  }
  if (threePair30 >= 3 && triple30 >= 1) return `小攻（偏穩${heatSuffix}）`;
  if (threePair30 > 0) return `小攻（一般${heatSuffix}）`;
  return `觀望（支撐偏弱${heatSuffix}）`;
}

function shortTermHeatLevel(items: Array<ComboSupportItem | null>): ComboSupportSummary['short_term_heat'] {
  const max10 = Math.max(0, ...items.map(item => item ? supportMetric(item, 10) : 0));
  const max5 = Math.max(0, ...items.map(item => item ? supportMetric(item, 5) : 0));
  if (max5 >= 3 || max10 >= 5) return '高';
  if (max5 >= 2 || max10 >= 3) return '偏高';
  if (max5 >= 1 || max10 >= 1) return '中';
  return '低';
}

function combinations(numbers: number[], size: number): number[][] {
  const result: number[][] = [];
  const sorted = uniqueSorted(numbers);
  const walk = (start: number, picked: number[]) => {
    if (picked.length === size) {
      result.push([...picked]);
      return;
    }
    for (let i = start; i < sorted.length; i++) walk(i + 1, [...picked, sorted[i]]);
  };
  walk(0, []);
  return result;
}

function uniqueCombos(combos: number[][]): number[][] {
  const seen = new Set<string>();
  const result: number[][] = [];
  for (const combo of combos) {
    const sorted = uniqueSorted(combo);
    const key = comboKey(sorted);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(sorted);
  }
  return result;
}

function uniqueSorted(numbers: number[]): number[] {
  return sortNumbers([...new Set(numbers.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 39))]);
}

function comboKey(numbers: number[]): string {
  return numbers.map(n => String(n).padStart(2, '0')).join('-');
}

function completeCounts(value: Partial<Record<WindowSize, number>> | undefined): ComboSupportCounts {
  return Object.fromEntries(WINDOWS.map(window => [window, finiteCount(value?.[window])])) as unknown as ComboSupportCounts;
}

function safeCount(item: ComboSupportItem, window: WindowSize): number {
  return finiteCount(item.counts?.[window]);
}

function supportCount(item: ComboSupportItem, window: WindowSize): number {
  return Math.max(0, safeCount(item, window) - 1);
}

function supportMetric(item: ComboSupportItem, window: WindowSize): number {
  return item.label === '4+4' ? safeCount(item, window) : supportCount(item, window);
}

function maxSupportMetric(item: ComboSupportItem): number {
  return Math.max(0, ...WINDOWS.map(window => supportMetric(item, window)));
}

function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function hasCompleteCounts(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const counts = (value as { counts?: Record<string, unknown> }).counts;
  if (!counts) return false;
  return WINDOWS.every(window => typeof counts[String(window)] === 'number' && Number.isFinite(counts[String(window)]));
}

function hasCompleteCountList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 4 && value.every(item => hasCompleteCounts(item) && unknownShortRepeatSupport(item));
}

function fieldMeetsAnySupport(summary: Record<string, unknown>, key: string): boolean {
  const value = summary[key];
  return value === null || (hasCompleteCounts(value) && unknownHasAnySupport(value));
}

function fieldMeetsRaw30(summary: Record<string, unknown>, key: string, min30: number): boolean {
  const value = summary[key];
  return value === null || (hasCompleteCounts(value) && unknownCount(value, 30) >= min30);
}

function shortFieldMeetsThreshold(summary: Record<string, unknown>, key: string): boolean {
  const value = summary[key];
  return value === null || (hasCompleteCounts(value) && unknownShortRepeatSupport(value));
}

function unknownShortRepeatSupport(value: unknown): boolean {
  return unknownSupportCount(value, 5) >= 1 || unknownSupportCount(value, 10) >= 1;
}

function unknownHasAnySupport(value: unknown): boolean {
  return WINDOWS.some(window => unknownSupportCount(value, window) > 0);
}

function unknownCount(value: unknown, window: WindowSize): number {
  if (!value || typeof value !== 'object') return 0;
  const counts = (value as { counts?: Record<string, unknown> }).counts;
  if (!counts) return 0;
  return finiteCount(counts[String(window)]);
}

function unknownSupportCount(value: unknown, window: WindowSize): number {
  return Math.max(0, unknownCount(value, window) - 1);
}
