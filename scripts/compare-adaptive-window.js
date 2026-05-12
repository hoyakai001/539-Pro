#!/usr/bin/env node
/**
 * scripts/compare-adaptive-window.js
 *
 * Adaptive window backtest：在「同一個 walk-forward 真實預測序列」之上，把序列切成
 * 10 / 20 / 30 / 40 / 50 / 60 / 70 / 80 / 90 / 100 期的「不重疊片段」，
 * 各自計算 hit_rate / coverage / core_group / hot_top10 等指標。
 *
 * 目的：找出「哪個 evaluation window 最準、最穩」——即在不同片段大小下，hit_rate
 * 的均值與變異程度（mean ± stderr）。Window 越大越穩、但更新越慢；window 越小資訊
 * 越即時，但 noise 大。本腳本量化此 trade-off。
 *
 * 模式：跑兩個對照
 *   A. multi_strategy_v1 only（current production rollback target）
 *   B. multi_strategy_v1 + ensemble_voting_v1 Candidate-C（current production after Phase 2）
 *      (STRUCTURE_ADJUST_ENABLED 預設關閉，依用戶要求)
 *
 * 用法：
 *   node scripts/compare-adaptive-window.js           # 預設 sample_size=200
 *   node scripts/compare-adaptive-window.js 300       # 300 walk-forward 預測
 *
 * 真實資料：使用 backend/data/539.verify.sqlite（由 verify:local 從台灣彩券官方下載
 * 的歷史），無任何 fake / mock。
 */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'backend', 'dist');
const VERIFY_DB = path.join(ROOT, 'backend', 'data', '539.verify.sqlite');

if (!fs.existsSync(path.join(DIST, 'engine', 'statisticalPrediction.js'))) {
  console.error('[adaptive] backend not built; run: backend/node_modules/.bin/tsc --skipLibCheck');
  process.exit(1);
}
if (!fs.existsSync(VERIFY_DB)) {
  console.error(`[adaptive] verify SQLite not found at ${VERIFY_DB}`);
  console.error('  please run: npm run verify:local   (first-time bootstrap)');
  process.exit(1);
}

const sampleSize = (() => {
  const arg = process.argv.find(a => /^\d+$/.test(a));
  return arg ? parseInt(arg, 10) : 200;
})();

const CORE_GROUP = new Set([8, 16, 21, 22, 27]);  // metric-config (observation watch list)
const WINDOWS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

let Database;
try { Database = require(path.join(ROOT, 'backend', 'node_modules', 'better-sqlite3')); }
catch (e) {
  console.error('[adaptive] better-sqlite3 not installed:', e.message);
  process.exit(1);
}
const db = new Database(VERIFY_DB, { readonly: true });
const allDraws = db.prepare(`SELECT draw_no, draw_date, numbers_json FROM draws ORDER BY draw_no DESC`).all();
db.close();
const draws = allDraws.map(r => ({ draw_no: r.draw_no, draw_date: r.draw_date, numbers: JSON.parse(r.numbers_json) }));

if (draws.length < sampleSize + 100) {
  console.warn(`[adaptive] only ${draws.length} draws; sample_size adjusted`);
}

function clearCache() {
  for (const k of Object.keys(require.cache)) if (k.startsWith(DIST)) delete require.cache[k];
}

function setMode(multi, ens) {
  if (multi) process.env.MULTI_STRATEGY_ENABLED = 'true'; else delete process.env.MULTI_STRATEGY_ENABLED;
  if (ens) process.env.ENSEMBLE_VOTING_ENABLED = 'true'; else delete process.env.ENSEMBLE_VOTING_ENABLED;
}

function walkForward(modeLabel, multi, ens) {
  clearCache();
  setMode(multi, ens);
  const { buildStatisticalPrediction } = require(path.join(DIST, 'engine', 'statisticalPrediction.js'));

  const stub = {
    advanced_stats_enabled: false, three_star_main_enabled: false,
    decision: 'adaptive_window_stub', improvement: false,
    reason: 'compare script stub — skipping nested backtest for performance',
    base_model: { hitRateTwo: 0, hitRateThree: 0, hitRateFour: 0, hitRateFive: 0, avgHits: 0, maxLoseStreak: 0, sample_size: 0 },
    advanced_model: { hitRateTwo: 0, hitRateThree: 0, hitRateFour: 0, hitRateFive: 0, avgHits: 0, maxLoseStreak: 0, sample_size: 0 },
    three_star_main_model: { hitRateTwo: 0, hitRateThree: 0, hitRateFour: 0, hitRateFive: 0, avgHits: 0, maxLoseStreak: 0, sample_size: 0 },
    latest_included_draw_no: null, sample_size: 0,
  };

  const records = [];
  let prev = null;
  const startIdx = Math.min(sampleSize, draws.length - 100);
  for (let i = startIdx; i >= 1; i--) {
    const train = draws.slice(i);
    const target = draws[i - 1];
    if (train.length < 100) continue;
    let pred;
    try { pred = buildStatisticalPrediction(train, target.draw_date, [], stub, prev); }
    catch (e) { continue; }
    const actual = new Set(target.numbers);
    const single = pred.single;
    const two = pred.two_star, three = pred.three_star, four = pred.four_star, five = pred.five_star;
    const total_hits = five.filter(n => actual.has(n)).length;
    records.push({
      target_no: target.draw_no, single, two, three, four, five,
      total_hits,
      single_hit: actual.has(single) ? 1 : 0,
      two_hit: two.length === 2 && two.every(n => actual.has(n)) ? 1 : 0,
      three_hit_full: three.length === 3 && three.every(n => actual.has(n)) ? 1 : 0,
    });
    prev = {
      prediction_id: 0, target_date: target.draw_date, target_draw_no: target.draw_no,
      two_star: two, three_star: three, four_star: four, five_star: five,
      actual_numbers: target.numbers,
      recent_observations: records.slice(-12).map(r => ({
        target_draw_no: r.target_no, target_date: '',
        selected_single: r.single,
        selected_two_star: r.two, selected_three_star: r.three,
        selected_four_star: r.four, selected_five_star: r.five,
      })),
    };
  }
  console.log(`[adaptive] ${modeLabel}: ${records.length} walk-forward predictions complete`);
  return records;
}

