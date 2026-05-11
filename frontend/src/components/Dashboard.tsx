import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useDashboard } from '../hooks/useDashboard';
import { useTheme } from '../hooks/useTheme';
import { DrawStatusCard } from './DrawStatusCard';
import { EmptyState } from './EmptyState';
import { NumberBall } from './NumberBall';
import { PredictionCard } from './PredictionCard';
import { ComboSupportCard } from './ComboSupportCard';
import { HitPerformanceCard } from './HitPerformanceCard';
import { SettingsPage } from './SettingsPage';
import { SyncLogTable } from './SyncLogTable';
import { SyncStatusCard } from './SyncStatusCard';
import { ThemeToggle } from './ThemeToggle';

type Page = 'dashboard' | 'history' | 'audit' | 'system' | 'settings';

export const Dashboard: React.FC = () => {
  const [theme, toggleTheme] = useTheme();
  const [page, setPage] = useState<Page>('dashboard');
  const [admin, setAdmin] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const state = useDashboard();

  const refreshAdmin = async () => {
    try {
      const res = await api.adminStatus();
      setAdmin(res.authenticated);
      setSetupRequired(res.setup_required);
    } catch {
      setAdmin(false);
    }
  };

  useEffect(() => {
    void refreshAdmin();
  }, []);

  if (page === 'settings' && admin) return <SettingsPage onBack={() => setPage('dashboard')} />;

  return (
    <div className="min-h-screen bg-gray-50 transition-colors dark:bg-gray-950">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">539 純歷史統計</h1>
              <p className="text-xs text-gray-500">官方資料與已驗證 DB，預測下一期未開獎。</p>
            </div>
            <div className="flex items-center gap-2">
              <button className={page === 'dashboard' ? 'btn-primary text-xs' : 'btn-secondary text-xs'} onClick={() => setPage('dashboard')}>Dashboard</button>
              <button className={page === 'history' ? 'btn-primary text-xs' : 'btn-secondary text-xs'} onClick={() => setPage('history')}>歷史開獎</button>
              {admin && (
                <>
                  <button className={page === 'audit' ? 'btn-primary text-xs' : 'btn-secondary text-xs'} onClick={() => setPage('audit')}>資料稽核</button>
                  <button className={page === 'system' ? 'btn-primary text-xs' : 'btn-secondary text-xs'} onClick={() => setPage('system')}>系統狀態</button>
                  <button className={page === 'settings' ? 'btn-primary text-xs' : 'btn-secondary text-xs'} onClick={() => setPage('settings')}>設定</button>
                </>
              )}
              <button className="btn-secondary text-xs" onClick={() => setAdminOpen(true)}>管理員</button>
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
            </div>
          </div>
        </div>
      </header>

      {state.error && <div className="mx-auto max-w-6xl px-4 pt-4"><div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</div></div>}
      <main className="mx-auto max-w-6xl px-4 py-6">
        {state.loading && !state.latestDraw && !state.prediction ? (
          <div className="flex h-64 items-center justify-center text-gray-500">載入中...</div>
        ) : state.dataStatus && state.dataStatus.totalDraws === 0 ? (
          <EmptyState status="warning" title="尚無資料" description="請管理員先同步官方資料；同步失敗時不會產生假資料。" action={admin ? { label: '立即同步', onClick: state.syncNow, loading: state.syncing } : undefined} />
        ) : page === 'history' ? (
          <HistoryPage />
        ) : page === 'audit' && admin ? (
          <AuditPage />
        ) : page === 'system' && admin ? (
          <SystemPage status={state.dataStatus} syncNow={state.syncNow} syncing={state.syncing} />
        ) : (
          <DashboardHome state={state} admin={admin} />
        )}
      </main>

      {adminOpen && (
        <AdminDialog
          setupRequired={setupRequired}
          admin={admin}
          onClose={() => setAdminOpen(false)}
          onAuthed={() => {
            setAdmin(true);
            setSetupRequired(false);
            setAdminOpen(false);
          }}
          onLogout={() => {
            setAdmin(false);
            setPage('dashboard');
            setAdminOpen(false);
          }}
        />
      )}
    </div>
  );
};

function DashboardHome({ state, admin }: { state: ReturnType<typeof useDashboard>; admin: boolean }) {
  return (
    <div className="space-y-6">
      <DrawStatusCard
        todayDraw={state.todayDraw}
        dataStatus={state.dataStatus}
        latestDrawNo={state.dataStatus?.latest_draw_no ?? state.latestDraw?.draw_no ?? null}
        latestDrawDate={state.dataStatus?.latest_draw_date ?? state.latestDraw?.draw_date ?? null}
        lastRefresh={state.lastRefresh}
        onSync={state.syncNow}
        syncing={state.syncing}
        showSync={admin}
      />
      <PredictionCard prediction={state.prediction} reason={state.predictionReason} />
      <ComboSupportCard
        support={state.prediction?.combo_support_summary}
        performance={state.performance}
        originalAdviceLevel={state.prediction?.bet_advice?.level}
      />
      <HitPerformanceCard performance={state.performance} />
    </div>
  );
}

