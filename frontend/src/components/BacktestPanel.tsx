import React from 'react';
import type { BacktestRow } from '../types';
import { api } from '../api/client';

interface Props {
  backtests: BacktestRow[];
  onRefresh: () => void;
}

const BASELINE_HIT1 = 5 / 39; // ≈ 12.8%

function pct(v: number | null): string {
  if (v === null || v === undefined) return '—';
  return (v * 100).toFixed(1) + '%';
}

function HitBar({ rate, baseline }: { rate: number | null; baseline?: number }) {
  if (rate === null) return <span className="text-gray-400 text-xs">—</span>;
  const pctVal = rate * 100;
  const isAbove = baseline !== undefined ? rate > baseline : true;
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isAbove ? 'bg-emerald-500' : 'bg-red-400'}`}
          style={{ width: `${Math.min(100, pctVal)}%` }}
        />
      </div>
      <span className={`text-xs font-mono ${isAbove ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
        {pctVal.toFixed(1)}%
      </span>
    </div>
  );
}

const WINDOW_LABELS: Record<number, string> = {
  30:  '近30期',
  60:  '近60期',
  100: '近100期',
  300: '近300期',
};

export const BacktestPanel: React.FC<Props> = ({ backtests, onRefresh }) => {
  const [running, setRunning] = React.useState(false);

  const handleRunBacktest = async () => {
    setRunning(true);
    try {
      await api.runBacktest();
      onRefresh();
    } catch (e) {
      alert(`回測失敗：${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  // 只取各視窗最新的回測
  const grouped = React.useMemo(() => {
    const map: Record<number, BacktestRow> = {};
    for (const b of backtests) {
      if (!map[b.window_size] || b.id > map[b.window_size].id) {
        map[b.window_size] = b;
      }
    }
    return Object.values(map).sort((a, b) => a.window_size - b.window_size);
  }, [backtests]);

  return (
    <div className="card animate-slide-up">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">回測表現</h2>
        <button
          onClick={handleRunBacktest}
          disabled={running}
          className="btn-secondary text-xs flex items-center gap-1.5"
        >
          {running ? (
            <>
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
              </svg>
              回測中…
            </>
          ) : '執行回測'}
        </button>
      </div>

      <div className="text-xs text-gray-400 dark:text-gray-500 mb-3">
        基準線（隨機命中1碼概率）：{pct(BASELINE_HIT1)}
      </div>

      {grouped.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-400 dark:text-gray-500 text-sm">尚無回測資料</p>
          <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">請先同步資料，再點擊「執行回測」</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(b => (
            <div key={b.window_size} className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  {WINDOW_LABELS[b.window_size] ?? `${b.window_size}期視窗`}
                </span>
                {b.score !== null && (
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${b.score > 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>
                    綜合分 {b.score > 0 ? '+' : ''}{b.score.toFixed(3)}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">獨支命中率</div>
                  <HitBar rate={b.hit_rate_single} baseline={BASELINE_HIT1} />
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">五星至少1中</div>
                  <HitBar rate={b.hit_rate_five} baseline={BASELINE_HIT1} />
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">三星至少1中</div>
                  <HitBar rate={b.hit_rate_three} baseline={BASELINE_HIT1} />
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">四星至少1中</div>
                  <HitBar rate={b.hit_rate_four} baseline={BASELINE_HIT1} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                <div className="text-center">
                  <div className="text-xs text-gray-400 dark:text-gray-500">三星平均命中</div>
                  <div className="text-sm font-mono font-semibold text-gray-900 dark:text-gray-100">
                    {b.avg_hits_three?.toFixed(2) ?? '—'}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-400 dark:text-gray-500">五星平均命中</div>
                  <div className="text-sm font-mono font-semibold text-gray-900 dark:text-gray-100">
                    {b.avg_hits_five?.toFixed(2) ?? '—'}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-400 dark:text-gray-500">最長連敗</div>
                  <div className={`text-sm font-mono font-semibold ${(b.max_losing_streak ?? 0) > 20 ? 'text-red-500' : 'text-gray-900 dark:text-gray-100'}`}>
                    {b.max_losing_streak ?? '—'} 期
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
