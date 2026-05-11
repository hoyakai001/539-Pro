import React from 'react';
import type { StrategyWeightRow } from '../types';

export const StrategyPerformanceCard: React.FC<{ weights: StrategyWeightRow[] }> = ({ weights }) => (
  <div className="card animate-slide-up">
    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">策略表現</h2>
    {weights.length === 0 ? (
      <p className="text-sm text-gray-400">尚無策略權重資料</p>
    ) : (
      <div className="space-y-2">
        {weights.map(w => {
          const pct = Math.max(0, Math.min(100, w.weight * 50));
          return (
            <div key={w.id}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-600 dark:text-gray-400">{w.strategy_name}</span>
                <span className="font-mono text-gray-500">weight {w.weight.toFixed(2)} / score {w.last_score?.toFixed(3) ?? '-'}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
);