// ── per-segment metric aggregation ────────────────────────────────────────
function aggregateSegment(segment) {
  const N = segment.length;
  if (N === 0) return null;
  const numberHits = {};
  for (let n = 1; n <= 39; n++) numberHits[n] = 0;
  const pairCounts = new Map();
  const tripleCounts = new Map();
  let singleHits = 0, twoHits = 0, threeFull = 0;
  let totalSingleHitSlots = 0;  // total_hits 累計
  let coreGroupCount = 0;
  let prevPairs = null, prevTriples = null, prevSingle = null;
  let pairConsec = 0, tripleConsec = 0, singleConsec = 0;
  let curMissStreak = 0, maxMissStreak = 0;
  for (const r of segment) {
    const arr = [...r.five].sort((a, b) => a - b);
    for (const n of arr) {
      numberHits[n] = (numberHits[n] || 0) + 1;
      if (CORE_GROUP.has(n)) coreGroupCount++;
    }
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const pk = `${arr[i]},${arr[j]}`;
      pairCounts.set(pk, (pairCounts.get(pk) || 0) + 1);
      for (let k = j + 1; k < arr.length; k++) {
        const tk = `${arr[i]},${arr[j]},${arr[k]}`;
        tripleCounts.set(tk, (tripleCounts.get(tk) || 0) + 1);
      }
    }
    const pairs = new Set();
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) pairs.add(`${arr[i]},${arr[j]}`);
    const triples = new Set();
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) for (let k = j + 1; k < arr.length; k++) triples.add(`${arr[i]},${arr[j]},${arr[k]}`);
    if (prevPairs) for (const p of pairs) if (prevPairs.has(p)) pairConsec++;
    if (prevTriples) for (const t of triples) if (prevTriples.has(t)) tripleConsec++;
    if (prevSingle !== null && prevSingle === r.single) singleConsec++;
    prevPairs = pairs; prevTriples = triples; prevSingle = r.single;
    if (r.single_hit) singleHits++; else curMissStreak++;
    if (r.single_hit) { curMissStreak = 0; } else { if (curMissStreak > maxMissStreak) maxMissStreak = curMissStreak; }
    if (r.two_hit) twoHits++;
    if (r.three_hit_full) threeFull++;
    totalSingleHitSlots += r.total_hits;
  }
  if (curMissStreak > maxMissStreak) maxMissStreak = curMissStreak;
  const totalSlots = N * 5;
  const top10 = [...Object.entries(numberHits)].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const top10Sum = top10.reduce((s, [, c]) => s + c, 0);
  return {
    sample_size: N,
    hit_rate_single: round(singleHits / N),
    hit_rate_two: round(twoHits / N),
    hit_rate_three_full: round(threeFull / N),
    average_hits_per_draw: round(totalSingleHitSlots / N),
    max_miss_streak: maxMissStreak,
    coverage_01_39: Object.values(numberHits).filter(c => c > 0).length,
    core_group_ratio: round(coreGroupCount / totalSlots),
    hot_top10_ratio: round(top10Sum / totalSlots),
    pair_repeat_consecutive: pairConsec,
    triple_repeat_consecutive: tripleConsec,
    single_repeat_consecutive: singleConsec,
    max_pair_count: pairCounts.size ? Math.max(...pairCounts.values()) : 0,
    max_triple_count: tripleCounts.size ? Math.max(...tripleCounts.values()) : 0,
  };
}

function round(n) { return Math.round(n * 10000) / 10000; }

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function stderr(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (arr.length - 1);
  return Math.sqrt(v / arr.length);
}

// Slice walk-forward records into disjoint segments of size N.
// Returns array of segment-summaries (newest first → most recent segment is segments[0]).
function adaptiveAnalysis(records, N) {
  const segments = [];
  // records[] chronological (oldest → newest from walkForward). Slice from newest backwards.
  // Want non-overlapping: from index records.length - N back to 0
  for (let end = records.length; end >= N; end -= N) {
    segments.push(records.slice(end - N, end));
  }
  return segments.map(aggregateSegment);
}

