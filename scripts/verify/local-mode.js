#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const adapterIndex = fs.readFileSync(path.join(ROOT, 'backend/src/db/adapters/index.ts'), 'utf8');
const sqlite = fs.readFileSync(path.join(ROOT, 'backend/src/db/adapters/SQLiteAdapter.ts'), 'utf8');
const firestoreClient = fs.readFileSync(path.join(ROOT, 'backend/src/db/adapters/firestoreClient.ts'), 'utf8');

if (!firestoreClient.includes("process.env['APP_MODE'] === 'cloud'")) {
  throw new Error('APP_MODE=cloud must be the only cloud-mode switch');
}
if (!adapterIndex.includes("require('./SQLiteAdapter')") || !adapterIndex.includes('new SQLiteAdapter()')) {
  throw new Error('local mode must lazy-load and use SQLiteAdapter');
}
for (const token of ['getDB', 'getDraws', 'getLatestDraw', 'upsertDraw']) {
  if (!sqlite.includes(token)) throw new Error(`SQLiteAdapter missing ${token}`);
}
if (sqlite.includes('firebase') || sqlite.includes('Firestore')) {
  throw new Error('SQLiteAdapter must not depend on Firestore');
}

console.log('[PASS] APP_MODE=local keeps the existing SQLite adapter path');
