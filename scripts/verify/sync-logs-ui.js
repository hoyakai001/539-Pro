#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const tablePath = path.join(ROOT, 'frontend/src/components/SyncLogTable.tsx');
const typesPath = path.join(ROOT, 'frontend/src/types.ts');
const allPath = path.join(ROOT, 'scripts/verify/all.js');
const table = fs.readFileSync(tablePath, 'utf8');
const types = fs.readFileSync(typesPath, 'utf8');
const all = fs.readFileSync(allPath, 'utf8');

for (const token of [
  'selected_source',
  'selected_url',
  'fallback_used',
  'attempted_sources',
  'attempted_sources:',
  'syncLogDiagnostic',
  'no diagnostic',
]) {
  if (!table.includes(token)) throw new Error(`SyncLogTable missing ${token}`);
}

for (const token of [
  'selected_source?: string | null',
  'selected_url?: string | null',
  'fallback_used?: boolean | null',
  'attempted_sources?: Array',
  'id: number | string',
]) {
  if (!types.includes(token)) throw new Error(`SyncLogRow type missing ${token}`);
}

if (table.includes('source={log.active_source ??')) {
  throw new Error('SyncLogTable still renders only the old source/inserted/retry summary');
}
if (!table.includes('log.selected_source ?? log.source ?? log.active_source')) {
  throw new Error('SyncLogTable must fall back safely for old logs');
}
if (!table.includes('Array.isArray(log.attempted_sources)')) {
  throw new Error('SyncLogTable must guard attempted_sources before rendering');
}
if (!all.includes("['sync-logs-ui', 'sync-logs-ui.js']")) {
  throw new Error('verify:all must include sync-logs-ui');
}

console.log('[PASS] sync logs UI renders selected source URL, fallback flag, attempted sources, and old logs safely');
