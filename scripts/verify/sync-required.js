#!/usr/bin/env node
/**
 * verify:sync-required — 確認無資料時 /api/prediction/today 不出牌
 *
 * 測試邏輯：
 *   1. 呼叫 /api/prediction/today
 *   2. 若 success=true 且 data 不為 null，表示有預測結果
 *   3. 若此時資料庫無資料（draw_count=0），則視為違規（出了假牌）
 *   4. 若 success=false 或 data=null，符合預期（正常不出牌）
 *
 * 退出碼：
 *   0 = 通過（不出牌，或有真實資料才出牌）
 *   1 = 違規（無資料卻出牌）或 API 無回應
 */
'use strict';
const http = require('http');

const PORT = process.env.PORT || 3001;

function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}${path}`, { timeout: 10000 }, (res) => {
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
    // 取得資料狀態
    const statusRes   = await request('/api/data/status');
    const drawCount   = statusRes.data?.draw_count ?? 0;
    const canPredict  = statusRes.data?.can_predict ?? false;

    console.log(`[sync-required] 目前資料庫期數: ${drawCount}`);
    console.log(`[sync-required] can_predict: ${canPredict}`);

    // 呼叫今日預測
    const predRes = await request('/api/prediction/today');

    console.log(`[sync-required] prediction success: ${predRes.success}`);
    console.log(`[sync-required] prediction data: ${predRes.data ? '有資料' : 'null'}`);
    if (!predRes.success) {
      console.log(`[sync-required] reason: ${predRes.reason || predRes.error}`);
    }

    if (drawCount === 0 && predRes.success && predRes.data !== null) {
      console.error('[FAIL] 資料庫無資料但系統仍回傳預測！這是嚴重的假資料問題。');
      process.exit(1);
    }

    if (!canPredict && predRes.success && predRes.data !== null) {
      console.error('[FAIL] can_predict=false 但系統仍回傳預測！保護機制失效。');
      process.exit(1);
    }

    if (!predRes.success || predRes.data === null) {
      console.log('[PASS] 無有效資料時，系統正確拒絕出牌');
      console.log(`[INFO] 原因：${predRes.reason || predRes.error || '無資料/不可預測'}`);
    } else {
      console.log(`[PASS] 有真實資料（${drawCount} 期），系統正常出牌`);
    }

    process.exit(0);

  } catch (e) {
    console.error(`[FAIL] 無法連線 localhost:${PORT}`);
    console.error(`錯誤：${e.message}`);
    console.error('請先啟動後端：cd backend && npm run dev');
    process.exit(1);
  }
})();
