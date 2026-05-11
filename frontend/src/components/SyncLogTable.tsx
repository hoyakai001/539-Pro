import React, { useState } from 'react';
import type { SyncLogRow } from '../types';

export const SyncLogTable: React.FC<{ logs: SyncLogRow[] }> = ({ logs }) => {
  const [open, setOpen] = useState<number | string | null>(null);

  return (
    <div className="card animate-slide-up">
      <h2 className="mb-4 text-lg font-bold text-gray-900 dark:text-gray-100">同步紀錄</h2>
      {logs.length === 0 ? (
        <p className="text-sm text-gray-400">尚無同步紀錄</p>
      ) : (
        <div className="space-y-2">
          {logs.map(log => (
            <div key={log.id} className="rounded-lg border border-gray-100 p-3 dark:border-gray-700">
              <button className="w-full text-left" onClick={() => setOpen(open === log.id ? null : log.id)}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{log.type}</span>
                  <span className="text-xs text-gray-500">{log.status}</span>
                  <span className="text-xs text-gray-500">
                    {log.finished_at ? new Date(log.finished_at).toLocaleString('zh-TW') : 'running'}
                  </span>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  selected_source={selectedSource(log)} inserted={insertedCount(log)} retry={retryCount(log)}
                </div>
                <div className="mt-1 break-all text-xs text-gray-500">
                  selected_url={selectedUrl(log)}
                  <span className="ml-2">fallback_used={fallbackUsed(log)}</span>
                </div>
              </button>
              {open === log.id && (
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-gray-100 p-2 text-xs dark:bg-gray-800">
                  {syncLogDiagnostic(log)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function selectedSource(log: SyncLogRow): string {
  return log.selected_source ?? log.source ?? log.active_source ?? '-';
}

function selectedUrl(log: SyncLogRow): string {
  return log.selected_url ?? log.source_url ?? '-';
}

function fallbackUsed(log: SyncLogRow): string {
  return typeof log.fallback_used === 'boolean' ? String(log.fallback_used) : '-';
}

function insertedCount(log: SyncLogRow): number {
  return log.inserted_count ?? log.inserted ?? log.new_draws_inserted ?? 0;
}

function retryCount(log: SyncLogRow): number {
  return log.retry_count ?? log.retry ?? 0;
}

function syncLogDiagnostic(log: SyncLogRow): string {
  const lines: string[] = [];

  if (hasSyncSourceFields(log)) {
    lines.push(`selected_source=${selectedSource(log)}`);
    lines.push(`selected_url=${selectedUrl(log)}`);
    lines.push(`fallback_used=${fallbackUsed(log)}`);
    lines.push('');
    lines.push('attempted_sources:');

    const attempts = Array.isArray(log.attempted_sources) ? log.attempted_sources : [];
    if (attempts.length > 0) {
      for (const attempt of attempts) {
        const source = attempt?.source ?? 'unknown';
        const status = attempt?.status ?? 'unknown';
        const url = attempt?.url ?? '-';
        const error = attempt?.error ? ` (${attempt.error})` : '';
        lines.push(`- ${source} ${status} ${url}${error}`);
      }
    } else {
      lines.push('- none');
    }
  }

  const diagnostic = log.diagnostic || log.error_stack || log.message || '';
  if (diagnostic) {
    if (lines.length > 0) lines.push('');
    lines.push(diagnostic);
  }

  return lines.length > 0 ? lines.join('\n') : 'no diagnostic';
}

function hasSyncSourceFields(log: SyncLogRow): boolean {
  return Boolean(
    log.selected_source ??
      log.selected_url ??
      log.fallback_used ??
      (Array.isArray(log.attempted_sources) && log.attempted_sources.length > 0),
  );
}
