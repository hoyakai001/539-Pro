#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../frontend/src');
const drawCard = fs.readFileSync(path.join(root, 'components', 'DrawStatusCard.tsx'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'components', 'Dashboard.tsx'), 'utf8');
const client = fs.readFileSync(path.join(root, 'api', 'client.ts'), 'utf8');
const routes = fs.readFileSync(path.resolve(__dirname, '../../backend/src/api/routes.ts'), 'utf8');

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

if (!drawCard.includes('showSync?: boolean') || !drawCard.includes('showSync = false')) {
  fail('sync button must be hidden by default');
}
if (!drawCard.includes('{showSync &&')) fail('sync button must only render when showSync is true');
if (!dashboard.includes('const [admin, setAdmin] = useState(false)')) fail('admin state must default to false');
if (!dashboard.includes('api.adminStatus()') || !dashboard.includes('setAdmin(res.authenticated)')) {
  fail('Dashboard must call /api/admin/status and use authenticated to set admin state');
}
if (!dashboard.includes('showSync={admin}')) fail('Dashboard must only pass showSync for authenticated admin');
if (!dashboard.includes('action={admin ?')) fail('EmptyState sync action must be admin-only');
if (!drawCard.includes('onSync') || !dashboard.includes('onSync={state.syncNow}')) {
  fail('admin sync button is not wired to state.syncNow');
}
if (!client.includes("syncNow:") || !client.includes("'/sync-now'") || !client.includes('adminHeaders()') || !client.includes('Authorization: `Bearer ${token}`')) {
  fail('client syncNow must call /api/sync-now with admin headers');
}
if (!routes.includes("router.post('/sync-now'") || !routes.includes('ADMIN_AUTH_REQUIRED') || !routes.includes('管理員登入已失效，請重新登入後再同步')) {
  fail('/api/sync-now must reject missing admin token with ADMIN_AUTH_REQUIRED');
}
if ((drawCard + dashboard + client + routes).includes('Math.random')) fail('sync path contains random fallback logic');

console.log('[PASS] sync button is admin-only and /api/sync-now rejects unauthenticated calls');
