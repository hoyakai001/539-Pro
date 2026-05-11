#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

const rootPkg = readJson('package.json');
const backendPkg = readJson('backend/package.json');
const frontendPkg = readJson('frontend/package.json');
const vercel = readJson('vercel.json');

const scripts = rootPkg.scripts || {};
if (scripts['install:all'] !== 'cd backend && npm install && cd ../frontend && npm install') {
  throw new Error('root install:all must install backend and frontend dependencies');
}
if (scripts['build:local'] !== 'cd backend && npm run build && cd ../frontend && npm run build') {
  throw new Error('root build:local must build backend and frontend without installing root tooling');
}
if (scripts['build'] !== 'npm run vercel-build') {
  throw new Error('root build must delegate to vercel-build without recursion');
}
if (scripts['vercel-build'] !== 'node scripts/vercel-build.js') {
  throw new Error('root vercel-build must use the guarded Vercel build script');
}
if ((scripts['vercel-build'] || '').includes('npm run vercel-build')) {
  throw new Error('vercel-build must not call itself');
}

if (!backendPkg.devDependencies || !backendPkg.devDependencies.typescript) {
  throw new Error('backend devDependencies.typescript is required so backend npm run build can find tsc');
}
if (backendPkg.dependencies?.['better-sqlite3']) {
  throw new Error('better-sqlite3 must not be a required backend dependency');
}
if (!backendPkg.optionalDependencies?.['better-sqlite3']) {
  throw new Error('better-sqlite3 must remain available as an optional local SQLite dependency');
}
if (backendPkg.scripts?.build !== 'tsc') {
  throw new Error('backend build must run tsc');
}
if (!frontendPkg.devDependencies || !frontendPkg.devDependencies.vite) {
  throw new Error('frontend devDependencies.vite is required so frontend npm run build can find vite');
}
if (frontendPkg.scripts?.build !== 'vite build') {
  throw new Error('frontend build must run vite build');
}

const cronSchedules = (vercel.crons || []).map(item => item.schedule);
if (cronSchedules.includes('0 */5 * * *')) {
  throw new Error('vercel cron must not run every 5 hours');
}
// cron schedule "0 14 * * *" → UTC 14:00 → Taipei 22:00 daily.
if (cronSchedules.length !== 1 || cronSchedules[0] !== '0 14 * * *') {
  throw new Error('vercel cron must contain exactly one daily entry at 0 14 * * * (Taipei 22:00)');
}
if (Object.prototype.hasOwnProperty.call(vercel, 'experimentalServices')) {
  throw new Error('vercel.json must not use experimentalServices; deploy as a single project with preset Other');
}
const rewrites = JSON.stringify(vercel.rewrites || []);
if (!rewrites.includes('/api/(.*)') || !rewrites.includes('/api/index')) {
  throw new Error('vercel /api rewrite must be preserved');
}
const functions = JSON.stringify(vercel.functions || {});
if (!functions.includes('api/index.js') || !functions.includes('docs/**')) {
  throw new Error('vercel docs includeFiles must be preserved for docs API routes');
}

const vercelBuildSource = fs.readFileSync(path.join(ROOT, 'scripts/vercel-build.js'), 'utf8');
for (const token of [
  'process.env.VERCEL',
  '--ignore-scripts',
  "rebuild', 'better-sqlite3",
  "run(backend, 'npm', ['run', 'build'])",
  "run(frontend, 'npm', ['run', 'build'])",
]) {
  if (!vercelBuildSource.includes(token)) throw new Error(`vercel build helper missing ${token}`);
}

const databaseSource = fs.readFileSync(path.join(ROOT, 'backend/src/db/database.ts'), 'utf8');
const adapterIndexSource = fs.readFileSync(path.join(ROOT, 'backend/src/db/adapters/index.ts'), 'utf8');
if (/import\s+.*better-sqlite3/.test(databaseSource)) {
  throw new Error('database.ts must not statically import better-sqlite3');
}
if (!databaseSource.includes("require('better-sqlite3')")) {
  throw new Error('database.ts must lazy-load better-sqlite3 for local mode');
}
if (adapterIndexSource.includes("import { SQLiteAdapter }")) {
  throw new Error('adapter index must not statically import SQLiteAdapter in cloud mode');
}
if (!adapterIndexSource.includes("require('./SQLiteAdapter')")) {
  throw new Error('SQLiteAdapter must be lazy-loaded only for local mode');
}

console.log('[PASS] Vercel build scripts install backend/frontend dev dependencies and single-project config is safe');