function summarizeWindow(segments) {
  if (!segments.length) return null;
  const keys = ['hit_rate_single', 'hit_rate_two', 'hit_rate_three_full', 'average_hits_per_draw',
    'max_miss_streak', 'coverage_01_39', 'core_group_ratio', 'hot_top10_ratio',
    'pair_repeat_consecutive', 'triple_repeat_consecutive', 'single_repeat_consecutive',
    'max_pair_count', 'max_triple_count'];
  const out = { num_segments: segments.length, segment_size: segments[0].sample_size };
  for (const k of keys) {
    const vals = segments.map(s => s[k]);
    out[k] = {
      mean: round(mean(vals)),
      stderr: round(stderr(vals)),
      min: Math.min(...vals),
      max: Math.max(...vals),
    };
  }
  return out;
}

// ── main ──────────────────────────────────────────────────────────────────
console.log(`[adaptive] sample_size=${sampleSize}, total draws=${draws.length}`);
console.log('[adaptive] running MODE A: multi_strategy_v1 only (rollback target)...');
const recordsA = walkForward('A=multi_only', true, false);
console.log('[adaptive] running MODE B: multi + ensemble Cand-C (current production)...');
process.env.ENSEMBLE_NUMBER_EXPOSURE_MAX_REPEAT = '3';
process.env.ENSEMBLE_NUMBER_EXPOSURE_PENALTY = '0.75';
process.env.ENSEMBLE_CORE_GROUP_MAX_EXPOSURE = '3';
process.env.ENSEMBLE_CORE_GROUP_PENALTY = '0.78';
const recordsB = walkForward('B=ens_candC', true, true);

const reportA = {};
const reportB = {};
for (const N of WINDOWS) {
  reportA[`window_${N}`] = summarizeWindow(adaptiveAnalysis(recordsA, N));
  reportB[`window_${N}`] = summarizeWindow(adaptiveAnalysis(recordsB, N));
}

const out = {
  generated_at: new Date().toISOString(),
  sample_size: sampleSize,
  draws_used: draws.length,
  mode_A_label: 'multi_strategy_v1 only (rollback)',
  mode_B_label: 'multi_strategy_v1 + ensemble_voting_v1 Candidate-C (current production)',
  mode_A: reportA,
  mode_B: reportB,
};
const variantLabel = (process.env.COMPARE_VARIANT_LABEL || '').trim();
const outPath = path.join(ROOT, variantLabel
  ? `compare-adaptive-window.${variantLabel}.json`
  : 'compare-adaptive-window.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('[adaptive] report written to ' + outPath);
console.log('');

// ── console table ────────────────────────────────────────────────────────
function pad(s, n) { s = String(s == null ? '-' : s); return s + ' '.repeat(Math.max(0, n - s.length)); }
function fmt(v, d = 4) { if (v == null) return '-'; return typeof v === 'number' ? v.toFixed(d) : String(v); }
const METRICS = [
  ['hit_rate_single', 4],
  ['hit_rate_two', 4],
  ['average_hits_per_draw', 3],
  ['max_miss_streak', 0],
  ['coverage_01_39', 0],
  ['core_group_ratio', 4],
  ['hot_top10_ratio', 4],
  ['pair_repeat_consecutive', 0],
  ['triple_repeat_consecutive', 0],
  ['max_pair_count', 0],
];
console.log('==== ADAPTIVE WINDOW SUMMARY (mean ± stderr across disjoint segments) ====');
console.log('A = multi_strategy_v1 only (rollback target)');
console.log('B = multi + ensemble Cand-C (current production with ENSEMBLE_VOTING_ENABLED=true)');
console.log('');
for (const N of WINDOWS) {
  const a = reportA[`window_${N}`];
  const b = reportB[`window_${N}`];
  if (!a || !b) continue;
  console.log(`-- window=${N}  (segments: A=${a.num_segments}, B=${b.num_segments}) --`);
  console.log(pad('metric', 28), pad('A mean ± stderr', 22), pad('B mean ± stderr', 22), pad('B better?', 12));
  for (const [k, d] of METRICS) {
    const am = a[k].mean, ase = a[k].stderr;
    const bm = b[k].mean, bse = b[k].stderr;
    // For metrics where HIGHER is better: hit_rate_single/two, average_hits_per_draw, coverage_01_39
    // For metrics where LOWER is better: max_miss_streak, core_group_ratio, hot_top10_ratio, pair_repeat, triple_repeat, max_pair_count
    const higherBetter = ['hit_rate_single', 'hit_rate_two', 'hit_rate_three_full', 'average_hits_per_draw', 'coverage_01_39'].includes(k);
    const cmp = higherBetter ? (bm > am) : (bm < am);
    const better = cmp ? '✓' : (am === bm ? '=' : '✗');
    console.log(pad(k, 28), pad(`${fmt(am, d)} ± ${fmt(ase, d)}`, 22), pad(`${fmt(bm, d)} ± ${fmt(bse, d)}`, 22), pad(better, 12));
  }
  console.log('');
}
