#!/usr/bin/env node
'use strict';
const http = require('http');
const PORT = process.env.PORT || 3001;
const RESET = process.env.ADMIN_RESET_TOKEN;
const PASSWORD = process.env.VERIFY_ADMIN_PASSWORD || 'VerifyAdmin123!';

function request(path, method = 'GET', body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(`http://localhost:${PORT}${path}`, {
      method,
      timeout: 8000,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch {}
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  if (!RESET) {
    const res = await request('/api/admin/reset', 'POST', { reset_token: 'wrong', new_password: PASSWORD });
    if (![401, 503].includes(res.status)) throw new Error('admin reset must be protected when token is absent');
    console.log('[PASS] admin reset endpoint is protected; set ADMIN_RESET_TOKEN to exercise successful reset');
    return;
  }
  const bad = await request('/api/admin/reset', 'POST', { reset_token: `${RESET}-bad`, new_password: PASSWORD });
  if (bad.status !== 401) throw new Error('wrong reset token must return 401');
  const reset = await request('/api/admin/reset', 'POST', { reset_token: RESET, new_password: PASSWORD });
  if (reset.status !== 200 || !reset.json?.success) throw new Error(`admin reset failed: ${reset.status}`);
  const login = await request('/api/admin/login', 'POST', { password: PASSWORD });
  if (login.status !== 200 || !login.json?.token) throw new Error('login after reset failed');
  console.log('[PASS] admin reset token resets password and login succeeds');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
