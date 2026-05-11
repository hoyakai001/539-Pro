#!/usr/bin/env node
/**
 * scripts/compare-ensemble-voting.js
 *
 * Walk-forward 三向比較：baseline vs multi_strategy_v1 vs ensemble_voting_v1
 * 不碰 production Firestore；用 backend/data/539.verify.sqlite 為來源。
 *
 * 用法：
 *   npm run compare:ensemble-voting           # 預設 200 期 walk-forward
 *   npm run compare:ensemble-voting -- 100    # 指定 sample size
 *
 * 與 compare-multi-strategy.js 相同的 stub backtest 策略，確保三模式公平比較。
 *
 * 模式定義（與 ENSEMBLE_VOTING_DESIGN.md 與 rollback 表一致）：
 *   baseline           : MULTI_STRATEGY_ENABLED=off, ENSEMBLE_VOTING_ENABLED=off
 *   multi_strategy_v1  : MULTI_STRATEGY_ENABLED=on,  ENSEMBLE_VOTING_ENABLED=off
 *   ensemble_voting_v1 : MULTI_STRATEGY_ENABLED=on,  ENSEMBLE_VOTING_ENABLED=on
 *
 * 額外指標（除了 multi-strategy compare 已有的）：
 *   - hot_number_top10_ratio：top10 號碼總命中數 / 全 sample slots
 *   - core_group_rotation：21/8/22/16/27 在 top5 的累計出現次數
 *   - trend_only_avg：average ensemble_voting strategy_scores.trend_only_ratio
 *   - cross_strategy_consensus_avg：each prediction 的 5 個被選號的 consensus 平均
 *   - pair_dominance_max：最常重複的 pair 在整個 sample 的出現次數
 *   - triple_dominance_max：最常重複的 triple 在整個 sample 的出現次數
 */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'backend', 'dist');
const VERIFY_DB = path.join(ROOT, 'backend', 'data', '539.verify.sqlite');

if (!fs.existsSync(path.join(DIST, 'engine', 'statisticalPrediction.js'))) {
  console.error('[compare] backend not built; run npm run build first');
  process.exit(1);
}
if (!fs.existsSync(VERIFY_DB)) {
  console.error(`[compare] verify SQLite not found at ${VERIFY_DB}`);
  console.error('  please run: npm run verify:local   (one full run to bootstrap data)');
  process.exit(1);
}

const sampleSize = (() => {
  const arg = process.argv.find((a) => /^\d+$/.test(a));
  return arg ? parseInt(arg, 10) : 200;
})();

const CORE_GROUP = new Set([21, 8, 22, 16, 27]);

let Database;
try { Database = require(path.join(ROOT, 'backend', 'node_modules', 'better-sqlite3')); }
catch (e) {
  console.error('[compare] better-sqlite3 not installed:', e.message);
  process.exit(1);
}

const db = new Database(VERIFY_DB, { readonly: true });
const allDraws = db.prepare(`SELECT draw_no, draw_date, numbers_json FROM draws ORDER BY draw_no DESC`).all();
db.close();

if (allDraws.length < sampleSize + 200) {
  console.warn(`[compare] only ${allDraws.length} draws in verify DB; sample reduced.`);
}

const draws = allDraws.map((r) => ({
  draw_no: r.draw_no,
  draw_date: r.draw_date,
  numbers: JSON.parse(r.numbers_json),
}));

function clearCache() {
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(DIST)) delete require.cache[k];
  }
}

function setMode(multiEnabled, ensembleEnabled) {
  if (multiEnabled) process.env.MULTI_STRATEGY_ENABLED = 'true';
  else delete process.env.MULTI_STRATEGY_ENABLED;
  if (ensembleEnabled) process.env.ENSEMBLE_VOTING_ENABLED = 'true';
  else delete process.env.ENSEMBLE_VOTING_ENABLED;
}

