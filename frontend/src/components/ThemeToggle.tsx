import React from 'react';
import type { Theme } from '../hooks/useTheme';

interface Props {
  theme: Theme;
  onToggle: () => void;
}

export const ThemeToggle: React.FC<Props> = ({ theme, onToggle }) => (
  <button
    onClick={onToggle}
    className="
      p-2 rounded-lg
      bg-gray-100 hover:bg-gray-200
      dark:bg-gray-800 dark:hover:bg-gray-700
      text-gray-600 dark:text-gray-300
      transition-colors duration-200
    "
    aria-label={theme === 'dark' ? '切換為亮色模式' : '切換為暗色模式'}
    title={theme === 'dark' ? '切換為亮色模式' : '切換為暗色模式'}
  >
    {theme === 'dark' ? (
      // Sun icon
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 3v1m0 16v1m8.66-9h-1M4.34 12h-1m15.07-6.07l-.71.71M6.34 17.66l-.71.71M17.66 17.66l.71.71M6.34 6.34l.71.71M12 8a4 4 0 100 8 4 4 0 000-8z"/>
      </svg>
    ) : (
      // Moon icon
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/>
      </svg>
    )}
  </button>
);
