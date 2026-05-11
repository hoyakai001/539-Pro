#!/usr/bin/env node
'use strict';
/**
 * Walk-forward comparison of single_rotation_structure_fatigue_v1 vs v4_restore_1.
 *
 * NEW = current code (single soft rotation + strengthened pair/triple structure fatigue)
 * OLD = v4_restore_1 (always pick rank #1 for single, original pair/triple factors)
 *
 * Both modes feed the same sliding window of prior predictions (so freshness /
 * fatigue / diversity layers all activate). Switches:
 *   - SINGLE_ROTATION_DISABLED=1   → revert single selector to rank #1
 *   - STRUCTURE_FATIGUE_REVERTED=1 → revert pair/triple recommendation factors
 */
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WINDOWS = [30, 50, 100];

function runChild(mode, window) {
  const env = { ...process.env, COMPARE_MODE: mode, COMPARE_WINDOW: String(window) };
  if (mode === 'old') {
    env.SINGLE_ROTATION_DISABLED = '1';
    env.STRUCTURE_FATIGUE_REVERTED = '1';
  } else {
    delete env.SINGLE_ROTATION_DISABLED;
    delete env.STRUCTURE_FATIGUE_REVERTED;
  }
  // Both modes keep pool diversification + top-score compression on.
  delete env.POOL_DIVERSIFICATION_DISABLED;
  delete env.TOP_SCORE_COMPRESSION_DISABLED;
  delete env.PLAN_B_TUNING_ENABLED;
  const buf = execFileSync(process.execPath, [path.join(__dirname, '_compare-walk-forward-worker.js')], {
    cwd: ROOT,
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(buf.toString('utf8'));
}

function summarize(records) {
  const sample = records.length;
  const numberCount = new Map();
  const top1Count = new Map();
  const pairKeys = new Map();
  const tripleKeys = new Map();
  const comboKeys = { two: new Map(), three: new Map(), four: new Map(), five: new Map() };
  for (const r of records) {
    for (const n of r.five_star) numberCount.set(n, (numberCount.get(n) ?? 0) + 1);
    top1Count.set(r.single_number, (top1Count.get(r.single_number) ?? 0) + 1);
    for (const k of Object.keys(comboKeys)) {
      const arr = r[`${k}_star`];
      const key = arr.join(',');
      comboKeys[k].set(key, (comboKeys[k].get(key) ?? 0) + 1);
    }
    // Track pair / triple substructures across all stars
    for (const arr of [r.two_star, r.three_star, r.four_star, r.five_star]) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const pk = `${arr[i]},${arr[j]}`;
          pairKeys.set(pk, (pairKeys.get(pk) ?? 0) + 1);
          for (let k = j + 1; k < arr.length; k++) {
            const tk = `${arr[i]},${arr[j]},${arr[k]}`;
            tripleKeys.set(tk, (tripleKeys.get(tk) ?? 0) + 1);
          }
        }
      }
    }
  }
  const sortedCounts = [...numberCount.entries()].sort((a, b) => b[1] - a[1]);
  const sortedTop1 = [...top1Count.entries()].sort((a, b) => b[1] - a[1]);
  const top4Total = sortedCounts.slice(0, 4).reduce((s, [, c]) => s + c, 0);
  const top10Total = sortedCounts.slice(0, 10).reduce((s, [, c]) => s + c, 0);
  const totalAppearances = [...numberCount.values()].reduce((s, c) => s + c, 0);
  return {
    sample,
    distinct_numbers_in_5star: numberCount.size,
    distinct_two_star_combos: comboKeys.two.size,
    distinct_three_star_combos: comboKeys.three.size,
    distinct_five_star_combos: comboKeys.five.size,
    top4_share: round(top4Total / Math.max(1, totalAppearances)),
    top10_share: round(top10Total / Math.max(1, totalAppearances)),
    coverage_in_5star: round(numberCount.size / 39),
    top1_distinct: top1Count.size,
    top1_dominator_share: round((sortedTop1[0]?.[1] ?? 0) / Math.max(1, sample)),
    top1_picks: sortedTop1.slice(0, 6).map(([n, c]) => `${n}:${c}`),
    max_repeat_single: sortedTop1[0]?.[1] ?? 0,
    max_repeat_pair: Math.max(0, ...pairKeys.values()),
    max_repeat_triple: Math.max(0, ...tripleKeys.values()),
    max_combo_repeat_3star: Math.max(0, ...comboKeys.three.values()),
    max_combo_repeat_5star: Math.max(0, ...comboKeys.five.values()),
    hit_rate_single: round(records.filter(r => r.actual.includes(r.single_number)).length / sample),
    hit_rate_two: round(records.filter(r => r.two_star.every(n => r.actual.includes(n))).length / sample),
    hit_rate_three: round(records.filter(r => r.three_star.filter(n => r.actual.includes(n)).length >= 3).length / sample),
    hit_rate_four: round(records.filter(r => r.four_star.filter(n => r.actual.includes(n)).length >= 4).length / sample),
    hit_rate_five: round(records.filter(r => r.five_star.filter(n => r.actual.includes(n)).length >= 5).length / sample),
    avg_overlap_5star: round(records.reduce((s, r) => s + r.five_star.filter(n => r.actual.includes(n)).length, 0) / sample),
    eight_in_top1_count: top1Count.get(8) ?? 0,
    eight_in_5star_count: numberCount.get(8) ?? 0,
  };
}

function round(n) { return Math.round(n * 10000) / 10000; }

(async () => {
  const results = {};
  for (const win of WINDOWS) {
    process.stderr.write(`[rotation-vs-v4_restore] window=${win}: OLD (v4_restore_1 — rank #1 + original factors) ...\n`);
    const oldRes = runChild('old', win);
    process.stderr.write(`[rotation-vs-v4_restore] window=${win}: NEW (single rotation + structure fatigue v1) ...\n`);
    const newRes = runChild('new', win);
    results[`window_${win}`] = {
      v4_restore_1: summarize(oldRes.records),
      single_rotation_v1: summarize(newRes.records),
    };
  }
  console.log(JSON.stringify(results, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
