import React from 'react';
import type { PredictionData } from '../types';
import { NumberBall } from './NumberBall';

interface Props {
  prediction: PredictionData | null;
}

function FeatureRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">{label}</span>
      <div className="text-right">
        <span className="text-sm text-gray-900 dark:text-gray-100 font-semibold">{value}</span>
        {detail && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{detail}</p>}
      </div>
    </div>
  );
}

function StrategyBar({ name, score, total }: { name: string; score: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (score / total) * 100) : 0;
  const nameMap: Record<string, string> = {
    hot_100: '近100期熱度',
    hot_30:  '近30期短線',
    hot_10:  '近10期超短線',
    gap:     'GAP遺漏值',
    tail:    '尾數熱度',
    cooccurrence: '哥倆好共現',
    repeat:  '上期留牌',
    balance: '平衡修正',
    backtest_adj: '回測調整',
  };
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-xs text-gray-500 dark:text-gray-400 w-24 shrink-0">{nameMap[name] ?? name}</span>
      <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 dark:text-gray-500 w-12 text-right font-mono">
        {score.toFixed(1)}
      </span>
    </div>
  );
}

export const AnalysisPanel: React.FC<Props> = ({ prediction }) => {
  if (!prediction) {
    return (
      <div className="card">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">分析依據</h2>
        <p className="text-sm text-gray-400 dark:text-gray-500 italic">無可用資料</p>
      </div>
    );
  }

  const fs = prediction.featureSummary;
  const strategyScores = prediction.strategy_scores ?? {};
  const numericStrategyScores = Object.fromEntries(
    Object.entries(strategyScores).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
  );
  const totalStrategyScore = Object.values(numericStrategyScores).reduce((a, b) => a + b, 0);

  const strategyOrder = ['hot_100','hot_30','hot_10','gap','tail','cooccurrence','repeat','balance','backtest_adj'];

  return (
    <div className="card animate-slide-up">
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">分析依據</h2>

      {/* 特徵摘要 */}
      {fs && (
        <div className="space-y-0 mb-4">
          <FeatureRow
            label="近30期熱門號"
            value=""
            detail={fs.hotNumbers_30.length > 0 ? '（見下方號碼球）' : '資料不足'}
          />
          {fs.hotNumbers_30.length > 0 && (
            <div className="flex gap-1.5 flex-wrap pb-2.5 border-b border-gray-100 dark:border-gray-700">
              {fs.hotNumbers_30.map(n => (
                <NumberBall key={n} number={n} size="sm"
                  highlight={prediction.five_star.includes(n)} />
              ))}
            </div>
          )}

          <FeatureRow
            label="近10期短線熱"
            value=""
          />
          {fs.shortHotNumbers_10.length > 0 && (
            <div className="flex gap-1.5 flex-wrap pb-2.5 border-b border-gray-100 dark:border-gray-700">
              {fs.shortHotNumbers_10.map(n => (
                <NumberBall key={n} number={n} size="sm"
                  highlight={prediction.five_star.includes(n)} />
              ))}
            </div>
          )}

          <FeatureRow
            label="高GAP遺漏號"
            value=""
          />
          {fs.highGapNumbers.length > 0 && (
            <div className="flex gap-1.5 flex-wrap pb-2.5 border-b border-gray-100 dark:border-gray-700">
              {fs.highGapNumbers.map(n => (
                <NumberBall key={n} number={n} size="sm"
                  highlight={prediction.five_star.includes(n)} />
              ))}
            </div>
          )}

          <FeatureRow
            label="尾數熱度 Top3"
            value={fs.hotTails.map(t => `${t}尾`).join('、') || '—'}
          />

          <FeatureRow
            label="上期號碼"
            value=""
          />
          {fs.lastDrawNumbers.length > 0 && (
            <div className="flex gap-1.5 flex-wrap pb-2.5">
              {fs.lastDrawNumbers.map(n => (
                <NumberBall key={n} number={n} size="sm"
                  highlight={prediction.five_star.includes(n)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 策略分數分布 */}
      <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
          策略分數分布（Top 10 號碼加總）
        </div>
        <div className="space-y-0.5">
          {strategyOrder
            .filter(k => numericStrategyScores[k] !== undefined)
            .map(k => (
              <StrategyBar key={k} name={k} score={numericStrategyScores[k]} total={totalStrategyScore} />
            ))}
        </div>
      </div>
    </div>
  );
};