function runMode(modeName, multiEnabled, ensembleEnabled) {
  clearCache();
  setMode(multiEnabled, ensembleEnabled);

  const { buildStatisticalPrediction } = require(path.join(DIST, 'engine', 'statisticalPrediction.js'));

  const evals = sampleSize;
  const startIdx = evals;
  if (draws.length < startIdx + 100) throw new Error('insufficient draws');

  // Stub decision (same as compare-multi-strategy.js) for fair / fast comparison.
  const stubDecision = {
    advanced_stats_enabled: false,
    three_star_main_enabled: false,
    decision: 'compare_stub',
    improvement: false,
    reason: 'compare script stub — skipping nested backtest for performance',
    base_model: { hitRateTwo: 0, hitRateThree: 0, hitRateFour: 0, hitRateFive: 0, avgHits: 0, maxLoseStreak: 0, sample_size: 0 },
    advanced_model: { hitRateTwo: 0, hitRateThree: 0, hitRateFour: 0, hitRateFive: 0, avgHits: 0, maxLoseStreak: 0, sample_size: 0 },
    three_star_main_model: { hitRateTwo: 0, hitRateThree: 0, hitRateFour: 0, hitRateFive: 0, avgHits: 0, maxLoseStreak: 0, sample_size: 0 },
    latest_included_draw_no: null,
    sample_size: 0,
  };

  const records = [];
  let prevContext = null;
  for (let i = startIdx; i >= 1; i--) {
    const trainDraws = draws.slice(i);
    const target = draws[i - 1];
    if (trainDraws.length < 100) continue;
    let pred;
    try {
      pred = buildStatisticalPrediction(trainDraws, target.draw_date, [], stubDecision, prevContext);
    } catch (e) {
      continue;
    }

    const actual = new Set(target.numbers);
    const single = pred.single;
    const two = pred.two_star;
    const three = pred.three_star;
    const four = pred.four_star;
    const five = pred.five_star;

    const hitSingle = actual.has(single) ? 1 : 0;
    const hitTwo = two.length === 2 && two.every((n) => actual.has(n)) ? 1 : 0;
    const hitThree = three.length === 3 && three.every((n) => actual.has(n)) ? 1 : 0;
    const hitFour = four.length === 4 && four.every((n) => actual.has(n)) ? 1 : 0;
    const hitFive = five.length === 5 && five.every((n) => actual.has(n)) ? 1 : 0;

    // Pull ensemble diagnostic if present (ensemble mode only)
    const ss = pred.strategy_scores || {};
    const trend_only_ratio = typeof ss.trend_only_ratio === 'number' ? ss.trend_only_ratio : null;
    let avg_consensus = null;
    if (ensembleEnabled && Array.isArray(pred.number_scores)) {
      const fiveSet = new Set(five);
      const fiveRows = pred.number_scores.filter((r) => fiveSet.has(r.number));
      if (fiveRows.length) {
        const consensuses = fiveRows
          .map((r) => (typeof r.cross_strategy_consensus === 'number' ? r.cross_strategy_consensus : null))
          .filter((v) => v !== null);
        if (consensuses.length) avg_consensus = consensuses.reduce((a, b) => a + b, 0) / consensuses.length;
      }
    }

    records.push({
      target_no: target.draw_no,
      single, two, three, four, five,
      hits: { single: hitSingle, two: hitTwo, three: hitThree, four: hitFour, five: hitFive },
      trend_only_ratio,
      avg_consensus,
    });

    prevContext = {
      prediction_id: 0,
      target_date: target.draw_date,
      target_draw_no: target.draw_no,
      two_star: two,
      three_star: three,
      four_star: four,
      five_star: five,
      actual_numbers: target.numbers,
      recent_observations: records.slice(-12).map((r) => ({
        target_draw_no: r.target_no, target_date: '',
        selected_single: r.single,
        selected_two_star: r.two, selected_three_star: r.three,
        selected_four_star: r.four, selected_five_star: r.five,
      })),
    };
  }

  // ── rolling-window aggregation ──────────────────────────────────────────
  // records[] 是 chronological（oldest first），所以 recent_K = records.slice(-K)
  function aggregate(slice) {
    const N = slice.length;
    if (N === 0) return null;
    const hitSum = slice.reduce((s, r) => ({
      single: s.single + r.hits.single, two: s.two + r.hits.two, three: s.three + r.hits.three,
      four: s.four + r.hits.four, five: s.five + r.hits.five,
    }), { single: 0, two: 0, three: 0, four: 0, five: 0 });

    const numberHits = {};
    for (let n = 1; n <= 39; n++) numberHits[n] = 0;
    const fiveCombos = new Set();
    const threeCombos = new Set();
    const fiveCounts = {};
    const pairCounts = {};
    const tripleCounts = {};
    let prevFive = null, prevSingle = null;
    let consecutiveFiveRepeat = 0, maxFiveRepeat = 0;
    let pairRepeatPairs = 0, tripleRepeatPairs = 0;
    let singleRepeatPairs = 0;
    let coreGroupHits = 0;

    for (const r of slice) {
      const arr = r.five.slice().sort((a, b) => a - b);
      for (const n of arr) {
        numberHits[n]++;
        if (CORE_GROUP.has(n)) coreGroupHits++;
      }
      const fiveKey = arr.join(',');
      fiveCombos.add(fiveKey);
      fiveCounts[fiveKey] = (fiveCounts[fiveKey] ?? 0) + 1;
      threeCombos.add(r.three.slice().sort((a, b) => a - b).join(','));
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const pk = `${arr[i]},${arr[j]}`;
          pairCounts[pk] = (pairCounts[pk] ?? 0) + 1;
          for (let k = j + 1; k < arr.length; k++) {
            const tk = `${arr[i]},${arr[j]},${arr[k]}`;
            tripleCounts[tk] = (tripleCounts[tk] ?? 0) + 1;
          }
        }
      }
      if (prevFive) {
        const overlap = r.five.filter((n) => prevFive.includes(n)).length;
        if (overlap >= 5) consecutiveFiveRepeat++; else consecutiveFiveRepeat = 0;
        maxFiveRepeat = Math.max(maxFiveRepeat, consecutiveFiveRepeat);
        const arrA = prevFive.slice().sort((a, b) => a - b);
        const pairsA = new Set();
        for (let i = 0; i < arrA.length; i++) for (let j = i + 1; j < arrA.length; j++) pairsA.add(`${arrA[i]},${arrA[j]}`);
        const pairsB = new Set();
        for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) pairsB.add(`${arr[i]},${arr[j]}`);
        for (const p of pairsB) if (pairsA.has(p)) pairRepeatPairs++;
        const triplesA = new Set();
        for (let i = 0; i < arrA.length; i++) for (let j = i + 1; j < arrA.length; j++) for (let k = j + 1; k < arrA.length; k++) triplesA.add(`${arrA[i]},${arrA[j]},${arrA[k]}`);
        const triplesB = new Set();
        for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) for (let k = j + 1; k < arr.length; k++) triplesB.add(`${arr[i]},${arr[j]},${arr[k]}`);
        for (const t of triplesB) if (triplesA.has(t)) tripleRepeatPairs++;
      }
      if (prevSingle !== null && prevSingle === r.single) singleRepeatPairs++;
      prevFive = arr; prevSingle = r.single;
    }

    const coveredNumbers = Object.values(numberHits).filter((c) => c > 0).length;
    const top10 = Object.entries(numberHits).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const top10Sum = top10.reduce((s, [, c]) => s + c, 0);
    const totalSlots = N * 5;
    const top10Coverage = totalSlots > 0 ? top10Sum / totalSlots : 0;
    const trendOnlyAvg = avgOf(slice.map((r) => r.trend_only_ratio).filter((v) => v !== null));
    const consensusAvg = avgOf(slice.map((r) => r.avg_consensus).filter((v) => v !== null));

    return {
      sample_size: N,
      hit_rate: {
        single: round(hitSum.single / N), two: round(hitSum.two / N),
        three: round(hitSum.three / N), four: round(hitSum.four / N),
        five: round(hitSum.five / N),
      },
      distinct_five_combos: fiveCombos.size,
      distinct_three_combos: threeCombos.size,
      max_combo_repeat: Math.max(0, ...Object.values(fiveCounts)),
      coverage_01_39: coveredNumbers,
      hot_number_top10_ratio: round(top10Coverage),
      pair_dominance_max: Math.max(0, ...Object.values(pairCounts)),
      triple_dominance_max: Math.max(0, ...Object.values(tripleCounts)),
      pair_repeat_consecutive: pairRepeatPairs,
      triple_repeat_consecutive: tripleRepeatPairs,
      single_repeat_consecutive: singleRepeatPairs,
      max_consecutive_five_repeat: maxFiveRepeat,
      core_group_rotation_count: coreGroupHits,
      core_group_rotation_ratio: round(coreGroupHits / totalSlots),
      trend_only_ratio_avg: trendOnlyAvg !== null ? round(trendOnlyAvg) : null,
      cross_strategy_consensus_avg: consensusAvg !== null ? round(consensusAvg) : null,
    };
  }

  // Build per-window aggregates
  const windows = {
    recent_10: aggregate(records.slice(-10)),
    recent_20: aggregate(records.slice(-20)),
    recent_30: aggregate(records.slice(-30)),
    all: aggregate(records),
  };

  // legacy summary shape (kept for backwards-compat / old consumers)
  const N = records.length;
  const hitSum = records.reduce((s, r) => ({
    single: s.single + r.hits.single, two: s.two + r.hits.two, three: s.three + r.hits.three,
    four: s.four + r.hits.four, five: s.five + r.hits.five,
  }), { single: 0, two: 0, three: 0, four: 0, five: 0 });

  const numberHits = {};
  for (let n = 1; n <= 39; n++) numberHits[n] = 0;
  const fiveCombos = new Set();
  const threeCombos = new Set();
  const fiveCounts = {};
  const pairCounts = {};
  const tripleCounts = {};
  let prevFive = null, prevSingle = null;
  let consecutiveFiveRepeat = 0, maxFiveRepeat = 0;
  let pairRepeatPairs = 0, tripleRepeatPairs = 0;
  let singleRepeatPairs = 0;
  let coreGroupHits = 0;

  for (const r of records) {
    const arr = r.five.slice().sort((a, b) => a - b);
    for (const n of arr) {
      numberHits[n]++;
      if (CORE_GROUP.has(n)) coreGroupHits++;
    }
    const fiveKey = arr.join(',');
    fiveCombos.add(fiveKey);
    fiveCounts[fiveKey] = (fiveCounts[fiveKey] ?? 0) + 1;
    threeCombos.add(r.three.slice().sort((a, b) => a - b).join(','));
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const pk = `${arr[i]},${arr[j]}`;
        pairCounts[pk] = (pairCounts[pk] ?? 0) + 1;
        for (let k = j + 1; k < arr.length; k++) {
          const tk = `${arr[i]},${arr[j]},${arr[k]}`;
          tripleCounts[tk] = (tripleCounts[tk] ?? 0) + 1;
        }
      }
    }
    if (prevFive) {
      const overlap = r.five.filter((n) => prevFive.includes(n)).length;
      if (overlap >= 5) consecutiveFiveRepeat++; else consecutiveFiveRepeat = 0;
      maxFiveRepeat = Math.max(maxFiveRepeat, consecutiveFiveRepeat);
      const arrA = prevFive.slice().sort((a, b) => a - b);
      const pairsA = new Set();
      for (let i = 0; i < arrA.length; i++) for (let j = i + 1; j < arrA.length; j++) pairsA.add(`${arrA[i]},${arrA[j]}`);
      const pairsB = new Set();
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) pairsB.add(`${arr[i]},${arr[j]}`);
      for (const p of pairsB) if (pairsA.has(p)) pairRepeatPairs++;
      const triplesA = new Set();
      for (let i = 0; i < arrA.length; i++) for (let j = i + 1; j < arrA.length; j++) for (let k = j + 1; k < arrA.length; k++) triplesA.add(`${arrA[i]},${arrA[j]},${arrA[k]}`);
      const triplesB = new Set();
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) for (let k = j + 1; k < arr.length; k++) triplesB.add(`${arr[i]},${arr[j]},${arr[k]}`);
      for (const t of triplesB) if (triplesA.has(t)) tripleRepeatPairs++;
    }
    if (prevSingle !== null && prevSingle === r.single) singleRepeatPairs++;
    prevFive = arr; prevSingle = r.single;
  }

  const coveredNumbers = Object.values(numberHits).filter((c) => c > 0).length;
  const top10 = Object.entries(numberHits).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const top10Sum = top10.reduce((s, [, c]) => s + c, 0);
  const totalSlots = N * 5;
  const top10Coverage = totalSlots > 0 ? top10Sum / totalSlots : 0;
  const distinctFive = fiveCombos.size;
  const distinctThree = threeCombos.size;
  const maxComboRepeat = Math.max(0, ...Object.values(fiveCounts));
  const maxPairCount = Math.max(0, ...Object.values(pairCounts));
  const maxTripleCount = Math.max(0, ...Object.values(tripleCounts));

  const trendOnlyAvg = avgOf(records.map((r) => r.trend_only_ratio).filter((v) => v !== null));
  const consensusAvg = avgOf(records.map((r) => r.avg_consensus).filter((v) => v !== null));

  return {
    mode: modeName,
    sample_size: N,
    windows,
    hit_rate: {
      single: round(hitSum.single / N),
      two: round(hitSum.two / N),
      three: round(hitSum.three / N),
      four: round(hitSum.four / N),
      five: round(hitSum.five / N),
    },
    hit_count: hitSum,
    distinct_five_combos: distinctFive,
    distinct_three_combos: distinctThree,
    max_combo_repeat: maxComboRepeat,
    coverage_01_39: coveredNumbers,
    hot_number_top10_ratio: round(top10Coverage),
    top10_numbers: top10.map(([n, c]) => ({ n: Number(n), c })),
    pair_dominance_max: maxPairCount,
    triple_dominance_max: maxTripleCount,
    pair_repeat_consecutive: pairRepeatPairs,
    triple_repeat_consecutive: tripleRepeatPairs,
    single_repeat_consecutive: singleRepeatPairs,
    max_consecutive_five_repeat: maxFiveRepeat,
    core_group_rotation_count: coreGroupHits,
    core_group_rotation_ratio: round(coreGroupHits / totalSlots),
    trend_only_ratio_avg: trendOnlyAvg !== null ? round(trendOnlyAvg) : null,
    cross_strategy_consensus_avg: consensusAvg !== null ? round(consensusAvg) : null,
  };
}

