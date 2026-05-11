import React from 'react';

interface Props {
  number: number;
  size?: 'sm' | 'md' | 'lg';
  highlight?: boolean;
  score?: number;
  rank?: number;
}

const sizeClasses = {
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-12 h-12 text-lg',
};

function getBallGradient(n: number): string {
  // 依號碼範圍給不同漸層色
  if (n <= 10) return 'from-blue-500 to-blue-700 dark:from-blue-400 dark:to-blue-600';
  if (n <= 20) return 'from-violet-500 to-violet-700 dark:from-violet-400 dark:to-violet-600';
  if (n <= 30) return 'from-emerald-500 to-emerald-700 dark:from-emerald-400 dark:to-emerald-600';
  return 'from-orange-500 to-orange-700 dark:from-orange-400 dark:to-orange-600';
}

export const NumberBall: React.FC<Props> = ({ number, size = 'md', highlight, score, rank }) => {
  const grad = getBallGradient(number);
  const dim = sizeClasses[size];

  return (
    <div className="relative inline-flex flex-col items-center gap-0.5">
      <div
        className={`
          ${dim} rounded-full inline-flex items-center justify-center
          bg-gradient-to-br ${grad}
          text-white font-bold
          shadow-md shadow-black/20 dark:shadow-black/40
          ${highlight ? 'ring-2 ring-yellow-400 ring-offset-1 dark:ring-yellow-300 scale-110' : ''}
          transition-transform duration-200
        `}
      >
        {String(number).padStart(2, '0')}
      </div>
      {score !== undefined && (
        <span className="text-xs text-gray-500 dark:text-gray-400 font-mono leading-none">
          {score.toFixed(1)}
        </span>
      )}
      {rank !== undefined && (
        <span className="text-xs text-brand-500 dark:text-brand-400 font-bold leading-none">
          #{rank}
        </span>
      )}
    </div>
  );
};
