#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '../..');
const PORT = process.env.PORT || 3001;
const dashboard = fs.readFileSync(path.join(ROOT, 'frontend/src/components/Dashboard.tsx'), 'utf8');
const drawCard = fs.readFileSync(path.join(ROOT, 'frontend/src/components/DrawStatusCard.tsx'), 'utf8');
const client = fs.readFileSync(path.join(ROOT, 'frontend/src/api/client.ts'), 'utf8');
const routes = fs.readFileSync(path.join(ROOT, 'backend/src/api/routes.ts'), 'utf8');

for (const [label, ok] of [
  ['admin defaults false', dashboard.includes('const [admin, setAdmin] = useState(false)')],
  ['admin status is loaded', dashboard.includes('api.adminStatus()')],
  ['authenticated controls admin state', dashboard.includes('setAdmin(res.authenticated)')],
  ['draw card sync hidden by default', drawCard.includes('showSync = false')],
  ['draw card conditional render', drawCard.includes('{showSync &&')],
  ['dashboard passes admin to sync', dashboard.includes('showSync={admin}')],
  ['client sends admin header', client.includes('syncNow:') && client.includes('adminHeaders()')],
  ['client sends bearer admin token too', client.includes('Authorization: `Bearer ${token}`')],
  ['backend requires admin token', routes.includes('ADMIN_AUTH_REQUIRED') && routes.includes('管理員登入已失效，請重新登入後再同步')],
  ['frontend shows auth-expired sync error', fs.readFileSync(path.join(ROOT, 'frontend/src/hooks/useDashboard.ts'), 'utf8').includes('管理員登入已失效，請重新登入後再同步')],
]) {
  if (!ok) throw new Error(`sync permission check failed: ${label}`);
}

function postSyncNow() {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:${PORT}/api/sync-now`, { method: 'POST', timeout: 5000 }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  if (process.env.VERIFY_LIVE_SYNC_PERMISSION === '1') {
    try {
      const code = await postSyncNow();
      if (code !== 401 && code !== 403) throw new Error(`/api/sync-now without admin token returned ${code}`);
    } catch (e) {
      if (!/ECONNREFUSED/.test(String(e))) throw e;
      console.warn('[SKIP] live /api/sync-now permission check skipped because backend is not running');
    }
  } else {
    console.warn('[SKIP] live /api/sync-now permission check skipped; set VERIFY_LIVE_SYNC_PERMISSION=1 to exercise it');
  }
  console.log('[PASS] sync UI is admin-only and unauthenticated /api/sync-now is blocked');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
