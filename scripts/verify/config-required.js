#!/usr/bin/env node
/**
 * verify:config-required — 確認官方 URL 未設定時系統有清楚說明
 *
 * 測試邏輯：
 *   1. 讀取 /api/config，確認 tw_lottery_api_latest 是否設定
 *   2. 讀取 /api/data/status，確認 official_api_configured 欄位
 *   3. 若未設定 API URL，確認系統會顯示 official_html_url（有 fallback 說明）
 *   4. 確認無論如何，PENDING_OFFICIAL 不會出牌
 *
 * 退出碼：
 *   0 = 通過
 *   1 = API 無回應或設定欄位缺失
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
    const cfgRes    = await request('/api/config');
    const statusRes = await request('/api/data/status');

    if (!cfgRes.success || !statusRes.success) {
      console.error('[FAIL] API 回傳失敗');
      process.exit(1);
    }

    const apiUrl      = cfgRes.data?.tw_lottery_api_latest || '';
    const apiConf     = statusRes.data?.official_api_configured;
    const htmlUrl     = statusRes.data?.official_html_url;
    const canPredict  = statusRes.data?.can_predict;
    const status      = statusRes.data?.status;

    console.log('[config-required] tw_lottery_api_latest:', apiUrl || '（未設定）');
    console.log('[config-required] official_api_configured:', apiConf);
    console.log('[config-required] official_html_url:', htmlUrl);
    console.log('[config-required] data status:', status);
    console.log('[config-required] can_predict:', canPredict);

    // 確認 official_html_url 存在（即使 API URL 未設定也有 HTML fallback 說明）
    if (!htmlUrl) {
      console.error('[FAIL] official_html_url 欄位缺失 — 使用者無法知道 HTML 抓取目標');
      process.exit(1);
    }
    console.log('[PASS] official_html_url 存在');

    // PENDING_OFFICIAL 狀態不應出牌
    if (status === 'PENDING_OFFICIAL' && canPredict) {
      console.error('[FAIL] 狀態為 PENDING_OFFICIAL 但 can_predict=true — 保護機制失效');
      process.exit(1);
    }

    // 無論 API URL 是否設定，系統都有 HTML 抓取作為 fallback
    if (!apiUrl) {
      console.log('[INFO] API URL 未設定，系統使用 HTML 抓取模式');
      console.log(`[INFO] 目標：${htmlUrl}`);
    } else {
      console.log('[INFO] API URL 已設定，優先使用 JSON API');
    }

    console.log('\n[PASS] 設定檢查通過');
    process.exit(0);

  } catch (e) {
    console.error(`[FAIL] 無法連線 localhost:${PORT}`);
    console.error(e.message);
    console.error('請先啟動後端：cd backend && npm run dev');
    process.exit(1);
  }
})();
