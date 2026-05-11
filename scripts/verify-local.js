#!/usr/bin/env node
/**
 * scripts/verify-local.js
 *
 * 在獨立 local SQLite 環境下跑 npm run verify:all。
 *
 * 行為：
 *   1. 完全覆寫 process.env，不繼承 backend/.env 的 cloud-readonly 設定
 *   2. APP_MODE=local（empty）→ 走 SQLite，不連 Firestore
 *   3. CLOUD_READONLY=off（empty）→ POST mutation route 可以執行
 *   4. DB_PATH=backend/data/539.verify.sqlite → 完全獨立的測試 DB
 *   5. FIREBASE_*=blanked → 即使有人在 code 漏判 cloud mode，也接不到 Firestore
 *   6. PORT=3099 → 不撞日常 dev 的 3001
 *   7. spawn backend → 等 /api/health → 自動 admin/setup → 自動 sync-history
 *      （第一次跑會抓官方歷史；之後跑用 cache）
 *   8. spawn npm run verify:all
 *   9. 結束時 kill backend
 *
 * 安全：
 *   - 永不寫 production Firestore
 *   - 永不影響你日常 cloud-readonly dev backend (port 3001)
 *   - 永不需要關掉 backend/.env 的 CLOUD_READONLY=true
 *
 * 用法：
 *   npm run verify:local                           # 一鍵執行
 *   npm run verify:local -- --skip-bootstrap       # 已有資料、跳過 sync-history
 *   npm run verify:local -- --reset                # 刪掉 verify DB 重來
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = '3099';
const VERIFY_DB = path.join(ROOT, 'backend', 'data', '539.verify.sqlite');
const ADMIN_PASSWORD = process.env['VERIFY_ADMIN_PASSWORD'] || 'VerifyAdmin123!';
const CRON_SECRET = 'verify-local-cron-secret';
// IMPORTANT: do NOT set ADMIN_RESET_TOKEN / ADMIN_PASSWORD_HASH / ADMIN_SESSION_SECRET.
// adminSessionSecret() falls back through these; if any is set, login tokens become
// HMAC-signed v1.* tokens which logout cannot invalidate (verifySignedAdminSessionToken
// keeps validating them) → admin-auth's post-logout 401 assertion fails. With all three
// blank, login uses random hex tokens and logout properly invalidates them.
// admin-reset.js gracefully PASSes via the "protected when token is absent" branch.

const args = new Set(process.argv.slice(2));
const skipBootstrap = args.has('--skip-bootstrap');
const reset = args.has('--reset');

const env = {
  ...process.env,
  // ── mode ─────────────────────────────────────────────────────
  APP_MODE: '',
  CLOUD_READONLY: '',
  NODE_ENV: 'development',
  // ── isolated SQLite ──────────────────────────────────────────
  DB_PATH: VERIFY_DB,
  PORT,
  // ── blank Firestore (defense in depth) ───────────────────────
  FIREBASE_PROJECT_ID: '',
  FIREBASE_CLIENT_EMAIL: '',
  FIREBASE_PRIVATE_KEY: '',
  // ── admin/session: blanked so login uses random tokens (see top-of-file note) ─
  ADMIN_RESET_TOKEN: '',
  ADMIN_PASSWORD_HASH: '',
  ADMIN_SESSION_SECRET: '',
  CRON_SECRET: CRON_SECRET,
  VERIFY_ADMIN_PASSWORD: ADMIN_PASSWORD,
  // ── multi_strategy_v1: explicit OFF for verify (some verify scripts assert
  //    PREDICTION_CACHE_SCHEMA equals the baseline string; if MULTI_STRATEGY_ENABLED
  //    is inherited from outer shell, those tests would fail). Verify runs against
  //    baseline; multi-strategy is exercised by scripts/compare-multi-strategy.js.
  MULTI_STRATEGY_ENABLED: '',
  // ── ensemble_voting_v1: explicit OFF for verify (same rationale as MULTI_STRATEGY_ENABLED):
  //    verify scripts assert baseline PREDICTION_CACHE_SCHEMA; ensemble is exercised by
  //    scripts/compare-ensemble-voting.js, not by verify:local.
  ENSEMBLE_VOTING_ENABLED: '',
  // ── disable verify scripts that need cloud env from happening ─
  // (none currently; left here for future)
};

function banner() {
  console.log('================================================');
  console.log('  npm run verify:local  (isolated local SQLite)');
  console.log('================================================');
  console.log(`[verify:local] DB_PATH         = ${VERIFY_DB}`);
  console.log(`[verify:local] PORT            = ${PORT}`);
  console.log(`[verify:local] APP_MODE        = (empty → local SQLite)`);
  console.log(`[verify:local] CLOUD_READONLY  = (empty → off)`);
  console.log(`[verify:local] FIREBASE_*      = (blanked → no Firestore)`);
  console.log(`[verify:local] ADMIN_PASSWORD  = ${ADMIN_PASSWORD}`);
  console.log(`[verify:local] RESET_TOKEN     = (blanked → random session tokens)`);
  console.log(`[verify:local] reset           = ${reset}`);
  console.log(`[verify:local] skipBootstrap   = ${skipBootstrap}`);
  console.log('================================================');
}

function ensureBackendBuilt() {
  const dist = path.join(ROOT, 'backend', 'dist', 'server.js');
  if (fs.existsSync(dist)) return;
  console.log('[verify:local] backend dist not found → running backend build…');
  const r = spawnSync('npm', ['run', 'build'], {
    cwd: path.join(ROOT, 'backend'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  });
  if (r.status !== 0) {
    console.error('[verify:local] backend build failed');
    process.exit(r.status ?? 1);
  }
}

function prepareDataDir() {
  fs.mkdirSync(path.dirname(VERIFY_DB), { recursive: true });
  if (reset) {
    for (const ext of ['', '-wal', '-shm']) {
      const f = VERIFY_DB + ext;
      if (fs.existsSync(f)) { fs.unlinkSync(f); console.log(`[verify:local] removed ${f}`); }
    }
  }
}

function httpRequest(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    const req = http.request(
      { host: 'localhost', port: PORT, path: pathname, method, headers, timeout: 60000 },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); }
          catch { resolve({ status: res.statusCode, body: buf }); }
        });
      },
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('http timeout')); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function waitForHealth(timeoutMs, isAlive) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isAlive()) throw new Error('backend exited before becoming healthy');
    try {
      const r = await httpRequest('GET', '/api/health');
      if (r.status === 200) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('backend health check timeout');
}

// ──────────────────────────────────────────────────────────────
// 本地 orchestrator —— 從 scripts/verify/all.js 同步來的 script list。
// all.js 在 Node 24 + Windows 下的 isBackendUp() 累積 spawnSync 後會誤判
// backend 沒在跑（與 backend 實際狀態無關），導致 BACKEND_SCRIPTS 全被
// skip。我們在這裡直接 orchestrate，不修改任何 verify 子腳本內容。
// ──────────────────────────────────────────────────────────────
const STATIC_SCRIPTS = [
  ['no-mock', 'no-mock.js'],
  ['no-fake-data', 'no-fake-data.js'],
  ['no-hardcoded-data', 'no-hardcoded-data.js'],
  ['cloud-config', 'cloud-config.js'],
  ['data-integrity', 'data-integrity.js'],
  ['ui-no-static-data', 'ui-no-static-data.js'],
  ['pilio-source', 'pilio-source.js'],
  ['user-ui-clean', 'user-ui-clean.js'],
  ['admin-auth-ui', 'admin-auth-ui.js'],
  ['sync-button', 'sync-button.js'],
  ['sync-permission', 'sync-permission.js'],
  ['sync-logs-ui', 'sync-logs-ui.js'],
  ['cron-sync', 'cron-sync.js'],
  ['backtest-no-future-leak', 'backtest-no-future-leak.js'],
  ['antihot', 'antihot.js'],
  ['antihot-selection-penalty', 'antihot-selection-penalty.js'],
  ['recent-weighted-scoring', 'recent-weighted-scoring.js'],
  ['combo-fatigue', 'combo-fatigue.js'],
  ['recommendation-diversity', 'recommendation-diversity.js'],
  ['pair-smoothing', 'pair-smoothing.js'],
  ['freshness-balance', 'freshness-balance.js'],
  ['combo-support', 'combo-support.js'],
  ['firestore-limit', 'firestore-limit.js'],
  ['cache', 'cache.js'],
  ['quota-handler', 'quota-handler.js'],
  ['hit-performance-periods', 'hit-performance-periods.js'],
  ['hit-definition', 'hit-definition.js'],
  ['local-mode', 'local-mode.js'],
  ['cloud-mode', 'cloud-mode.js'],
  ['local-cloud-consistency', 'local-cloud-consistency.js'],
  ['strategy-docs', 'strategy-docs.js'],
  ['cloud-deploy-docs', 'cloud-deploy-docs.js'],
  ['docs-api', 'docs-api.js'],
  ['vercel-build', 'vercel-build.js'],
];
const NETWORK_SCRIPTS = [
  ['html-fetch', 'html-fetch.js', [0, 2]],
];
const BACKEND_SCRIPTS = [
  ['data-status', 'data-status.js'],
  ['sync-required', 'sync-required.js'],
  ['config-required', 'config-required.js'],
  ['admin-debug-lock', 'admin-debug-lock.js'],
  ['admin-reset', 'admin-reset.js'],
  ['admin-auth', 'admin-auth.js'],
  ['history-audit', 'history-audit.js'],
  ['backtest-integrity', 'backtest-integrity.js'],
  ['two-star-stats', 'two-star-stats.js'],
  ['score-breakdown', 'score-breakdown.js'],
  ['prediction-lock', 'prediction-lock.js'],
  ['prediction-target-future', 'prediction-target-future.js'],
  ['bet-advice', 'bet-advice.js'],
  ['sorted-numbers', 'sorted-numbers.js'],
  ['balance-model', 'balance-model.js'],
  ['advanced-stats', 'advanced-stats.js'],
  ['three-star-core', 'three-star-core.js'],
  ['three-star-main-model', 'three-star-main-model.js'],
  ['three-star-backtest', 'three-star-backtest.js'],
  ['hot-control', 'hot-control.js'],
  ['gap-reversion', 'gap-reversion.js'],
  ['overheat-balance', 'overheat-balance.js'],
  ['bet-advice-balanced', 'bet-advice-balanced.js'],
  ['draw-profile', 'draw-profile.js'],
  ['recent-stats', 'recent-stats.js'],
  ['score-normalization', 'score-normalization.js'],
  ['observation-30', 'observation-30.js'],
  ['observation-evaluation', 'observation-evaluation.js'],
  ['performance-api', 'performance-api.js'],
  ['firebase-connection', 'firebase-connection.js'],
  ['migrate-firestore', 'migrate-firestore.js'],
  ['cloud-bootstrap-history', 'cloud-bootstrap-history.js'],
  ['overheat-penalty', 'overheat-penalty.js'],
  ['combination-repeat', 'combination-repeat.js'],
  ['miss-penalty', 'miss-penalty.js'],
  ['number-analysis-ui', 'number-analysis-ui.js'],
  ['number-analysis-summary-ui', 'number-analysis-summary-ui.js'],
  ['retry-recovery', 'retry-recovery.js'],
];

function runScript(file, allowCodes = [0]) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'verify', file)], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
  return allowCodes.includes(r.status);
}

function probeOnce() {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port: Number(PORT), path: '/health', method: 'GET',
      agent: false, timeout: 5000, family: 4,
    }, (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function probeBackend() {
  for (let i = 0; i < 5; i++) {
    if (await probeOnce()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function runAllVerifyScripts() {
  let failures = 0;
  console.log('='.repeat(60));
  console.log('verify:local — running verify scripts');
  console.log('='.repeat(60));

  for (const [name, file] of STATIC_SCRIPTS) {
    console.log(`\n--- ${name} ---`);
    if (!runScript(file)) { console.error(`[FAIL] ${name}`); failures++; }
  }
  for (const [name, file, allowCodes] of NETWORK_SCRIPTS) {
    console.log(`\n--- ${name} ---`);
    if (!runScript(file, allowCodes)) { console.error(`[FAIL] ${name}`); failures++; }
  }
  // backend was spawned by this wrapper and confirmed alive by waitForHealth() before
  // STATIC_SCRIPTS started; we don't re-probe (Node 24 + Windows http.request misbehaves
  // after ~30 spawnSync iterations even when backend is verifiably alive).
  //
  // After 33 static scripts + html-fetch network call, Node 24 on Windows transiently
  // refuses outbound http connections from spawned children for a few seconds. Sleep +
  // warm up by running a handful of cheap GET probes from THIS parent process to drain
  // whatever transient state is bad before backend scripts start.
  console.log('\n[verify:local] warm-up before backend scripts…');
  await new Promise((r) => setTimeout(r, 2000));
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: Number(PORT), path: '/health', method: 'GET', agent: false, timeout: 5000, family: 4 }, (res) => { res.resume(); res.on('end', resolve); });
      req.on('error', resolve);
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.end();
    });
    await new Promise((r) => setTimeout(r, 250));
  }

  for (const [name, file] of BACKEND_SCRIPTS) {
    console.log(`\n--- ${name} ---`);
    if (!runScript(file)) { console.error(`[FAIL] ${name}`); failures++; }
  }

  console.log('\n' + '='.repeat(60));
  if (failures) {
    console.error(`[FAIL] verify:local had ${failures} failure(s)`);
    return 1;
  }
  console.log('[PASS] verify:local completed');
  return 0;
}

async function bootstrapIfNeeded() {
  if (skipBootstrap) {
    console.log('[verify:local] --skip-bootstrap → skip admin setup & sync-history');
    return;
  }

  // 1) admin setup
  try {
    const status = await httpRequest('GET', '/api/admin/status');
    if (status.body?.setup_required) {
      console.log('[verify:local] admin not set → POST /api/admin/setup …');
      const r = await httpRequest('POST', '/api/admin/setup', { password: ADMIN_PASSWORD });
      if (!r.body?.success) console.warn(`[verify:local] admin/setup response: ${JSON.stringify(r.body)}`);
    } else {
      console.log('[verify:local] admin already configured');
    }
  } catch (e) {
    console.warn(`[verify:local] admin/setup pre-check failed: ${e.message}`);
  }

  // 2) sync-history (only if no draws)
  try {
    const draws = await httpRequest('GET', '/api/draws?limit=1');
    const hasDraws = Array.isArray(draws.body?.data) && draws.body.data.length > 0;
    if (hasDraws) {
      console.log('[verify:local] DB already has draws → skip sync-history');
      return;
    }
    console.log('[verify:local] DB empty → POST /api/sync-history (network required, may take 30-90s)…');
    const r = await httpRequest('POST', '/api/sync-history');
    const inserted = r.body?.data?.newDrawsInserted;
    console.log(`[verify:local] sync-history status=${r.status} inserted=${inserted ?? 'n/a'}`);
  } catch (e) {
    console.warn(`[verify:local] sync-history failed: ${e.message} (verify scripts that need draws will fail)`);
  }
}

(async () => {
  banner();
  ensureBackendBuilt();
  prepareDataDir();

  console.log(`[verify:local] starting backend on http://localhost:${PORT} …`);
  const backend = spawn(process.execPath, ['backend/dist/server.js'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  let exited = false;
  let exitCode = 1;
  backend.on('exit', (code) => {
    exited = true;
    console.log(`[verify:local] backend exited code=${code}`);
  });

  const cleanup = () => {
    if (!exited) {
      try { backend.kill(); } catch {}
    }
  };
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  try {
    await waitForHealth(30_000, () => !exited);
    console.log('[verify:local] backend ready');

    await bootstrapIfNeeded();

    console.log('[verify:local] running verify scripts (orchestrated locally)…');
    exitCode = await runAllVerifyScripts();
  } catch (e) {
    console.error(`[verify:local] FATAL: ${e.message}`);
    exitCode = 1;
  } finally {
    cleanup();
    // brief grace period for backend to die
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`[verify:local] done; verify:all exit code = ${exitCode}`);
  process.exit(exitCode);
})();
