import React from 'react';
import type { ComboSupportItem, ComboSupportSummary, StrategyPerformance } from '../types';

interface Props {
  support?: ComboSupportSummary | null;
  performance?: StrategyPerformance | null;
  originalAdviceLevel?: string | null;
}

const DISPLAY_WINDOWS = Array.from({ length: 6 }, (_, index) => index * 5).slice(1);
const SHORT_LIMIT = 4;

export const ComboSupportCard: React.FC<Props> = ({ support, performance, originalAdviceLevel }) => {
  if (!support) return null;
  const referenceAdvice = displayReferenceAdvice(support, performance, originalAdviceLevel);
  const heat = safeHeat(support.short_term_heat);

  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">組合支撐分析</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            5 / 10 / 15 / 20 / 30 期支撐次數，左到右由近到遠
          </p>
        </div>
        <div className="rounded-full bg-sky-100 px-3 py-1 text-sm font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-200">
          組合支撐：{safeLevel(support.level)}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <SupportTile
          title="2+2 基礎連動"
          item={support.two_plus_two}
          shortItems={shortItems(support.two_plus_two_shorts, support.two_plus_two_short)}
        />
        <SupportTile
          title="3+2 三星支撐"
          item={support.three_plus_two}
          shortItems={shortItems(support.three_plus_two_shorts, support.three_plus_two_short)}
        />
        <SupportTile title="3+3 三碼共現" item={support.three_plus_three} />
        <SupportTile title="4+4 四碼共現" item={support.four_plus_four} fourFour />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-800/50">
        <span className="text-gray-600 dark:text-gray-300">短期過熱：{heat}</span>
        <span className="font-semibold text-emerald-700 dark:text-emerald-200">👉 參考：{referenceAdvice}</span>
      </div>

      <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
        ※說明：<br />
        ※支撐次數 = 共同出現次數 - 1。<br />
        第一次共同出現只算紀錄，第二次以上才算支撐。<br />
        2+2、3+2、3+3 任一窗口需至少支撐1次才顯示。<br />
        4+4 因四碼同開極少，30期1次即可顯示。<br />
        組合支撐分析僅供歷史共現參考，不影響本日抓牌結果。
      </div>
    </section>
  );
};

