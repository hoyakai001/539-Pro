#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const adapter = fs.readFileSync(path.join(ROOT, 'backend/src/db/adapters/FirestoreAdapter.ts'), 'utf8');
const routes = fs.readFileSync(path.join(ROOT, 'backend/src/api/routes.ts'), 'utf8');
const cloudSync = fs.readFileSync(path.join(ROOT, 'backend/src/data/cloudSync.ts'), 'utf8');

function requireText(text, token, label) {
  if (!text.includes(token)) throw new Error(`${label} missing ${token}`);
}

requireText(adapter, "collection('stats_cache')", 'FirestoreAdapter cache collection');
requireText(adapter, 'async getCache', 'FirestoreAdapter getCache');
requireText(adapter, 'async setCache', 'FirestoreAdapter setCache');

for (const key of ['latest_draw', 'prediction_today', 'number_analysis_100', 'performance_30', 'data_status']) {
  requireText(routes, `'${key}'`, `cloud cache key ${key}`);
}

requireText(routes, 'latestCache?.latest_draw_no', 'latest-aware cache invalidation');
requireText(routes, 'isPredictionTodayCacheValid', 'prediction cache guard helper');
requireText(routes, "payload['latest_used_draw_no']", 'prediction cache latest_used_draw_no guard');
requireText(routes, "payload['anti_hot_selection_schema'] !== PREDICTION_CACHE_SCHEMA", 'prediction cache schema guard');
requireText(routes, "scores?.['anti_hot_selection_schema'] === PREDICTION_CACHE_SCHEMA", 'prediction cache strategy score schema guard');
requireText(routes, 'period_anchor', 'performance period cache guard');
requireText(routes, 'cached?.latest_draw_no === latestCache.latest_draw_no', 'data/performance/analysis cache guard');
requireText(routes, 'read_estimate', 'read estimate output');
requireText(routes, 'cache_hit: true', 'cache hit output');
requireText(routes, 'draws_read: 0', 'cache-hit draw read estimate');
requireText(cloudSync, "setCache('latest_draw'", 'cloud sync latest cache refresh');

console.log('[PASS] stats_cache is used for latest draw, prediction, number analysis, performance, and status');
