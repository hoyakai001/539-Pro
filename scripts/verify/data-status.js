#!/usr/bin/env node
/**
 * verify:data-status — 呼叫 /api/data/status，輸出完整狀態報告
 *
 * 退出碼：
 *   0 = API 回應正常（即使 cannot_predict，也是正常保護）
 *   1 = API 無法連線（後端未啟動）
 */
'use strict';
const http = require('http');

const PORT = process.env.PORT || 3001;

function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}${path}`, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('JSON parse error')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

(async () => {
  try {
    const res = await request('/api/data/status');
    if (!res.success) {
      console.error(`[FAIL] API 回傳 success=false：${res.error}`);
      process.exit(1);
    }

    const d = res.data;
    console.log('\n=== /api/data/status ===');
    console.log(`mode:                  ${d.mode}`);
    console.log(`database_path:         ${d.database_path}`);
    console.log(`config_path:           ${d.config_path}`);
    console.log(`official_html_url:     ${d.official_html_url}`);
    console.log(`official_api_configured: ${d.official_api_configured}`);
    console.log(`status:                ${d.status}`);
    console.log(`reason:                ${d.reason}`);
    console.log(`can_predict:           ${d.can_predict}`);
    console.log(`cannot_predict_reason: ${d.cannot_predict_reason}`);
    console.log(`min_data_mode:         ${d.min_data_mode}`);
    console.log(`latest_draw_no:        ${d.latest_draw_no}`);
    console.log(`latest_draw_date:      ${d.latest_draw_date}`);
    console.log(`draw_count:            ${d.draw_count}`);
    console.log(`minimum_data_met:      ${d.minimum_data_met}`);
    console.log(`data_continuous:       ${d.data_continuous}`);
    console.log(`missing_periods_count: ${d.missing_periods_count}`);
    console.log(`history_incomplete:    ${d.history_incomplete}`);
    console.log(`last_sync_time:        ${d.last_sync_time}`);
    console.log(`last_sync_status:      ${d.last_sync_status}`);

    console.log('\n=== 今日狀態 ===');
    const td = d.todayDraw;
    console.log(`today:    ${td.todayDate}`);
    console.log(`isDrawn:  ${td.isDrawn}`);
    if (td.isDrawn) {
      console.log(`draw_no:  ${td.todayDrawNo}`);
      console.log(`numbers:  ${td.todayNumbers}`);
    }

    console.log('\n[PASS] /api/data/status 回應正常');
    if (!d.can_predict) {
      console.log(`[INFO] 目前不可預測（正常保護機制）：${d.cannot_predict_reason}`);
    }
    process.exit(0);

  } catch (e) {
    console.error(`[FAIL] 無法連線 localhost:${PORT}/api/data/status`);
    console.error(`錯誤：${e.message}`);
    console.error('請先啟動後端：cd backend && npm run dev');
    process.exit(1);
  }
})();