function round(n) { return Math.round(n * 10000) / 10000; }
function avgOf(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }

console.log(`[compare] sample_size=${sampleSize} on ${draws.length} draws`);
console.log('[compare] running BASELINE…');
const baseline = runMode('baseline', false, false);
console.log('[compare] running MULTI_STRATEGY_V1…');
const multi = runMode('multi_strategy_v1', true, false);
console.log('[compare] running ENSEMBLE_VOTING_V1…');
const ensemble = runMode('ensemble_voting_v1', true, true);

function summary(r) {
  return {
    sample_size: r.sample_size,
    hit_rate: r.hit_rate,
    distinct_five_combos: r.distinct_five_combos,
    distinct_three_combos: r.distinct_three_combos,
    coverage_01_39: r.coverage_01_39,
    hot_number_top10_ratio: r.hot_number_top10_ratio,
    pair_dominance_max: r.pair_dominance_max,
    triple_dominance_max: r.triple_dominance_max,
    pair_repeat_consecutive: r.pair_repeat_consecutive,
    triple_repeat_consecutive: r.triple_repeat_consecutive,
    single_repeat_consecutive: r.single_repeat_consecutive,
    max_combo_repeat: r.max_combo_repeat,
    core_group_rotation_count: r.core_group_rotation_count,
    core_group_rotation_ratio: r.core_group_rotation_ratio,
    trend_only_ratio_avg: r.trend_only_ratio_avg,
    cross_strategy_consensus_avg: r.cross_strategy_consensus_avg,
  };
}

