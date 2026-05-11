import React from 'react';

interface EmptyStateProps {
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
    loading?: boolean;
  };
  hint?: string;
  status?: 'warning' | 'error' | 'info';
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title, description, action, hint, status = 'info',
}) => {
  const colors = {
    warning: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
    error:   'text-red-500 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    info:    'text-brand-500 bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-800',
  };
  const iconColor = {
    warning: 'text-amber-400',
    error:   'text-red-400',
    info:    'text-brand-400',
  };

  return (
    <div className={`rounded-xl border p-6 text-center space-y-3 ${colors[status]}`}>
      <div className="flex justify-center">
        {status === 'warning' && (
          <svg className={`w-10 h-10 ${iconColor[status]}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
          </svg>
        )}
        {status === 'error' && (
          <svg className={`w-10 h-10 ${iconColor[status]}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/>
          </svg>
        )}
        {status === 'info' && (
          <svg className={`w-10 h-10 ${iconColor[status]}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/>
          </svg>
        )}
      </div>
      <div>
        <p className="font-semibold text-gray-800 dark:text-gray-200">{title}</p>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{description}</p>
      </div>
      {action && (
        <button
          onClick={action.onClick}
          disabled={action.loading}
          className="btn-primary text-sm px-4 py-2 disabled:opacity-60"
        >
          {action.loading ? (
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
              </svg>
              {action.label}
            </span>
          ) : action.label}
        </button>
      )}
      {hint && (
        <p className="text-xs text-gray-400 dark:text-gray-600 font-mono break-all">{hint}</p>
      )}
    </div>
  );
};
