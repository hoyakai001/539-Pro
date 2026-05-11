import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AppConfig } from '../types';
import { SyncLogPanel } from './SyncLogPanel';

interface SettingsPageProps {
  onBack: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ onBack }) => {
  const [form, setForm] = useState<Partial<AppConfig>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [docViewer, setDocViewer] = useState<{ title: string; text: string } | null>(null);
  const [docLoading, setDocLoading] = useState<string | null>(null);

  useEffect(() => {
    api.getConfig()
      .then(res => setForm(res.data))
      .catch(e => setMessage({ type: 'error', text: `讀取設定失敗: ${(e as Error).message}` }));
  }, []);

  const setValue = (key: keyof AppConfig, value: string | number | boolean) => {
    setForm(current => ({ ...current, [key]: value }));
  };
  const setPilio = (key: keyof AppConfig['pilio'], value: string | number | boolean) => {
    setForm(current => ({
      ...current,
      pilio: {
        enabled: true,
        baseUrl: '',
        pages: 4,
        mode: 'verifyOnly',
        requestDelayMs: 300,
        timeoutMs: 10000,
        ...(current.pilio ?? {}),
        [key]: value,
      },
    }));
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await api.saveConfig(form);
      setMessage({ type: 'success', text: '設定已儲存' });
    } catch (e) {
      setMessage({ type: 'error', text: `儲存失敗: ${(e as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  const testSync = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const res = await api.syncNow();
      const r = res.data;
      const ok = r.status === 'SUCCESS' || r.status === 'NO_NEW_DATA';
      setMessage({
        type: ok ? 'success' : 'error',
        text: `同步結果: ${r.status}, 新增 ${r.newDrawsInserted} 筆${r.errors?.length ? `, ${r.errors[0]}` : ''}`,
      });
    } catch (e) {
      setMessage({ type: 'error', text: `同步失敗: ${(e as Error).message}` });
    } finally {
      setTesting(false);
    }
  };

  const openDoc = async (kind: 'strategy' | 'cloud') => {
    const title = kind === 'strategy' ? '策略全貌' : 'Firebase / Vercel 部署指南';
    setDocLoading(kind);
    setMessage(null);
    try {
      const text = kind === 'strategy' ? await api.getStrategyDoc() : await api.getCloudDeployDoc();
      setDocViewer({ title, text });
    } catch (e) {
      setMessage({ type: 'error', text: `文件無法載入：${(e as Error).message}` });
    } finally {
      setDocLoading(null);
    }
  };

  const textField = (key: keyof AppConfig, label: string, placeholder?: string) => (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</span>
      <input
        type="text"
        value={String(form[key] ?? '')}
        onChange={e => setValue(key, e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    </label>
  );

  const numberField = (key: keyof AppConfig, label: string) => (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</span>
      <input
        type="number"
        min={1}
        value={Number(form[key] ?? 0)}
        onChange={e => setValue(key, parseInt(e.target.value, 10) || 0)}
        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    </label>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="返回"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <h1 className="text-base font-bold text-gray-900 dark:text-gray-100">系統設定</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <section className="card space-y-4">
          <h2 className="font-semibold text-sm text-gray-700 dark:text-gray-300">官方資料來源</h2>
          {textField('officialApiUrl', 'Official API URL', 'https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Daily539Result')}
          {textField('officialApiCandidates', 'Official API candidates', 'comma-separated official API URLs')}
          {textField('officialHtmlUrl', 'Official HTML URL', 'https://www.taiwanlottery.com/lotto/result/4_d/')}
          {textField('optionalSecondarySourceUrl', 'Verify-only secondary URL')}
          {numberField('syncIntervalMinutes', 'Sync interval minutes')}
          {numberField('recoveryRetryMinutes', 'Recovery retry minutes')}
          {form.dataSourceHealth && (
            <div className="grid grid-cols-1 gap-2 text-xs text-gray-600 dark:text-gray-400">
              <div>Active API: {form.dataSourceHealth.active_api_url}</div>
              <div>Active source: {form.dataSourceHealth.active_source}</div>
              <div>Pending official: {form.dataSourceHealth.pending_official ? 'yes' : 'no'}</div>
              {form.dataSourceHealth.last_error_message && <div>Last error: {form.dataSourceHealth.last_error_message}</div>}
            </div>
          )}
        </section>

        <section className="card space-y-4">
          <h2 className="font-semibold text-sm text-gray-700 dark:text-gray-300">完整文件</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <button
              className="btn-secondary text-sm"
              onClick={() => openDoc('strategy')}
              disabled={docLoading === 'strategy'}
            >
              {docLoading === 'strategy' ? '載入中...' : '開啟策略全貌'}
            </button>
            <button
              className="btn-secondary text-sm"
              onClick={() => openDoc('cloud')}
              disabled={docLoading === 'cloud'}
            >
              {docLoading === 'cloud' ? '載入中...' : '開啟 Firebase / Vercel 部署指南'}
            </button>
          </div>
        </section>

        <section className="card space-y-4">
          <h2 className="font-semibold text-sm text-gray-700 dark:text-gray-300">Pilio verify-only / backup</h2>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.pilio?.enabled ?? true}
              onChange={e => setPilio('enabled', e.target.checked)}
              className="w-4 h-4 accent-brand-500"
            />
            啟用 Pilio 驗證
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Pilio baseUrl</span>
            <input
              value={form.pilio?.baseUrl ?? ''}
              onChange={e => setPilio('baseUrl', e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
            />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">pages</span>
              <input type="number" min={1} value={form.pilio?.pages ?? 4} onChange={e => setPilio('pages', parseInt(e.target.value, 10) || 1)} className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">requestDelayMs</span>
              <input type="number" min={0} value={form.pilio?.requestDelayMs ?? 300} onChange={e => setPilio('requestDelayMs', parseInt(e.target.value, 10) || 0)} className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">timeoutMs</span>
              <input type="number" min={1000} value={form.pilio?.timeoutMs ?? 10000} onChange={e => setPilio('timeoutMs', parseInt(e.target.value, 10) || 10000)} className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm" />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">mode</span>
            <select value={form.pilio?.mode ?? 'verifyOnly'} onChange={e => setPilio('mode', e.target.value)} className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
              <option value="verifyOnly">verifyOnly</option>
              <option value="backup">backup</option>
            </select>
          </label>
        </section>

        <section className="card space-y-4">
          <h2 className="font-semibold text-sm text-gray-700 dark:text-gray-300">相容設定</h2>
          {textField('tw_lottery_api_latest', 'Legacy API URL')}
          {textField('tw_lottery_history_url', 'Legacy history URL')}
          {textField('sync_cron', 'Cron')}
          {numberField('auto_sync_interval_minutes', 'Legacy auto sync interval')}
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={!!form.verify_source_enabled}
              onChange={e => setValue('verify_source_enabled', e.target.checked)}
              className="w-4 h-4 accent-brand-500"
            />
            啟用驗證來源
          </label>
          {form.verify_source_enabled && textField('verify_source_url', 'Verify source URL')}
        </section>

        {message && (
          <div className={`p-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
          }`}>
            {message.text}
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={save} disabled={saving} className="btn-primary flex-1 disabled:opacity-60">
            {saving ? '儲存中...' : '儲存設定'}
          </button>
          <button onClick={testSync} disabled={testing} className="btn-secondary flex-1 disabled:opacity-60">
            {testing ? '同步中...' : '測試同步'}
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button className="btn-secondary" onClick={() => api.syncHistory().then(() => setMessage({ type: 'success', text: 'history sync started/completed' }))}>同步歷史</button>
          <button className="btn-secondary" onClick={() => api.runBacktest().then(() => setMessage({ type: 'success', text: 'walk-forward backtest completed' }))}>執行回測</button>
          <button className="btn-secondary" onClick={() => api.runHistoryAudit().then(() => setMessage({ type: 'success', text: 'history audit completed' }))}>執行稽核</button>
          <button className="btn-secondary" onClick={() => api.verifyPilio().then(() => setMessage({ type: 'success', text: 'Pilio verify completed' }))}>Pilio 驗證</button>
        </div>

        <SyncLogPanel />
      </main>
      {docViewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{docViewer.title}</h2>
              <button className="btn-secondary text-xs" onClick={() => setDocViewer(null)}>關閉</button>
            </div>
            <pre className="overflow-auto whitespace-pre-wrap p-4 text-sm leading-6 text-gray-700 dark:text-gray-200">
              {docViewer.text}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
