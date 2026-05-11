#!/usr/bin/env node
'use strict';

const http = require('http');

const BASE = `http://localhost:${process.env.PORT || 3001}`;
const PASSWORD = process.env.VERIFY_ADMIN_PASSWORD || 'VerifyAdmin123!';
const good = {
  officialApiUrl: 'https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Daily539Result',
  officialApiCandidates: ['https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Daily539Result'],
  officialHtmlUrl: 'https://www.taiwanlottery.com/lotto/result/daily_cash',
  syncIntervalMinutes: 30,
  recoveryRetryMinutes: 5,
};

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request(`${BASE}${path}`, {
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...headers,
      },
      timeout: 10000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch {}
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

async function ensureAdminToken() {
  const status = await req('GET', '/api/admin/status');
  if (status.json?.setup_required) {
    await req('POST', '/api/admin/setup', { password: PASSWORD });
  }
  const login = await req('POST', '/api/admin/login', { password: PASSWORD });
  if (login.status !== 200 || !login.json?.token) {
    throw new Error(`admin login required for sync flow; status=${login.status}`);
  }
  return login.json.token;
}

(async () => {
  const token = await ensureAdminToken();
  const adminHeaders = { 'X-Admin-Token': token };
  try {
    await req('POST', '/api/config', {
      officialApiUrl: 'https://127.0.0.1:1/bad',
      officialApiCandidates: ['https://127.0.0.1:1/bad2'],
      officialHtmlUrl: 'https://127.0.0.1:1/html',
      syncIntervalMinutes: 30,
      recoveryRetryMinutes: 5,
    }, adminHeaders);
    const sync = await req('POST', '/api/sync-now', null, adminHeaders);
    const status = await req('GET', '/api/data/status');
    const prediction = await req('GET', '/api/prediction/today');

    const syncStatus = sync.json?.data?.status ?? sync.json?.status;
    if (syncStatus !== 'PENDING_OFFICIAL') throw new Error(`expected PENDING_OFFICIAL sync, got ${syncStatus} (http ${sync.status})`);
    const statusData = status.json?.data;
    if (!statusData) throw new Error('status response missing data');
    if (!statusData.retry_active && !statusData.recovery_mode) throw new Error('expected retry or recovery to become active');
    if (statusData.status !== 'PENDING_OFFICIAL') throw new Error(`expected status PENDING_OFFICIAL, got ${statusData.status}`);
    if (prediction.json?.success || prediction.json?.data) throw new Error('prediction should not be returned during PENDING_OFFICIAL');
    console.log('[PASS] API failure triggers retry/PENDING_OFFICIAL and prediction is blocked');
  } finally {
    await req('POST', '/api/config', good, adminHeaders).catch(() => {});
    await req('POST', '/api/sync-now', null, adminHeaders).catch(() => {});
    await req('POST', '/api/admin/logout', null, adminHeaders).catch(() => {});
  }
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