function HistoryPage() {
  const [recent, setRecent] = useState(30);
  const [drawNo, setDrawNo] = useState('');
  const [date, setDate] = useState('');
  const [containsNumbers, setContainsNumbers] = useState('');
  const [twoStar, setTwoStar] = useState('');
  const [data, setData] = useState<{ draws: any[]; total: number } | null>(null);

  const load = async () => {
    const query = new URLSearchParams();
    query.set('recent', String(recent));
    if (drawNo.trim()) query.set('drawNo', drawNo.trim());
    if (date.trim()) query.set('date', date.trim());
    if (containsNumbers.trim()) query.set('containsNumbers', containsNumbers.trim());
    if (twoStar.trim()) query.set('twoStar', twoStar.trim());
    const res = await api.getHistoryDraws(query.toString());
    setData({ draws: res.draws, total: res.total });
  };

  useEffect(() => {
    void load();
  }, [recent]);

  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">歷史開獎</h2>
        <div className="flex gap-2">
          {[10, 30, 60, 100].map(n => (
            <button key={n} className={recent === n ? 'btn-primary text-xs' : 'btn-secondary text-xs'} onClick={() => setRecent(n)}>{n}期</button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-5">
        <input className="input" value={drawNo} onChange={e => setDrawNo(e.target.value)} placeholder="期數" />
        <input className="input" value={date} onChange={e => setDate(e.target.value)} placeholder="日期 YYYY/MM/DD" />
        <input className="input" value={containsNumbers} onChange={e => setContainsNumbers(e.target.value)} placeholder="包含號碼 08,25" />
        <input className="input" value={twoStar} onChange={e => setTwoStar(e.target.value)} placeholder="二星 08,25" />
        <button className="btn-primary text-sm" onClick={load}>查詢</button>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr><th className="py-2">期數</th><th>日期</th><th>開獎號碼</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {(data?.draws ?? []).map((d: any) => (
              <tr key={d.draw_no}>
                <td className="py-3 font-mono">{d.draw_no}</td>
                <td>{d.draw_date}</td>
                <td><div className="flex gap-2">{d.numbers.map((n: number) => <NumberBall key={n} number={n} size="sm" />)}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AuditPage() {
  const [audit, setAudit] = useState<any>(null);
  const [pilio, setPilio] = useState<any>(null);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="card">
        <h2 className="text-xl font-bold">資料稽核</h2>
        <button className="btn-primary mt-4" onClick={() => api.runHistoryAudit().then(res => setAudit(res.data))}>執行稽核</button>
        <pre className="mt-4 max-h-96 overflow-auto rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-900">{JSON.stringify(audit, null, 2)}</pre>
      </section>
      <section className="card">
        <h2 className="text-xl font-bold">Pilio 驗證</h2>
        <button className="btn-primary mt-4" onClick={() => api.verifyPilio().then(res => setPilio(res.data))}>執行 Pilio 驗證</button>
        <pre className="mt-4 max-h-96 overflow-auto rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-900">{JSON.stringify(pilio, null, 2)}</pre>
      </section>
    </div>
  );
}

function SystemPage({ status, syncNow, syncing }: { status: any; syncNow: () => void; syncing: boolean }) {
  const [logs, setLogs] = useState<any[]>([]);
  const loadLogs = () => api.getSyncLogs(30).then(res => setLogs(res.data)).catch(() => setLogs([]));
  return (
    <div className="space-y-6">
      <SyncStatusCard status={status} onSync={syncNow} syncing={syncing} />
      <section className="card">
        <h2 className="text-xl font-bold">系統狀態</h2>
        <dl className="mt-4 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <Info label="資料狀態" value={status?.status} />
          <Info label="資料筆數" value={status?.draw_count} />
          <Info label="稽核狀態" value={status?.history_audit_status} />
          <Info label="資料來源" value={status?.active_source} />
        </dl>
      </section>
      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold" onClick={loadLogs}>sync logs</summary>
        <div className="mt-4"><SyncLogTable logs={logs} /></div>
      </details>
    </div>
  );
}

function AdminDialog({ setupRequired, onClose, onAuthed, onLogout, admin }: {
  setupRequired: boolean;
  onClose: () => void;
  onAuthed: () => void;
  onLogout: () => void;
  admin: boolean;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async () => {
    setError('');
    try {
      if (setupRequired) await api.adminSetup(password);
      const res = await api.adminLogin(password);
      sessionStorage.setItem('admin_token', res.token);
      onAuthed();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const logout = async () => {
    await api.adminLogout().catch(() => undefined);
    sessionStorage.removeItem('admin_token');
    onLogout();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{setupRequired ? '設定管理員密碼' : '管理員登入'}</h2>
          <button className="text-gray-500" onClick={onClose}>關閉</button>
        </div>
        {admin ? (
          <button className="btn-secondary mt-4 w-full" onClick={logout}>登出</button>
        ) : (
          <>
            <input
              className="mt-4 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={setupRequired ? '至少 8 個字元' : '輸入管理員密碼'}
            />
            {error && <div className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</div>}
            <button className="btn-primary mt-4 w-full" onClick={submit}>{setupRequired ? '設定並登入' : '登入'}</button>
          </>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 break-all font-semibold text-gray-900 dark:text-gray-100">{String(value ?? '-')}</div>
    </div>
  );
}