function deltaOf(a, b) {
  return {
    hit_rate_single: round(b.hit_rate.single - a.hit_rate.single),
    hit_rate_two: round(b.hit_rate.two - a.hit_rate.two),
    hit_rate_three: round(b.hit_rate.three - a.hit_rate.three),
    hit_rate_four: round(b.hit_rate.four - a.hit_rate.four),
    hit_rate_five: round(b.hit_rate.five - a.hit_rate.five),
    distinct_five_combos: b.distinct_five_combos - a.distinct_five_combos,
    distinct_three_combos: b.distinct_three_combos - a.distinct_three_combos,
    coverage_01_39: b.coverage_01_39 - a.coverage_01_39,
    hot_number_top10_ratio: round(b.hot_number_top10_ratio - a.hot_number_top10_ratio),
    pair_dominance_max: b.pair_dominance_max - a.pair_dominance_max,
    triple_dominance_max: b.triple_dominance_max - a.triple_dominance_max,
    pair_repeat_consecutive: b.pair_repeat_consecutive - a.pair_repeat_consecutive,
    triple_repeat_consecutive: b.triple_repeat_consecutive - a.triple_repeat_consecutive,
    single_repeat_consecutive: b.single_repeat_consecutive - a.single_repeat_consecutive,
    max_combo_repeat: b.max_combo_repeat - a.max_combo_repeat,
    core_group_rotation_count: b.core_group_rotation_count - a.core_group_rotation_count,
  };
}

