#!/usr/bin/env node
/**
 * scripts/compare-multi-strategy.js
 *
 * Walk-forward 比較：baseline vs multi_strategy_v1
 * 不碰 production Firestore；用 backend/data/539.verify.sqlite 為來源。
 *
 * 用法：
 *   npm run compare:multi-strategy          # 預設 200 期 walk-forward
 *   npm run compare:multi-strategy -- 100   # 指定 sample size
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

// freshly require, with multi-strategy ENV toggled per-mode
function clearCache() {
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(DIST)) delete require.cache[k];
  }
}

function runMode(modeName, multiEnabled) {
  // Reset module state — new PREDICTION_CACHE_SCHEMA computation, new ENV reads
  clearCache();
  if (multiEnabled) process.env.MULTI_STRATEGY_ENABLED = 'true';
  else delete process.env.MULTI_STRATEGY_ENABLED;

  const { buildStatisticalPrediction } = require(path.join(DIST, 'engine', 'statisticalPrediction.js'));

  const evals = sampleSize;
  const startIdx = evals;
  if (draws.length < startIdx + 100) throw new Error('insufficient draws');

  // Stub backtestDecision to skip the inner runThreeStarMainBacktest in every iteration
  // (otherwise each iteration is O(N²) and 200 iters × 2 modes ~ 30+ minutes).
  // We pass three_star_main_enabled=false → uses fallback baseline scoring.
  // Both modes use SAME stub → fair comparison; trend-strategy still inherits this baseline.
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
  // walk forward from oldest evaluable to newest
  for (let i = startIdx; i >= 1; i--) {
    const trainDraws = draws.slice(i);  // newest in front, but only draws OLDER than target
    const target = draws[i - 1];        // the actual draw we evaluate against
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

    records.push({
      target_no: target.draw_no, single, two, three, four, five,
      hits: { single: hitSingle, two: hitTwo, three: hitThree, four: hitFour, five: hitFive },
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

  // Aggregate metrics
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
  let prevFive = null, prevThree = null, prevSingle = null;
  let consecutiveFiveRepeat = 0, maxFiveRepeat = 0;
  let pairRepeatPairs = 0, tripleRepeatPairs = 0;
  let singleRepeatPairs = 0;

  for (const r of records) {
    for (const n of r.five) numberHits[n]++;
    const fiveKey = r.five.slice().sort((a, b) => a - b).join(',');
    fiveCombos.add(fiveKey);
    fiveCounts[fiveKey] = (fiveCounts[fiveKey] ?? 0) + 1;
    threeCombos.add(r.three.slice().sort((a, b) => a - b).join(','));
    if (prevFive) {
      const overlap = r.five.filter((n) => prevFive.includes(n)).length;
      if (overlap >= 5) consecutiveFiveRepeat++; else consecutiveFiveRepeat = 0;
      maxFiveRepeat = Math.max(maxFiveRepeat, consecutiveFiveRepeat);
      // pair / triple repeat: 同一 pair/triple 在連續兩期都出現
      const arrA = prevFive.slice().sort((a, b) => a - b);
      const arrB = r.five.slice().sort((a, b) => a - b);
      const pairsA = new Set(); for (let i=0;i<arrA.length;i++) for (let j=i+1;j<arrA.length;j++) pairsA.add(`${arrA[i]},${arrA[j]}`);
      const pairsB = new Set(); for (let i=0;i<arrB.length;i++) for (let j=i+1;j<arrB.length;j++) pairsB.add(`${arrB[i]},${arrB[j]}`);
      for (const p of pairsB) if (pairsA.has(p)) pairRepeatPairs++;
      const triplesA = new Set(); for (let i=0;i<arrA.length;i++) for (let j=i+1;j<arrA.length;j++) for (let k=j+1;k<arrA.length;k++) triplesA.add(`${arrA[i]},${arrA[j]},${arrA[k]}`);
      const triplesB = new Set(); for (let i=0;i<arrB.length;i++) for (let j=i+1;j<arrB.length;j++) for (let k=j+1;k<arrB.length;k++) triplesB.add(`${arrB[i]},${arrB[j]},${arrB[k]}`);
      for (const t of triplesB) if (triplesA.has(t)) tripleRepeatPairs++;
    }
    if (prevSingle !== null && prevSingle === r.single) singleRepeatPairs++;
    prevFive = r.five; prevThree = r.three; prevSingle = r.single;
  }

  const coveredNumbers = Object.values(numberHits).filter((c) => c > 0).length;
  const top10 = Object.entries(numberHits).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const top10Sum = top10.reduce((s, [, c]) => s + c, 0);
  const totalSlots = N * 5;
  const top10Coverage = totalSlots > 0 ? top10Sum / totalSlots : 0;
  const distinctFive = fiveCombos.size;
  const distinctThree = threeCombos.size;
  const maxComboRepeat = Math.max(0, ...Object.values(fiveCounts));

  return {
    mode: modeName,
    sample_size: N,
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
    top10_coverage_ratio: round(top10Coverage),
    top10_numbers: top10.map(([n, c]) => ({ n: Number(n), c })),
    pair_repeat_consecutive: pairRepeatPairs,
    triple_repeat_consecutive: tripleRepeatPairs,
    single_repeat_consecutive: singleRepeatPairs,
    max_consecutive_five_repeat: maxFiveRepeat,
  };
}

function round(n) { return Math.round(n * 10000) / 10000; }

console.log(`[compare] sample_size=${sampleSize} on ${draws.length} draws`);
console.log('[compare] running BASELINE…');
const baseline = runMode('baseline', false);
console.log('[compare] running MULTI_STRATEGY_V1…');
const multi = runMode('multi_strategy_v1', true);

const report = {
  generated_at: new Date().toISOString(),
  sample_size: baseline.sample_size,
  baseline,
  multi_strategy_v1: multi,
  delta: {
    hit_rate_single: round(multi.hit_rate.single - baseline.hit_rate.single),
    hit_rate_two:    round(multi.hit_rate.two    - baseline.hit_rate.two),
    hit_rate_three:  round(multi.hit_rate.three  - baseline.hit_rate.three),
    hit_rate_four:   round(multi.hit_rate.four   - baseline.hit_rate.four),
    hit_rate_five:   round(multi.hit_rate.five   - baseline.hit_rate.five),
    distinct_five_combos: multi.distinct_five_combos - baseline.distinct_five_combos,
    distinct_three_combos: multi.distinct_three_combos - baseline.distinct_three_combos,
    coverage_01_39: multi.coverage_01_39 - baseline.coverage_01_39,
    top10_coverage_ratio: round(multi.top10_coverage_ratio - baseline.top10_coverage_ratio),
    pair_repeat_consecutive: multi.pair_repeat_consecutive - baseline.pair_repeat_consecutive,
    triple_repeat_consecutive: multi.triple_repeat_consecutive - baseline.triple_repeat_consecutive,
    single_repeat_consecutive: multi.single_repeat_consecutive - baseline.single_repeat_consecutive,
    max_combo_repeat: multi.max_combo_repeat - baseline.max_combo_repeat,
  },
};

const outPath = path.join(ROOT, 'compare-multi-strategy.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`[compare] report written to ${outPath}`);
console.log('');
console.log('==== SUMMARY ====');
console.log(JSON.stringify({ baseline: summary(baseline), multi: summary(multi), delta: report.delta }, null, 2));

function summary(r) {
  return {
    sample_size: r.sample_size,
    hit_rate: r.hit_rate,
    distinct_five_combos: r.distinct_five_combos,
    distinct_three_combos: r.distinct_three_combos,
    coverage_01_39: r.coverage_01_39,
    top10_coverage_ratio: r.top10_coverage_ratio,
    pair_repeat_consecutive: r.pair_repeat_consecutive,
    triple_repeat_consecutive: r.triple_repeat_consecutive,
    single_repeat_consecutive: r.single_repeat_consecutive,
    max_combo_repeat: r.max_combo_repeat,
  };
}
