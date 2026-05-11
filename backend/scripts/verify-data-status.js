#!/usr/bin/env node
/**
 * verify:data-status — 呼叫本地 API，印出完整資料狀態報告
 * 需要後端在 PORT 3001 執行
 */
const http = require('http');

const PORT = process.env.PORT || 3001;

function request(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}${path}`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('JSON parse error')); }
      });
    }).on('error', reject);
  });
}

(async () => {
  try {
    const res = await request('/api/data/status');
    const d = res.data;

    console.log('\n=== 資料狀態報告 ===');
    console.log(`狀態：${d.dataStatus.status}`);
    console.log(`說明：${d.dataStatus.reason}`);
    console.log(`資料庫期數：${d.draw_count}`);
    console.log(`最少資料門檻達到：${d.minimum_data_met}`);
    console.log(`最少資料模式：${d.dataStatus.minDataMode}`);
    console.log(`最新期號：${d.dataStatus.latestDrawNo}`);
    console.log(`最新期日期：${d.dataStatus.latestDrawDate}`);
    console.log(`可預測：${d.dataStatus.canPredict}`);
    console.log(`上次同步：${d.dataStatus.lastSyncTime || '（無記錄）'}`);
    console.log(`官方 HTML URL：${d.official_html_url}`);
    console.log(`官方 API 已設定：${d.official_api_configured}`);

    if (d.dataStatus.missingPeriods.length > 0) {
      console.log(`可疑缺漏期數：${d.dataStatus.missingPeriods.length}`);
    }

    console.log('\n=== 今日狀態 ===');
    console.log(`今日日期：${d.todayDraw.todayDate}`);
    console.log(`今日已開獎：${d.todayDraw.isDrawn}`);
    if (d.todayDraw.isDrawn) {
      console.log(`今日期號：${d.todayDraw.todayDrawNo}`);
      console.log(`今日號碼：${d.todayDraw.todayNumbers}`);
    }

    console.log('\n[PASS] data/status API 回應正常');
  } catch (e) {
    console.error(`[FAIL] 無法連線至 localhost:${PORT}/api/data/status`);
    console.error(`錯誤：${e.message}`);
    console.error('請先啟動後端：cd backend && npm run dev');
    process.exit(1);
  }
})();
