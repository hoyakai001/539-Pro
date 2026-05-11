#!/usr/bin/env node
'use strict';
const http = require('http');
const PORT = process.env.PORT || 3001;
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
  const locked = await request('/api/sync-logs');
  if (locked.status !== 401) throw new Error(`debug API should be 401 before login, got ${locked.status}`);

  const status = await request('/api/admin/status');
  if (!status.json?.success) throw new Error('admin status failed');
  if (status.json.setup_required) {
    const setup = await request('/api/admin/setup', 'POST', { password: PASSWORD });
    if (setup.status >= 400) throw new Error(`admin setup failed: ${setup.status}`);
  }

  const login = await request('/api/admin/login', 'POST', { password: PASSWORD });
  if (login.status !== 200 || !login.json?.token) throw new Error(`admin login failed: ${login.status}`);
  const token = login.json.token;
  const logs = await request('/api/sync-logs', 'GET', undefined, { 'X-Admin-Token': token });
  if (logs.status !== 200) throw new Error(`debug API did not accept admin token: ${logs.status}`);
  const logout = await request('/api/admin/logout', 'POST', undefined, { 'X-Admin-Token': token });
  if (logout.status !== 200) throw new Error('admin logout failed');
  const lockedAgain = await request('/api/sync-logs', 'GET', undefined, { 'X-Admin-Token': token });
  if (lockedAgain.status !== 401) throw new Error('debug API token still valid after logout');
  console.log('[PASS] admin setup/login/logout and debug API lock are working');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
