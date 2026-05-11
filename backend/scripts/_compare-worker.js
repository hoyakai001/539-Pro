#!/usr/bin/env node
'use strict';
/**
 * Walk-forward worker. Parent sets COMPARE_MODE and POOL_DIVERSIFICATION_DISABLED
 * env before spawn so the engine module loads with the requested mode.
 */
const path = require('path');
const Database = require('better-sqlite3');
const { buildScoredPredictionModel } = require(path.resolve(__dirname, '..', 'dist', 'engine', 'AdvancedStatsModel.js'));

const window = parseInt(process.env.COMPARE_WINDOW || '30', 10);
const dbPath = path.resolve(__dirname, '..', 'data', '539.db');
const db = new Database(dbPath, { readonly: true });
const rows = db.prepare("SELECT draw_no, draw_date, numbers_json FROM draws ORDER BY draw_date DESC, draw_no DESC").all();
db.close();

if (rows.length < 200) {
  console.error('not enough draws to backtest');
  process.exit(2);
}

const allDraws = rows.map(r => ({
  draw_no: r.draw_no,
  draw_date: r.draw_date,
  numbers: JSON.parse(r.numbers_json),
}));

const records = [];
for (let i = 0; i < window; i++) {
  const target = allDraws[i];
  const training = allDraws.slice(i + 1, i + 1 + 100);
  if (training.length < 100) break;
  let prediction;
  try {
    prediction = buildScoredPredictionModel(training, {
      includeOverheat: true,
      advancedStatsEnabled: false,
      useThreeStarCore: false,
      recentBacktests: [],
      previousPrediction: null,
    });
  } catch (e) {
    continue;
  }
  records.push({
    target_draw_no: target.draw_no,
    target_date: target.draw_date,
    actual: target.numbers.slice().sort((a, b) => a - b),
    single_number: prediction.single_number,
    two_star: prediction.two_star,
    three_star: prediction.three_star,
    four_star: prediction.four_star,
    five_star: prediction.five_star,
  });
}

process.stdout.write(JSON.stringify({ mode: process.env.COMPARE_MODE, window, records }));
