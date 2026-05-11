#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(ROOT, 'backend/src/engine/AdvancedStatsModel.ts'), 'utf8');

function listFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(entry => {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (/^(node_modules|\.git|backend\/dist|frontend\/dist|dist)$/.test(rel)) return [];
      return listFiles(full);
    }
    return [full];
  });
}

const legacyFieldName = 'anti' + 'hot_adjusted_score';
for (const file of listFiles(ROOT)) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes(legacyFieldName)) {
    throw new Error(`legacy anti-hot field name found in ${path.relative(ROOT, file)}`);
  }
}

for (const token of [
  'ANTIHOT_ENABLED',
  'ANTIHOT_WINDOW',
  'ANTIHOT_MIN_FACTOR',
  'evaluateAntiHot',
  'recent_hit_count',
  'antihot_factor',
  'anti_hot_adjusted_score',
  'antihot_reason',
  'raw_total_score: antiHot.adjusted_score',
  "enabled: process.env['ANTIHOT_ENABLED'] !== 'false'",
  'Math.max(baseFactor, config.minFactor)',
]) {
  if (!source.includes(token)) throw new Error(`anti-hot implementation missing ${token}`);
}
if (/filter\([^)]*antihot|splice\([^)]*antihot|delete\s+.*antihot/i.test(source)) {
  throw new Error('anti-hot must not delete numbers');
}

const distPath = path.join(ROOT, 'backend/dist/engine/AdvancedStatsModel.js');
const dbPath = process.env.DB_PATH || path.join(ROOT, 'backend/data/539.db');
if (fs.existsSync(distPath) && fs.existsSync(dbPath)) {
  const sqliteModule = path.join(ROOT, 'backend/node_modules/better-sqlite3');
  if (!fs.existsSync(sqliteModule)) {
    console.warn('[SKIP] runtime anti-hot check skipped because backend better-sqlite3 is unavailable');
    console.log('[PASS] conservative anti-hot layer is configurable, bounded, and non-destructive');
    process.exit(0);
  }
  const Database = require(sqliteModule);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const rows = db.prepare('SELECT draw_no, draw_date, numbers_json FROM draws ORDER BY draw_date DESC, draw_no DESC LIMIT 120').all();
  db.close();
  if (rows.length >= 100) {
    const draws = rows.map(row => ({
      draw_no: String(row.draw_no),
      draw_date: String(row.draw_date),
      numbers: JSON.parse(row.numbers_json),
    }));
    const model = require(distPath);
    const oldEnabled = process.env.ANTIHOT_ENABLED;
    const oldMin = process.env.ANTIHOT_MIN_FACTOR;
    process.env.ANTIHOT_ENABLED = 'true';
    process.env.ANTIHOT_MIN_FACTOR = '0.60';
    const enabled = model.buildScoredPredictionModel(draws, {
      includeOverheat: true,
      advancedStatsEnabled: false,
      useThreeStarCore: true,
      recentBacktests: [],
      previousPrediction: null,
    }).number_scores;
    if (enabled.length !== 39) throw new Error(`anti-hot removed numbers; expected 39 rows, got ${enabled.length}`);
    for (const row of enabled) {
      if (typeof row.recent_hit_count !== 'number') throw new Error('recent_hit_count missing');
      if (row.antihot_factor < 0.60 || row.antihot_factor > 1) throw new Error(`bad antihot_factor for ${row.number}`);
      if (row.anti_hot_adjusted_score > row.original_score + 0.01) throw new Error(`anti-hot increased score for ${row.number}`);
      if (!row.antihot_reason) throw new Error(`antihot_reason missing for ${row.number}`);
    }
    process.env.ANTIHOT_ENABLED = 'false';
    const disabled = model.buildScoredPredictionModel(draws, {
      includeOverheat: true,
      advancedStatsEnabled: false,
      useThreeStarCore: true,
      recentBacktests: [],
      previousPrediction: null,
    }).number_scores;
    for (const row of disabled) {
      if (row.antihot_factor !== 1) throw new Error(`disabled anti-hot factor must be 1 for ${row.number}`);
      // Top-Score Compression Layer (v4) sits between final_score and anti-hot.
      // When anti-hot is disabled (factor=1), anti_hot_adjusted_score must equal
      // the post-compression score. Below the 75% compression threshold the
      // compressed_score equals original_score so the legacy invariant still
      // holds for non-top numbers.
      const reference = typeof row.compressed_score === 'number' ? row.compressed_score : row.original_score;
      if (Math.abs(row.anti_hot_adjusted_score - reference) > 0.01) {
        throw new Error(`disabled anti-hot changed score for ${row.number}`);
      }
    }
    if (oldEnabled === undefined) delete process.env.ANTIHOT_ENABLED;
    else process.env.ANTIHOT_ENABLED = oldEnabled;
    if (oldMin === undefined) delete process.env.ANTIHOT_MIN_FACTOR;
    else process.env.ANTIHOT_MIN_FACTOR = oldMin;
  }
} else {
  console.warn('[SKIP] runtime anti-hot check skipped because backend dist or SQLite DB is unavailable');
}

console.log('[PASS] conservative anti-hot layer is configurable, bounded, and non-destructive');
