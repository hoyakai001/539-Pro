#!/usr/bin/env node
'use strict';
/**
 * Walk-forward worker that maintains a sliding window of prior predictions and
 * feeds them as `previousPrediction.recent_observations` to the next call.
 *
 * Without this, single rotation / pair/triple structure fatigue / freshness
 * never activate (they require ≥3 prior observations). This worker simulates
 * production-like history so the backtest can measure rotation effects.
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

// Walk forward chronologically (oldest → newest within the window). For each
// target draw, build a prediction using the prior 100 draws as training PLUS
// a sliding history of up to 10 recent predictions (acts as recent_observations).
const startIndex = window - 1;
const observationHistory = []; // newest first

const records = [];
for (let i = startIndex; i >= 0; i--) {
  const target = allDraws[i];
  const training = allDraws.slice(i + 1, i + 1 + 100);
  if (training.length < 100) continue;

  const previousPrediction = observationHistory.length
    ? {
      prediction_id: observationHistory.length,
      target_date: observationHistory[0].target_date,
      target_draw_no: observationHistory[0].target_draw_no,
      two_star: observationHistory[0].selected_two_star,
      three_star: observationHistory[0].selected_three_star,
      four_star: observationHistory[0].selected_four_star,
      five_star: observationHistory[0].selected_five_star,
      actual_numbers: null,
      recent_observations: observationHistory.slice(0, 10),
    }
    : null;

  let prediction;
  try {
    prediction = buildScoredPredictionModel(training, {
      includeOverheat: true,
      advancedStatsEnabled: false,
      useThreeStarCore: false,
      recentBacktests: [],
      previousPrediction,
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

  // Push to observationHistory (newest first) for the next iteration.
  observationHistory.unshift({
    target_draw_no: target.draw_no,
    target_date: target.draw_date,
    selected_single: prediction.single_number,
    selected_two_star: prediction.two_star,
    selected_three_star: prediction.three_star,
    selected_four_star: prediction.four_star,
    selected_five_star: prediction.five_star,
  });
  if (observationHistory.length > 12) observationHistory.length = 12;
}

process.stdout.write(JSON.stringify({ mode: process.env.COMPARE_MODE, window, records }));
