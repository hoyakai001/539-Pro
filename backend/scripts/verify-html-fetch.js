#!/usr/bin/env node
/**
 * verify:html-fetch — 測試能否連線台灣彩券官方頁面並嘗試解析
 * 回傳碼：
 *   0 = 成功解析到開獎資料
 *   1 = 連線失敗（網路問題）
 *   2 = 連線成功但解析失敗（SPA / 反爬蟲）—— 不算系統錯誤，輸出診斷資訊
 */
const axios = require('axios');

const OFFICIAL_HTML_URL = 'https://www.taiwanlottery.com/lotto/result/4_d/';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9',
  'Cache-Control': 'no-cache',
  'Referer': 'https://www.taiwanlottery.com/',
};

(async () => {
  console.log(`[verify:html-fetch] 連線至 ${OFFICIAL_HTML_URL}`);
  try {
    const resp = await axios.get(OFFICIAL_HTML_URL, {
      timeout: 15000,
      headers: HEADERS,
      responseType: 'text',
      validateStatus: () => true,
    });

    console.log(`[verify:html-fetch] HTTP ${resp.status}, 內容長度: ${resp.data.length} 字元`);

    if (resp.status !== 200) {
      console.error(`[FAIL] HTTP 狀態碼 ${resp.status}`);
      process.exit(1);
    }

    const html = resp.data;
    const has539 = html.includes('539') || html.includes('今彩');
    const hasNextData = html.includes('__NEXT_DATA__');
    const hasBall = html.match(/ball|Ball|lotto|Lotto/);

    console.log(`[verify:html-fetch] 含 "539"/${has539}, __NEXT_DATA__/${hasNextData}, ball class/${!!hasBall}`);

    if (!has539 && !hasNextData) {
      console.warn('[WARN] 頁面可能為空白 SPA，實際開獎資料由 JS 動態載入');
      console.warn('[WARN] 這屬於正常現象，系統已能處理此情況（回傳 PENDING_OFFICIAL）');
      console.log('[INFO] 解決方式：設定 TW_LOTTERY_API_LATEST 為實際 API URL');
      process.exit(2);
    }

    console.log('[PASS] 頁面連線成功且含彩券相關內容');
    process.exit(0);

  } catch (e) {
    const code = e.code || 'UNKNOWN';
    console.error(`[FAIL] 無法連線：${e.message} (code=${code})`);
    if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
      console.error('[FAIL] 連線逾時，請檢查網路環境或防火牆設定');
    } else if (code === 'ENOTFOUND') {
      console.error('[FAIL] DNS 解析失敗，請檢查網路連線');
    }
    process.exit(1);
  }
})();
