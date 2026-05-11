import React, { useState } from 'react';
import type { StrategyPerformance, StrategyPerformancePeriod } from '../types';
import { NumberBall } from './NumberBall';

type PeriodKey = 'week' | 'previous_week' | 'month' | 'previous_month';

export const HitPerformanceCard: React.FC<{ performance: StrategyPerformance | null }> = ({ performance }) => {
  const [periodKey, setPeriodKey] = useState<PeriodKey>('week');
  if (!performance) return null;
  const period = performance.periods?.[periodKey] ?? null;
  const periodRecords = period?.recent_records ?? [];

  return (
    <section className="card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">命中統計</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            僅統計已完成開獎的預測紀錄，未開獎資料不列入統計。
          </p>
        </div>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          最近 {performance.window} 筆
        </span>
      </div>

      {period && (
        <div className="mb-5 rounded-xl border border-gray-100 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              {([
                ['week', '本週'],
                ['previous_week', '上週'],
                ['month', '本月'],
                ['previous_month', '上月'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  className={periodKey === key ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
                  onClick={() => setPeriodKey(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">{period.start_date} ~ {period.end_date}</span>
          </div>
          <PeriodSummary period={period} />
        </div>
      )}

      {period && period.sample_size > 0 && (
          <div className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-gray-800 dark:border-gray-800">
            {periodRecords.map(row => (
              <div key={`${row.target_draw_no}-${row.target_date}`} className="grid gap-3 p-3 text-sm md:grid-cols-[120px_1fr_1fr]">
                <div>
                  <div className="font-mono font-semibold text-gray-700 dark:text-gray-200">{row.target_draw_no ?? row.target_date}</div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{row.target_date}</div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-gray-500">預測</div>
                  <PickLine label="獨支" numbers={row.single ? [row.single] : []} />
                  <PickLine label="二星" numbers={row.two_star} />
                  <PickLine label="三星" numbers={row.three_star} />
                  <PickLine label="四星" numbers={row.four_star} />
                  <PickLine label="五星" numbers={row.five_star} />
                </div>
                <div className="space-y-2">
                  <div>
                    <div className="text-xs font-semibold text-gray-500">開獎</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {row.actual_numbers.map(n => <NumberBall key={n} number={n} size="sm" />)}
                    </div>
                  </div>
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                    最高全中星級：{starText(highestFullStarFromRecord(row))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <HitBadge label="獨支" hit={row.single_hit} />
                    <HitBadge label="二星" hit={row.two_star_hit} />
                    <HitBadge label="三星" hit={row.three_star_hit} />
                    <HitBadge label="四星" hit={row.four_star_hit} />
                    <HitBadge label="五星" hit={row.five_star_hit} />
                  </div>
                </div>
              </div>
            ))}
          </div>
      )}
    </section>
  );
};

function PeriodSummary({ period }: { period: StrategyPerformancePeriod }) {
  if (period.sample_size === 0) return <EmptyStats />;
  return (
    <div className="space-y-3">
      {period.sample_size < 5 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
          ⚠ 目前樣本較少，統計結果可能不穩定。
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Metric label="樣本數" value={String(period.sample_size)} />
        <Metric label="最高全中星級" value={starText(highestFullStarFromPeriod(period))} />
        <Metric label="最大連續未中" value={String(period.maxLoseStreak ?? '-')} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="獨支命中率" value={percent(period.hitRateSingle)} />
        <Metric label="二星命中率" value={percent(period.hitRateTwo)} />
        <Metric label="三星命中率" value={percent(period.hitRateThree)} />
        <Metric label="四星命中率" value={percent(period.hitRateFour)} />
        <Metric label="五星命中率" value={percent(period.hitRateFive)} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="獨支命中次數" value={String(period.single_hit_count)} />
        <Metric label="二星命中次數" value={String(period.two_star_hit_count)} />
        <Metric label="三星命中次數" value={String(period.three_star_hit_count)} />
        <Metric label="四星命中次數" value={String(period.four_star_hit_count)} />
        <Metric label="五星命中次數" value={String(period.five_star_hit_count)} />
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold text-gray-500">下注建議表現</div>
        <div className="grid gap-2 md:grid-cols-3">
          <AdviceMetric label="強攻" data={period.byAdvice.STRONG} />
          <AdviceMetric label="小攻" data={period.byAdvice.SMALL} />
          <AdviceMetric label="觀望" data={period.byAdvice.WATCH} />
        </div>
      </div>
    </div>
  );
}

function PickLine({ label, numbers }: { label: string; numbers: number[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-9 text-xs text-gray-500">{label}</span>
      {numbers.length ? numbers.map(n => <NumberBall key={`${label}-${n}`} number={n} size="sm" />) : <span className="text-xs text-gray-400">-</span>}
    </div>
  );
}

function HitBadge({ label, hit }: { label: string; hit: boolean }) {
  return (
    <span className={hit
      ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
      : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400'}
    >
      {label}：{hit ? '中' : '未中'}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-bold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}

function AdviceMetric({ label, data }: { label: string; data: {
  sample_size: number;
  hitRateSingle?: number | null;
  hitRateTwo?: number | null;
  hitRateThree?: number | null;
  hitRateFour?: number | null;
  hitRateFive?: number | null;
  avgHits: number | null;
} }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800/50">
      <div className="font-semibold text-gray-800 dark:text-gray-100">{label}</div>
      <div className="mt-2 space-y-1 text-xs text-gray-500">
        <div>樣本：{data.sample_size}</div>
        <div>最高全中：{starText(highestFullStarFromAdvice(data))}</div>
      </div>
    </div>
  );
}

function EmptyStats() {
  return (
    <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600 dark:bg-gray-800/50 dark:text-gray-300">
      <div className="font-semibold text-gray-800 dark:text-gray-100">資料不足</div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">此期間尚無已完成開獎的預測紀錄。</div>
    </div>
  );
}

function percent(value: number | null): string {
  return value === null ? '-' : `${Math.round(value * 100)}%`;
}

function highestFullStarFromPeriod(period: StrategyPerformancePeriod): number {
  if (period.five_star_hit_count > 0) return 5;
  if (period.four_star_hit_count > 0) return 4;
  if (period.three_star_hit_count > 0) return 3;
  if (period.two_star_hit_count > 0) return 2;
  if (period.single_hit_count > 0) return 1;
  return 0;
}

function highestFullStarFromRecord(row: StrategyPerformance['recent_records'][number]): number {
  if (row.five_star_hit) return 5;
  if (row.four_star_hit) return 4;
  if (row.three_star_hit) return 3;
  if (row.two_star_hit) return 2;
  if (row.single_hit) return 1;
  return 0;
}

function highestFullStarFromAdvice(data: {
  hitRateSingle?: number | null;
  hitRateTwo?: number | null;
  hitRateThree?: number | null;
  hitRateFour?: number | null;
  hitRateFive?: number | null;
}): number {
  if ((data.hitRateFive ?? 0) > 0) return 5;
  if ((data.hitRateFour ?? 0) > 0) return 4;
  if ((data.hitRateThree ?? 0) > 0) return 3;
  if ((data.hitRateTwo ?? 0) > 0) return 2;
  if ((data.hitRateSingle ?? 0) > 0) return 1;
  return 0;
}

function starText(value: number): string {
  return `${value} 星`;
}
