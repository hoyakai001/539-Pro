#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '../../backend/src/db/adapters/FirestoreAdapter.ts'), 'utf8');
const client = fs.readFileSync(path.resolve(__dirname, '../../backend/src/db/adapters/firestoreClient.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../backend/package.json'), 'utf8'));

for (const token of ['draws', 'predictions', 'observation_logs', 'admin']) {
  if (!source.includes(`'${token}'`)) throw new Error(`Firestore collection missing: ${token}`);
}
for (const env of ['APP_MODE', 'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']) {
  if (!client.includes(env)) throw new Error(`Firestore env guard missing: ${env}`);
}
if (!pkg.dependencies['firebase-admin']) throw new Error('firebase-admin dependency missing');

if (process.env.APP_MODE === 'cloud') {
  for (const env of ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']) {
    if (!process.env[env]) throw new Error(`${env} is required in APP_MODE=cloud`);
  }
}

console.log('[PASS] Firestore adapter and cloud env guards are present');
