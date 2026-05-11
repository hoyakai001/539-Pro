import React, { useState } from 'react';
import type { DataStatusReport } from '../types';

interface Props {
  status: DataStatusReport | null;
  onSync: () => void;
  syncing: boolean;
}

export const SyncStatusCard: React.FC<Props> = ({ status, onSync, syncing }) => {
  const [showDiag, setShowDiag] = useState(false);
  const title = status?.recovery_mode ? '恢復模式'
    : status?.retry_active ? '重試中'
      : status?.status === 'VALID' ? '已更新'
        : status?.status === 'PENDING_OFFICIAL' ? '待官方確認' : '資料異常';

  return (
    <div className="card animate-slide-up">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">同步狀態</h2>
        <button onClick={onSync} disabled={syncing} className="btn-secondary text-xs">{syncing ? '同步中...' : '立即同步'}</button>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-gray-500">目前狀態</span><span className="font-semibold">{title}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">active source</span><span>{status?.active_source ?? '-'}</span></div>
        <div className="text-xs text-gray-500 break-all">URL：{status?.active_source_url ?? '-'}</div>
        <div className="flex justify-between"><span className="text-gray-500">retry count</span><span>{status?.retry_count ?? 0}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">retry stage</span><span>{status?.retry_stage ?? '-'}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">recovery mode</span><span>{status?.recovery_mode ? 'yes' : 'no'}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">last sync</span><span>{status?.last_sync_time ? new Date(status.last_sync_time).toLocaleTimeString('zh-TW') : '-'}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">next sync</span><span>{status?.next_sync_time ? new Date(status.next_sync_time).toLocaleTimeString('zh-TW') : '-'}</span></div>
      </div>

      {status?.retry_active && <p className="mt-3 text-xs text-amber-600">正在重新連線資料來源，第 {status.retry_count} 次重試</p>}
      {status?.recovery_mode && <p className="mt-3 text-xs text-amber-600">官方資料暫時無法取得，系統將自動重試</p>}
      {status?.reason === '資料來源已恢復' && <p className="mt-3 text-xs text-emerald-600">資料來源已恢復</p>}

      {(status?.last_error_message || status?.last_diagnostic) && (
        <div className="mt-3">
          <button className="text-xs text-brand-500 hover:underline" onClick={() => setShowDiag(v => !v)}>
            {showDiag ? '收合 diagnostic' : '展開 diagnostic'}
          </button>
          {showDiag && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-gray-100 dark:bg-gray-800 p-2 text-xs whitespace-pre-wrap">
              {status.last_diagnostic ?? status.last_error_message}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};
