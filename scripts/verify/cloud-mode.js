#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const adapterIndex = fs.readFileSync(path.join(ROOT, 'backend/src/db/adapters/index.ts'), 'utf8');
const firestore = fs.readFileSync(path.join(ROOT, 'backend/src/db/adapters/FirestoreAdapter.ts'), 'utf8');
const firestoreClient = fs.readFileSync(path.join(ROOT, 'backend/src/db/adapters/firestoreClient.ts'), 'utf8');
const routes = fs.readFileSync(path.join(ROOT, 'backend/src/api/routes.ts'), 'utf8');
const dashboard = fs.readFileSync(path.join(ROOT, 'frontend/src/components/Dashboard.tsx'), 'utf8');
const drawCard = fs.readFileSync(path.join(ROOT, 'frontend/src/components/DrawStatusCard.tsx'), 'utf8');

if (!adapterIndex.includes('new FirestoreAdapter()') || !adapterIndex.includes("require('./SQLiteAdapter')")) {
  throw new Error('cloud mode adapter switch is missing');
}
if (adapterIndex.includes("import { SQLiteAdapter }")) {
  throw new Error('cloud mode must not statically import SQLiteAdapter');
}
for (const token of ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'normalizePrivateKey']) {
  if (!firestoreClient.includes(token)) throw new Error(`Firestore client missing ${token}`);
}
for (const token of ['draws', 'predictions', 'observation_logs', 'stats_cache']) {
  if (!firestore.includes(`collection('${token}')`)) throw new Error(`FirestoreAdapter missing ${token} collection`);
}
if (firestore.includes('DB_PATH') || firestore.includes('better-sqlite3')) {
  throw new Error('cloud Firestore adapter must not use DB_PATH or SQLite');
}
for (const token of ['cloudPredictionToday', 'cloudNumberAnalysis', 'cloudHistoryDraws', 'cloudPerformance', 'cloudAdminSync']) {
  if (!routes.includes(token)) throw new Error(`cloud route missing ${token}`);
}
if (!routes.includes("res.status(401).json({ success: false, error: 'admin token required' })")) {
  throw new Error('cloud sync-now must require admin token');
}
if (!dashboard.includes('showSync={admin}') || !drawCard.includes('showSync = false')) {
  throw new Error('Dashboard sync button must be admin-only in user UI');
}

console.log('[PASS] APP_MODE=cloud uses Firestore, admin-gated sync, and no SQLite DB path');