const report = {
  generated_at: new Date().toISOString(),
  sample_size: baseline.sample_size,
  baseline,
  multi_strategy_v1: multi,
  ensemble_voting_v1: ensemble,
  delta_multi_vs_baseline: deltaOf(baseline, multi),
  delta_ensemble_vs_baseline: deltaOf(baseline, ensemble),
  delta_ensemble_vs_multi: deltaOf(multi, ensemble),
};

// Allow variant labeling via ENV: the runner sets COMPARE_VARIANT_LABEL=A|B|C and the output file uses it.
const variantLabel = (process.env.COMPARE_VARIANT_LABEL || '').trim();
const outPath = path.join(ROOT, variantLabel
  ? `compare-ensemble-voting.${variantLabel}.json`
  : 'compare-ensemble-voting.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`[compare] report written to ${outPath}`);
console.log('');

// ── rolling-window summary table ─────────────────────────────────────────
const METRICS = [
  ['hit_rate.single', 4],
  ['hit_rate.two', 4],
  ['hit_rate.three', 4],
  ['distinct_five_combos', 0],
  ['distinct_three_combos', 0],
  ['coverage_01_39', 0],
  ['hot_number_top10_ratio', 4],
  ['pair_dominance_max', 0],
  ['triple_dominance_max', 0],
  ['pair_repeat_consecutive', 0],
  ['triple_repeat_consecutive', 0],
  ['single_repeat_consecutive', 0],
  ['max_combo_repeat', 0],
  ['core_group_rotation_count', 0],
  ['trend_only_ratio_avg', 4],
  ['cross_strategy_consensus_avg', 4],
];
function get(o, path) {
  return path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
}
function pad(s, n) { s = String(s == null ? '-' : s); return s + ' '.repeat(Math.max(0, n - s.length)); }
function fmt(v, dec) { if (v == null) return '-'; return typeof v === 'number' ? v.toFixed(dec) : String(v); }
const WINDOWS = ['recent_10', 'recent_20', 'recent_30', 'all'];
console.log('==== ROLLING-WINDOW SUMMARY (variant: ' + (variantLabel || 'default') + ') ====');
for (const w of WINDOWS) {
  console.log('');
  console.log(`-- window: ${w} (sample=${baseline.windows[w]?.sample_size ?? 0}) --`);
  console.log(pad('metric', 30), pad('base', 10), pad('multi', 10), pad('ens', 10));
  for (const [k, d] of METRICS) {
    const b = get(baseline.windows[w], k);
    const m = get(multi.windows[w], k);
    const e = get(ensemble.windows[w], k);
    console.log(pad(k, 30), pad(fmt(b, d), 10), pad(fmt(m, d), 10), pad(fmt(e, d), 10));
  }
}
