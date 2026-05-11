#!/usr/bin/env node
/**
 * verify:html-fetch — 測試 HTML 抓取，不寫 DB
 *
 * 退出碼：
 *   0 = 成功連線且頁面含 539 相關內容（或成功解析出開獎資料）
 *   1 = 連線失敗（網路/DNS/timeout）
 *   2 = 連線成功但頁面無 539 內容（SPA，需設 API URL）
 */
'use strict';
const https = require('https');
const http  = require('http');
const url   = require('url');

const OFFICIAL_URL = 'https://www.taiwanlottery.com/lotto/result/4_d/';
const TIMEOUT_MS   = 15000;

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9',
  'Cache-Control':   'no-cache',
  'Pragma':          'no-cache',
  'Referer':         'https://www.taiwanlottery.com/',
};

function get(targetUrl) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(targetUrl);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const req    = lib.get({ ...parsed, headers: HEADERS, timeout: TIMEOUT_MS }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => { req.destroy(); reject(Object.assign(new Error('TIMEOUT'), { code: 'ECONNABORTED' })); });
    req.on('error', reject);
  });
}

(async () => {
  console.log(`[verify:html-fetch] 連線 ${OFFICIAL_URL}`);
  console.log(`[verify:html-fetch] Timeout: ${TIMEOUT_MS}ms`);

  try {
    const { status, body } = await get(OFFICIAL_URL);
    console.log(`[verify:html-fetch] HTTP ${status}, 長度: ${body.length} 字元`);

    if (status !== 200) {
      console.error(`[FAIL] 非預期 HTTP 狀態碼：${status}`);
      process.exit(1);
    }

    const has539       = body.includes('539') || body.includes('今彩');
    const hasNextData  = body.includes('__NEXT_DATA__');
    const hasBallClass = /class="[^"]*ball[^"]*"/.test(body);
    const hasLotteryKw = body.includes('lotto') || body.includes('開獎') || body.includes('彩券');

    console.log(`[verify:html-fetch] 含 "539": ${has539}`);
    console.log(`[verify:html-fetch] 含 __NEXT_DATA__: ${hasNextData}`);
    console.log(`[verify:html-fetch] 含 ball class: ${hasBallClass}`);
    console.log(`[verify:html-fetch] 含 lottery kw: ${hasLotteryKw}`);

    if (!has539 && !hasLotteryKw) {
      console.warn('[WARN] 頁面不含 539/彩券關鍵字，可能為空白 SPA 或被封鎖');
      console.warn('[WARN] → 系統會回傳 PENDING_OFFICIAL，不會插入假資料');
      console.warn('[INFO] 解決：設定 TW_LOTTERY_API_LATEST 為真實 API URL');
      console.log('\n[HTML 前 500 字]');
      console.log(body.slice(0, 500).replace(/\s+/g, ' '));
      process.exit(2);
    }

    if (hasNextData) {
      // 嘗試解析 __NEXT_DATA__
      const match = body.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
      if (match) {
        try {
          const data = JSON.parse(match[1]);
          const str  = JSON.stringify(data);
          const numMatch = str.match(/\d{8,12}/);
          if (numMatch) {
            console.log(`[verify:html-fetch] __NEXT_DATA__ 含期號候選：${numMatch[0]}`);
          }
        } catch { /* ignore */ }
      }
    }

    console.log('\n[PASS] 官方頁面連線成功且含彩券相關內容');
    process.exit(0);

  } catch (e) {
    const code = e.code || 'UNKNOWN';
    console.error(`[FAIL] 連線失敗：${e.message}`);
    if (code === 'ECONNABORTED') console.error('[FAIL] → 連線逾時，請檢查網路/防火牆');
    else if (code === 'ETIMEDOUT')   console.error('[FAIL] → TCP 逾時');
    else if (code === 'ENOTFOUND')   console.error('[FAIL] → DNS 解析失敗，請檢查網路連線');
    console.error('[INFO] → 系統已能處理此情況：回傳 PENDING_OFFICIAL，不出牌');
    process.exit(1);
  }
})();