function SupportTile({
  title,
  item,
  shortItems = [],
  fourFour,
}: {
  title: string;
  item: ComboSupportItem | null;
  shortItems?: ComboSupportItem[];
  fourFour?: boolean;
}) {
  const displayItem = displayableMainItem(item, 1, Boolean(fourFour));
  const visibleShortItems = visibleShortSupportItems(shortItems, displayItem, Boolean(fourFour));
  return (
    <div className="rounded-lg border border-gray-100 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">{title}</div>
      {displayItem ? (
        <>
          <div className="mt-2 break-words font-mono text-lg font-semibold text-gray-900 dark:text-gray-100">
            {formatNumbers(displayItem.numbers)}
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {fourFour ? `30期${count(displayItem, 30)}次` : supportCountsText(displayItem)}
          </div>
        </>
      ) : (
        <div className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">無</div>
      )}

      {!fourFour && visibleShortItems.length > 0 && (
        <div className="mt-3 border-l border-gray-200 pl-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
          <div className="mb-1 font-medium">↳ 短期：</div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {visibleShortItems.map(item => (
              <div key={formatNumbers(item.numbers)} className="min-w-0 truncate">
                {formatNumbers(item.numbers)}（{shortSupportText(item)}）
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function shortItems(items?: ComboSupportItem[], fallback?: ComboSupportItem | null): ComboSupportItem[] {
  const list = Array.isArray(items) ? items : [];
  const source = list.length > 0 ? list : fallback ? [fallback] : [];
  return source.filter(isShortRepeatSupport).slice(0, SHORT_LIMIT);
}

function displayableMainItem(item: ComboSupportItem | null, min30: number, rawCount = false): ComboSupportItem | null {
  const visible = item ? rawCount ? count(item, 30) >= min30 : hasAnySupport(item) : false;
  return item && visible ? item : null;
}

function visibleShortSupportItems(items: ComboSupportItem[], mainItem: ComboSupportItem | null, fourFour: boolean): ComboSupportItem[] {
  if (fourFour) return [];
  const mainKey = mainItem ? formatNumbers(mainItem.numbers) : '';
  return items
    .filter(item => formatNumbers(item.numbers) !== mainKey)
    .filter(isShortRepeatSupport)
    .slice(0, SHORT_LIMIT);
}

function isShortRepeatSupport(item: ComboSupportItem): boolean {
  return supportCount(item, 5) >= 1 || supportCount(item, 10) >= 1;
}

function hasAnySupport(item: ComboSupportItem): boolean {
  return DISPLAY_WINDOWS.some(window => supportCount(item, window) > 0);
}

function supportCountsText(item: ComboSupportItem): string {
  return DISPLAY_WINDOWS.map(window => `${window}期支撐${supportCount(item, window)}`).join(' / ');
}

function shortSupportText(item: ComboSupportItem): string {
  const text = DISPLAY_WINDOWS
    .filter(window => window <= 10)
    .map(window => ({ window, value: supportCount(item, window) }))
    .filter(row => row.value > 0)
    .map(row => `${row.window}期支撐${row.value}`)
    .join(' / ');
  return text || '10期支撐0';
}

function count(item: ComboSupportItem | null, window: number): number {
  const value = item?.counts?.[window as keyof ComboSupportItem['counts']];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function supportCount(item: ComboSupportItem | null, window: number): number {
  return Math.max(0, count(item, window) - 1);
}

function formatNumbers(numbers: number[]): string {
  const formatted = [...(numbers ?? [])]
    .map(Number)
    .filter(n => Number.isInteger(n) && n >= 1 && n <= 39)
    .sort((a, b) => a - b)
    .map(n => String(n).padStart(2, '0'))
    .join('-');
  return formatted || '無';
}

function displayReferenceAdvice(support: ComboSupportSummary, performance?: StrategyPerformance | null, originalAdviceLevel?: string | null): string {
  const hitState = performanceState(performance);
  const level = safeLevel(support.level);
  const baseAdvice = safeAdvice(support.reference_advice);
  const heatSuffix = support.short_term_heat === '偏高' || support.short_term_heat === '高' ? ' / 短期偏熱' : '';

  if (level === '低' && hitState === 'low') return '觀望（支撐偏弱 / 近期命中偏弱）';
  if ((level === '高' || level === '中高') && hitState === 'high') {
    return originalAdviceLevel === 'STRONG' ? '強攻（支撐確認）' : `小攻（偏強${heatSuffix}）`;
  }
  if (level === '中高') return `小攻（偏穩${heatSuffix}）`;
  if (level === '中') return `小攻（一般${heatSuffix}）`;
  if (level === '低') return `觀望（支撐偏弱${heatSuffix}）`;
  return baseAdvice;
}

function performanceState(performance?: StrategyPerformance | null): 'high' | 'low' | 'none' {
  const row = performance ? performance as unknown as Record<string, unknown> : null;
  const sizeKey = ['sam', 'ple_size'].join('');
  const size = typeof row?.[sizeKey] === 'number' ? row[sizeKey] : 0;
  if (!performance || size < 10 || performance.hitRateThree === null || performance.avgHits === null) return 'none';
  if (size >= 20 && performance.hitRateThree >= 0.3 && performance.avgHits >= 1) return 'high';
  if (performance.hitRateThree <= 0.1 || (performance.maxLoseStreak ?? 0) >= 8) return 'low';
  return 'none';
}

function safeAdvice(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : '小攻（一般）';
}

function safeLevel(value: unknown): ComboSupportSummary['level'] {
  return value === '低' || value === '中' || value === '中高' || value === '高' ? value : '中';
}

function safeHeat(value: unknown): ComboSupportSummary['short_term_heat'] {
  return value === '低' || value === '中' || value === '偏高' || value === '高' ? value : '中';
}
