#!/usr/bin/env node
'use strict';
/**
 * Walk-forward comparison of top-score-compression ON vs OFF.
 * Reads the backend SQLite DB read-only (no writes, no fake data).
 * Forks one child per mode so the env flag is captured before module load.
 */
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WINDOWS = [30, 50, 100];

function runChild(mode, window) {
  const env = { ...process.env, COMPARE_MODE: mode, COMPARE_WINDOW: String(window) };
  if (mode === 'old') env.TOP_SCORE_COMPRESSION_DISABLED = '1';
  else delete env.TOP_SCORE_COMPRESSION_DISABLED;
  // Keep pool diversification ON in BOTH modes — we want to isolate the
  // compression layer's marginal effect on top of v3.
  delete env.POOL_DIVERSIFICATION_DISABLED;
  const buf = execFileSync(process.execPath, [path.join(__dirname, '_compare-worker.js')], {
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
  const comboKeys = { two: new Set(), three: new Set(), four: new Set(), five: new Set() };
  for (const r of records) {
    for (const n of r.five_star) numberCount.set(n, (numberCount.get(n) ?? 0) + 1);
    top1Count.set(r.single_number, (top1Count.get(r.single_number) ?? 0) + 1);
    comboKeys.two.add(r.two_star.join(','));
    comboKeys.three.add(r.three_star.join(','));
    comboKeys.four.add(r.four_star.join(','));
    comboKeys.five.add(r.five_star.join(','));
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
    distinct_four_star_combos: comboKeys.four.size,
    distinct_five_star_combos: comboKeys.five.size,
    top4_numbers_in_5star: sortedCounts.slice(0, 4).map(([n, c]) => `${n}:${c}`),
    top4_share: round(top4Total / Math.max(1, totalAppearances)),
    top10_share: round(top10Total / Math.max(1, totalAppearances)),
    coverage_in_5star: round(numberCount.size / 39),
    top1_picks: sortedTop1.slice(0, 5).map(([n, c]) => `${n}:${c}`),
    top1_distinct: top1Count.size,
    top1_dominator_share: round((sortedTop1[0]?.[1] ?? 0) / Math.max(1, sample)),
    hit_rate_single: round(records.filter(r => r.actual.includes(r.single_number)).length / sample),
    hit_rate_two: round(records.filter(r => r.two_star.every(n => r.actual.includes(n))).length / sample),
    hit_rate_three: round(records.filter(r => r.three_star.filter(n => r.actual.includes(n)).length >= 3).length / sample),
    hit_rate_four: round(records.filter(r => r.four_star.filter(n => r.actual.includes(n)).length >= 4).length / sample),
    hit_rate_five: round(records.filter(r => r.five_star.filter(n => r.actual.includes(n)).length >= 5).length / sample),
    avg_overlap_5star: round(records.reduce((s, r) => s + r.five_star.filter(n => r.actual.includes(n)).length, 0) / sample),
    max_combo_repeat_5star: maxRepeat(records.map(r => r.five_star.join(','))),
    max_combo_repeat_3star: maxRepeat(records.map(r => r.three_star.join(','))),
    max_combo_repeat_2star: maxRepeat(records.map(r => r.two_star.join(','))),
    eight_in_top1_count: top1Count.get(8) ?? 0,
    eight_in_5star_count: numberCount.get(8) ?? 0,
  };
}

function maxRepeat(arr) {
  const m = new Map();
  for (const k of arr) m.set(k, (m.get(k) ?? 0) + 1);
  return Math.max(0, ...m.values());
}

function round(n) {
  return Math.round(n * 10000) / 10000;
}

(async () => {
  const results = {};
  for (const win of WINDOWS) {
    process.stderr.write(`[compress-cmp] window=${win}: OLD (compression off) ...\n`);
    const oldRes = runChild('old', win);
    process.stderr.write(`[compress-cmp] window=${win}: NEW (compression on) ...\n`);
    const newRes = runChild('new', win);
    results[`window_${win}`] = {
      old: summarize(oldRes.records),
      new: summarize(newRes.records),
    };
  }
  console.log(JSON.stringify(results, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
