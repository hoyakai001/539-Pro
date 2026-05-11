#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const PORT = process.env.PORT || 3001;

function request(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:${PORT}${pathname}`, { method: 'POST', timeout: 10000 }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const root = path.resolve(__dirname, '../..');
  if (!fs.existsSync(path.join(root, 'vercel.json'))) {
    throw new Error('vercel.json must exist at project root');
  }
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const crons = Array.isArray(vercel.crons) ? vercel.crons : [];
  const cronSync = crons.filter(c => c.path === '/api/cron/sync');
  if (cronSync.some(c => c.schedule === '0 */5 * * *')) {
    throw new Error('vercel cron must not include 0 */5 * * *');
  }
  // cron must run exactly once daily at UTC 14:00 (Taipei 22:00).
  if (cronSync.length !== 1 || cronSync[0].schedule !== '0 14 * * *') {
    throw new Error('vercel cron /api/cron/sync must run exactly once daily at 0 14 * * * (Taipei 22:00)');
  }
  if (!fs.existsSync(path.join(root, 'api/index.js'))) {
    throw new Error('production /api entrypoint must exist for /api/cron/sync rewrite');
  }
  const apiIndex = fs.readFileSync(path.join(root, 'api/index.js'), 'utf8');
  if (!apiIndex.includes("backend/dist/server")) {
    throw new Error('production /api entrypoint must load backend/dist/server');
  }

  const routes = fs.readFileSync(path.join(root, 'backend/src/api/routes.ts'), 'utf8');
  const cloudSync = fs.readFileSync(path.join(root, 'backend/src/data/cloudSync.ts'), 'utf8');
  const syncDraws = fs.readFileSync(path.join(root, 'backend/src/data/syncDraws.ts'), 'utf8');
  const syncRecovery = fs.readFileSync(path.join(root, 'backend/src/data/syncRecoveryManager.ts'), 'utf8');
  for (const token of [
    'CRON_SECRET',
    '/cron/sync',
    'cronAuthStatus',
    'isVercelCronRequest',
    'x-cron-secret',
    'vercel-cron',
    'bearerToken',
    'unauthorized_cron',
    'writeCronSyncFailureLog',
    'writeCloudSyncLog',
    "cloudSyncNow({ type: 'cron-sync' })",
    "runManagedSync('cron-sync')",
  ]) {
    if (!routes.includes(token)) throw new Error(`cron route missing ${token}`);
  }
  const cronRouteStart = routes.indexOf("router.all('/cron/sync'");
  const cronRouteEnd = routes.indexOf("router.post('/train'", cronRouteStart);
  const cronRoute = routes.slice(cronRouteStart, cronRouteEnd);
  if (cronRoute.includes("runManagedSync('sync-now')")) {
    throw new Error('cron route must not record local cron execution as sync-now');
  }
  if (!routes.includes("if (!provided && isVercelCronRequest(req)) return { authorized: true, reason: 'vercel_cron' }")) {
    throw new Error('cron route must allow Vercel cron user-agent/header without manual secret');
  }
  if (!routes.includes("provided && expected && provided === expected")) {
    throw new Error('cron route must allow Vercel Authorization Bearer CRON_SECRET');
  }
  for (const token of [
    'CloudSyncLogStatus',
    "'cron-sync' | 'manual-sync'",
    "'success' | 'pending' | 'failed' | 'unauthorized'",
    "collection('sync_logs')",
    'writeCloudSyncLogForReport',
    'inserted',
    'latest_draw_no',
    'latest_draw_date',
    'error_message',
    'selected_source',
    'selected_url',
    'fallback_used',
    'attempted_sources',
  ]) {
    if (!cloudSync.includes(token)) throw new Error(`cloud sync log missing ${token}`);
  }
  for (const token of [
    "'sync-now' | 'sync-history' | 'retry' | 'recovery' | 'cron-sync'",
    "type: options.type ?? 'sync-now'",
    'insertSyncLog',
    'finishSyncLog',
  ]) {
    if (!syncDraws.includes(token)) throw new Error(`local sync log missing ${token}`);
  }
  if (!syncRecovery.includes("'sync-now' | 'retry' | 'recovery' | 'cron-sync'")) {
    throw new Error('runManagedSync must accept cron-sync as a separate type');
  }
  if (!routes.includes("cloudSyncNow({ type: 'manual-sync' })")) {
    throw new Error('manual cloud sync must continue to write manual-sync');
  }
  if (!routes.includes("cloudSyncNow({ type: 'cron-sync' })") || !routes.includes("runManagedSync('cron-sync')")) {
    throw new Error('cron sync must write cron-sync in cloud and local modes');
  }

  if (process.env.VERIFY_LIVE_CRON_SYNC === '1') {
    try {
      const status = await request('/api/cron/sync');
      if (status !== 401) throw new Error(`cron route must reject normal missing-secret calls, got ${status}`);
    } catch (e) {
      if (!/ECONNREFUSED/.test(String(e))) throw e;
      console.warn('[SKIP] live cron rejection check skipped because backend is not running');
    }
  } else {
    console.warn('[SKIP] live cron rejection check skipped; set VERIFY_LIVE_CRON_SYNC=1 to exercise it');
  }

  console.log('[PASS] cron sync supports Vercel cron, manual secret auth, and cloud sync logs');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
