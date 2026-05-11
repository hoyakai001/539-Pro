#!/usr/bin/env node
'use strict';
/**
 * Walk-forward comparison of pool-diversification ON vs OFF.
 * Reads the backend SQLite DB read-only (no writes, no fake data).
 * Forks one child per mode so the env flag is captured before module load.
 */
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WINDOWS = [30, 50, 100];

function runChild(mode, window) {
  const env = { ...process.env, COMPARE_MODE: mode, COMPARE_WINDOW: String(window) };
  if (mode === 'old') env.POOL_DIVERSIFICATION_DISABLED = '1';
  else delete env.POOL_DIVERSIFICATION_DISABLED;
  const buf = execFileSync(process.execPath, [path.join(__dirname, '_compare-worker.js')], {
    cwd: ROOT,
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(buf.toString('utf8'));
}

function pct(numerator, denominator) {
  return denominator ? (numerator / denominator) : 0;
}

function summarize(records) {
  const sample = records.length;
  const numberCount = new Map();
  const comboKeys = { two: new Set(), three: new Set(), four: new Set(), five: new Set() };
  for (const r of records) {
    for (const n of r.five_star) numberCount.set(n, (numberCount.get(n) ?? 0) + 1);
    comboKeys.two.add(r.two_star.join(','));
    comboKeys.three.add(r.three_star.join(','));
    comboKeys.four.add(r.four_star.join(','));
    comboKeys.five.add(r.five_star.join(','));
  }
  const sortedCounts = [...numberCount.entries()].sort((a, b) => b[1] - a[1]);
  const top4Numbers = sortedCounts.slice(0, 4);
  const top4Total = top4Numbers.reduce((s, [, c]) => s + c, 0);
  const top10Total = sortedCounts.slice(0, 10).reduce((s, [, c]) => s + c, 0);
  const totalAppearances = [...numberCount.values()].reduce((s, c) => s + c, 0);

  return {
    sample,
    distinct_numbers_in_5star: numberCount.size,
    distinct_two_star_combos: comboKeys.two.size,
    distinct_three_star_combos: comboKeys.three.size,
    distinct_four_star_combos: comboKeys.four.size,
    distinct_five_star_combos: comboKeys.five.size,
    top4_numbers: top4Numbers.map(([n, c]) => `${n}:${c}`),
    top4_share: round(pct(top4Total, totalAppearances)),
    top10_share: round(pct(top10Total, totalAppearances)),
    coverage_in_5star: round(numberCount.size / 39),
    hit_rate_single: round(records.filter(r => r.actual.includes(r.single_number)).length / sample),
    hit_rate_two: round(records.filter(r => r.two_star.every(n => r.actual.includes(n))).length / sample),
    hit_rate_three: round(records.filter(r => r.three_star.filter(n => r.actual.includes(n)).length >= 3).length / sample),
    hit_rate_four: round(records.filter(r => r.four_star.filter(n => r.actual.includes(n)).length >= 4).length / sample),
    hit_rate_five: round(records.filter(r => r.five_star.filter(n => r.actual.includes(n)).length >= 5).length / sample),
    avg_overlap_with_actual: round(records.reduce((s, r) => s + r.five_star.filter(n => r.actual.includes(n)).length, 0) / sample),
    max_combo_repeat_5star: maxRepeat(records.map(r => r.five_star.join(','))),
    max_combo_repeat_3star: maxRepeat(records.map(r => r.three_star.join(','))),
    max_combo_repeat_2star: maxRepeat(records.map(r => r.two_star.join(','))),
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

function delta(label, oldVal, newVal, lowerBetter = false) {
  if (typeof oldVal !== 'number' || typeof newVal !== 'number') {
    return { label, old: oldVal, new: newVal, change: 'n/a' };
  }
  const diff = round(newVal - oldVal);
  const tag = diff === 0 ? '=' : (diff > 0 ? '+' : '') + diff;
  const better =
    diff === 0 ? '=' : (lowerBetter ? (diff < 0 ? '↓ better' : '↑ worse') : (diff > 0 ? '↑ better' : '↓ worse'));
  return { label, old: oldVal, new: newVal, change: tag, direction: better };
}

(async () => {
  const results = {};
  for (const win of WINDOWS) {
    process.stderr.write(`[compare] window=${win}: running OLD ...\n`);
    const oldRes = runChild('old', win);
    process.stderr.write(`[compare] window=${win}: running NEW ...\n`);
    const newRes = runChild('new', win);
    const oldS = summarize(oldRes.records);
    const newS = summarize(newRes.records);
    results[`window_${win}`] = {
      old: oldS,
      new: newS,
      deltas: [
        delta('hit_rate_single', oldS.hit_rate_single, newS.hit_rate_single, false),
        delta('hit_rate_two',    oldS.hit_rate_two,    newS.hit_rate_two,    false),
        delta('hit_rate_three',  oldS.hit_rate_three,  newS.hit_rate_three,  false),
        delta('hit_rate_four',   oldS.hit_rate_four,   newS.hit_rate_four,   false),
        delta('hit_rate_five',   oldS.hit_rate_five,   newS.hit_rate_five,   false),
        delta('avg_overlap_5star', oldS.avg_overlap_with_actual, newS.avg_overlap_with_actual, false),
        delta('top4_share',      oldS.top4_share,      newS.top4_share,      true),
        delta('top10_share',     oldS.top10_share,     newS.top10_share,     true),
        delta('coverage_in_5star', oldS.coverage_in_5star, newS.coverage_in_5star, false),
        delta('distinct_2star_combos', oldS.distinct_two_star_combos, newS.distinct_two_star_combos, false),
        delta('distinct_3star_combos', oldS.distinct_three_star_combos, newS.distinct_three_star_combos, false),
        delta('distinct_5star_combos', oldS.distinct_five_star_combos, newS.distinct_five_star_combos, false),
        delta('max_repeat_5star', oldS.max_combo_repeat_5star, newS.max_combo_repeat_5star, true),
        delta('max_repeat_3star', oldS.max_combo_repeat_3star, newS.max_combo_repeat_3star, true),
        delta('max_repeat_2star', oldS.max_combo_repeat_2star, newS.max_combo_repeat_2star, true),
      ],
    };
  }

  console.log(JSON.stringify(results, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
