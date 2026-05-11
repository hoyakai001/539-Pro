import React from 'react';
import type { DataStatusReport, TodayDrawStatus } from '../types';
import { NumberBall } from './NumberBall';

interface Props {
  todayDraw: TodayDrawStatus | null;
  dataStatus: DataStatusReport | null;
  latestDrawNo: string | null;
  latestDrawDate: string | null;
  lastRefresh: Date | null;
  onSync: () => void;
  syncing: boolean;
  showSync?: boolean;
}

export const DrawStatusCard: React.FC<Props> = ({
  todayDraw,
  dataStatus,
  latestDrawNo,
  latestDrawDate,
  onSync,
  syncing,
  showSync = false,
}) => {
  const latestNumbers = sorted(dataStatus?.latest_numbers ?? []);
  const previousNumbers = sorted(dataStatus?.previous_numbers ?? todayDraw?.previousNumbers ?? []);
  const todayStatus = dataStatus?.today_draw_status === 'DRAWN' ? '今日已開獎' : '今日尚未開獎';

  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">最新開獎</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            今日日期 {dataStatus?.today_date ?? todayDraw?.todayDate ?? '-'} / {todayStatus}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={dataStatus?.status ?? 'INVALID'} />
          {showSync && (
            <button className="btn-secondary text-xs" onClick={onSync} disabled={syncing}>
              {syncing ? '同步中' : '立即同步'}
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_0.8fr]">
        <div>
          <div className="text-sm font-semibold text-gray-600 dark:text-gray-300">
            最新期數 {latestDrawNo ?? '-'} / {latestDrawDate ?? '-'}
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {latestNumbers.length
              ? latestNumbers.map(n => <NumberBall key={n} number={n} size="lg" highlight />)
              : <span className="text-sm text-gray-500">暫無資料</span>}
          </div>
        </div>

        <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
          <div className="text-sm font-semibold text-gray-600 dark:text-gray-300">
            上一期 {dataStatus?.previous_draw_no ?? todayDraw?.previousDrawNo ?? '-'} / {dataStatus?.previous_draw_date ?? todayDraw?.previousDrawDate ?? '-'}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 opacity-80">
            {previousNumbers.length
              ? previousNumbers.map(n => <NumberBall key={n} number={n} size="sm" />)
              : <span className="text-sm text-gray-500">暫無資料</span>}
          </div>
        </div>
      </div>
    </section>
  );
};

function StatusBadge({ status }: { status: string }) {
  const label = status === 'VALID' ? '已更新' : status === 'PENDING_OFFICIAL' ? '等待官方' : '資料異常';
  const tone = status === 'VALID'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
    : status === 'PENDING_OFFICIAL'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
      : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200';
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{label}</span>;
}

function sorted(numbers: number[]) {
  return [...numbers].sort((a, b) => a - b);
}
