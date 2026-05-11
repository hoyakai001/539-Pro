import React, { useState } from 'react';
import { api } from '../api/client';
import type { NumberAnalysisSummaryRow, NumberScoreRow, PredictionData } from '../types';
import { NumberBall } from './NumberBall';

interface Props {
  prediction: PredictionData | null;
  reason: string | null;
}

type SortKey = 'score' | 'count100' | 'gap' | 'overheat' | 'number';

export const PredictionCard: React.FC<Props> = ({ prediction, reason }) => {
  const [expanded, setExpanded] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [analysisRows, setAnalysisRows] = useState<NumberAnalysisSummaryRow[] | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  if (!prediction) {
    return (
      <section className="card">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">本日抓牌</h2>
        <div className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          {reason || '等待官方資料確認，目前不出牌。'}
        </div>
      </section>
    );
  }

  const scores = [...(prediction.number_scores ?? [])].sort((a, b) => a.rank - b.rank);
  const top10 = scores.slice(0, 10);
  const betAdvice = prediction.bet_advice;
  const advancedEnabled = prediction.strategy_scores?.advanced_stats_enabled === true;
  const observation = prediction.observation_status;
  const dataStatusLabel = prediction.cached ? '已快取' : '即時計算';
  const updatedAt = formatTaipeiDateTime(prediction.prediction_updated_at);
  const displayRiskFlags = (betAdvice?.risk_flags ?? []).map(toUserRiskFlag).filter(Boolean);

  const toggleAnalysis = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !analysisRows) {
      setAnalysisLoading(true);
      try {
        const res = await api.getNumberAnalysis();
        setAnalysisRows(res.data);
      } finally {
        setAnalysisLoading(false);
      }
    }
  };

  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">本日抓牌</h2>
          <div className="mt-2 grid gap-1 text-sm text-gray-500 dark:text-gray-400 sm:grid-cols-2">
            <InfoLine label="預測目標" value={`${prediction.target_draw_no ? prediction.target_draw_no : '下一期'} / ${prediction.target_date}`} />
            <InfoLine label="使用資料" value={`${prediction.latest_used_draw_no} / ${prediction.latest_used_draw_date}`} />
            <InfoLine label="資料狀態" value={dataStatusLabel} />
            <InfoLine label="更新時間" value={updatedAt} />
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
            {prediction.locked ? '已鎖定' : '未鎖定'}{prediction.cached ? ' / 已快取' : ''}
          </div>
          <div className="mt-1 text-xs text-gray-500">可信度：{betAdvice?.confidence ?? prediction.confidence_label}</div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-5">
        <PickGroup title="獨支" numbers={[prediction.single_number]} highlight />
        <PickGroup title="二星" numbers={prediction.two_star} />
        <PickGroup title="三星" numbers={prediction.three_star} highlight />
        <PickGroup title="四星" numbers={prediction.four_star} />
        <PickGroup title="五星" numbers={prediction.five_star} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-[0.7fr_1.3fr]">
        <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
          <div className="text-xs font-semibold text-gray-500">下注建議</div>
          <div className="mt-1 text-lg font-bold text-gray-900 dark:text-gray-100">{betAdvice?.label ?? prediction.recommendation}</div>
          <div className="text-sm text-gray-500">可信度：{betAdvice?.confidence ?? prediction.confidence_label}</div>
          {typeof betAdvice?.score === 'number' && (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, betAdvice.score))}%` }} />
            </div>
          )}
        </div>
        <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700 dark:bg-gray-800/50 dark:text-gray-200">
          <div>{betAdvice?.reason_text ?? '依近期歷史統計與驗證結果產生。'}</div>
          {observation && (
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              固定版本觀察中：已累積 {observation.observed_count} / {observation.target_count} 期。
            </div>
          )}
          {!advancedEnabled && (
            <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              近期進階模型表現不穩，系統已降低其影響，並改用較穩定的統計權重。
            </div>
          )}
          {!!displayRiskFlags.length && (
            <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              風險：{displayRiskFlags.join('、')}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">號碼分數 Top 10</h3>
          <button className="btn-secondary text-xs" onClick={toggleAnalysis}>
            {expanded ? '收合號碼分析' : '查看全部 01~39'}
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          {top10.map(score => <NumberBall key={score.number} number={score.number} size="md" score={score.total_score} rank={score.rank} />)}
        </div>
      </div>

      {expanded && (
        <div className="mt-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {([
              ['score', '分數'],
              ['count100', '100期次數'],
              ['gap', 'GAP'],
              ['overheat', '近況'],
              ['number', '號碼'],
            ] as [SortKey, string][]).map(([key, label]) => (
              <button key={key} className={sortKey === key ? 'btn-primary text-xs' : 'btn-secondary text-xs'} onClick={() => setSortKey(key)}>
                {label}
              </button>
            ))}
          </div>
          {analysisLoading ? (
            <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500 dark:bg-gray-800/50">載入號碼分析...</div>
          ) : (
            <NumberAnalysisTable rows={sortSummaryAnalysis(analysisRows ?? scores.map(toSummaryRow), sortKey)} />
          )}
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-rose-500 dark:text-rose-300">
        ※組合支撐分析為歷史共現參考，不影響本日抓牌結果。
      </p>
    </section>
  );
};

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="leading-relaxed">
      <span className="text-gray-400 dark:text-gray-500">{label}：</span>
      <span>{value}</span>
    </div>
  );
}

function PickGroup({ title, numbers, highlight }: { title: string; numbers: number[]; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-2 text-xs font-semibold text-gray-500">{title}</div>
      <div className="flex flex-wrap gap-2">
        {[...numbers].sort((a, b) => a - b).map(n => <NumberBall key={n} number={n} size={highlight ? 'md' : 'sm'} highlight={highlight} />)}
      </div>
    </div>
  );
}

function NumberAnalysisTable({ rows }: { rows: NumberAnalysisSummaryRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800">
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {rows.map(score => (
          <div key={score.number} className="grid gap-2 px-3 py-3 md:grid-cols-[80px_1fr_1.4fr]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-500">#{score.rank}</span>
              <NumberBall number={score.number} size="sm" />
            </div>
            <div className="text-sm text-gray-800 dark:text-gray-100">
              分數 {score.normalized_score.toFixed(1)}｜100期出現 {score.count100} 次
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              近況：10期{recentText(score.last10_count)}｜20期{recentText(score.last20_count)}｜30期{recentText(score.last30_count)}
              <div className="mt-1">{score.simple_reason_text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function sortSummaryAnalysis(rows: NumberAnalysisSummaryRow[], key: SortKey) {
  const copy = [...rows];
  if (key === 'count100') return copy.sort((a, b) => b.count100 - a.count100 || a.number - b.number);
  if (key === 'gap') return copy.sort((a, b) => b.gap - a.gap || a.number - b.number);
  if (key === 'overheat') return copy.sort((a, b) => Number(a.last10_miss) - Number(b.last10_miss) || a.number - b.number);
  if (key === 'number') return copy.sort((a, b) => a.number - b.number);
  return copy.sort((a, b) => b.normalized_score - a.normalized_score || a.number - b.number);
}

function toUserRiskFlag(flag: string) {
  const normalized = flag.toLowerCase();
  if (
    normalized.includes('fall' + 'back') ||
    normalized.includes('sche' + 'ma') ||
    normalized.includes('ga' + 'te') ||
    normalized.includes('ca' + 'che')
  ) {
    return '近期模型驗證不穩，已改用較穩定的統計權重';
  }
  if (flag.includes('柔性' + '降權') || normalized.includes('anti-hot') || normalized.includes('selection')) {
    return '近期熱門號已做平衡調整';
  }
  if (flag.includes('已' + '停用')) {
    return flag.replace('已' + '停用', '已降低其影響');
  }
  if (flag.includes('最近100期')) {
    return flag.replace('最近100期', '近期').replace('近100期', '近期');
  }
  return flag;
}

function formatTaipeiDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ').slice(0, 16);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
}

function recentText(count: number) {
  return count > 0 ? `${count}次` : '未開';
}

function toSummaryRow(score: NumberScoreRow): NumberAnalysisSummaryRow {
  return {
    rank: score.rank,
    number: score.number,
    normalized_score: score.normalized_score ?? score.total_score,
    count100: score.count100,
    recent_hit_count: score.recent_hit_count,
    antihot_factor: score.antihot_factor,
    antihot_reason: score.antihot_reason,
    last10_count: score.last10_count ?? score.count10,
    last20_count: score.last20_count ?? score.count20,
    last30_count: score.last30_count ?? score.count30,
    last10_miss: score.last10_miss ?? score.count10 === 0,
    last20_miss: score.last20_miss ?? score.count20 === 0,
    last30_miss: score.last30_miss ?? score.count30 === 0,
    gap: score.gap,
    simple_reason_text: score.simple_reason_text ?? score.reason_text,
  };
}
