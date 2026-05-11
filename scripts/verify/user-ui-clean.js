#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../frontend/src');
const dashboard = fs.readFileSync(path.join(root, 'components', 'Dashboard.tsx'), 'utf8');
const hook = fs.readFileSync(path.join(root, 'hooks', 'useDashboard.ts'), 'utf8');
const prediction = fs.readFileSync(path.join(root, 'components', 'PredictionCard.tsx'), 'utf8');

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

const dashboardHome = dashboard.match(/function DashboardHome[\s\S]*?function HistoryPage/)?.[0] ?? '';
if (!dashboardHome) fail('DashboardHome section not found');
if (dashboardHome.includes('SyncLog') || dashboardHome.includes('JSON.stringify') || dashboardHome.includes('api.getSyncLogs')) {
  fail('general dashboard renders debug data');
}
if (hook.includes('api.getSyncLogs')) fail('dashboard hook loads sync logs before admin login');
if (dashboard.includes('回測分析')) fail('general navigation still exposes backtest page');
if (dashboard.includes("setPage('stats'") || dashboard.includes('歷史統計頁')) fail('general navigation still exposes stats page');
if (dashboard.includes('號碼分數頁')) fail('general navigation still exposes standalone score page');
if (!prediction.includes('已鎖定') || !prediction.includes('已快取')) fail('localized lock/cache labels missing');
if (prediction.includes('cache=') || prediction.includes('latest_used_draw_no=') || prediction.includes('prediction_updated_at=')) {
  fail('PredictionCard renders raw cache/debug field names');
}
if (!prediction.includes('資料狀態') || !prediction.includes('更新時間') || !prediction.includes('formatTaipeiDateTime')) {
  fail('PredictionCard must show user-facing data status and Taiwan-time update time');
}
if ((dashboard + hook + prediction).includes('Math.random')) fail('random use found in user UI');

console.log('[PASS] user UI is clean: dashboard/history only for users, debug is admin-only, lock/cache are localized');
