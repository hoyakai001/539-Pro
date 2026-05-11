#!/usr/bin/env node
/**
 * scripts/observe-stats.js
 *
 * 讀 observe-log.jsonl，印出 rolling recent_10 / recent_20 / recent_30 統計，
 * 並標出三類紅旗：
 *   1. 固定核心群（同一群號碼霸榜）
 *   2. random 化（號碼分布過於平均、deterministic check 失敗）
 *   3. hit rate 崩掉（需要 actual_numbers 才能算 — 暫不在這裡）
 *
 * 用法：
 *   node scripts/observe-stats.js                    # 全部 label
 *   node scripts/observe-stats.js --label=local
 *   node scripts/observe-stats.js --label=preview
 *   node scripts/observe-stats.js --window=10        # 只看 recent_10
 *   node scripts/observe-stats.js --file=other.jsonl
 */
'use strict';
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=?(.*)$/);
  return m ? [m[1], m[2] || true] : [a, true];
}));
const FILE = path.resolve(__dirname, '..', args.file || 'observe-log.jsonl');
const LABEL_FILTER = args.label || null;
const FORCED_WINDOW = args.window ? Number(args.window) : null;

if (!fs.existsSync(FILE)) {
  console.error(`[stats] file not found: ${FILE}`);
  console.error('Run observe-prediction.js daily first.');
  process.exit(1);
}

const rows = fs.readFileSync(FILE, 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l))
  .filter(r => !LABEL_FILTER || r.label === LABEL_FILTER);

if (rows.length === 0) {
  console.error(`[stats] no rows match filter (label=${LABEL_FILTER})`);
  process.exit(1);
}

// chronological order: oldest first (sort by fetched_at)
rows.sort((a, b) => a.fetched_at.localeCompare(b.fetched_at));

// De-duplicate by target_date (keep latest fetch per day)
const byDate = new Map();
for (const r of rows) byDate.set(r.target_date || r.fetched_at.slice(0, 10), r);
const records = [...byDate.values()];

function aggregate(slice, name) {
  if (slice.length === 0) return null;
  const numberHits = {}; for (let n = 1; n <= 39; n++) numberHits[n] = 0;
  const singleCounts = {};
  const fiveCombos = new Set();
  const threeCombos = new Set();
  const pairCounts = {};
  let pairConsecutiveRepeat = 0, prevPairs = null;
  let singleConsecutiveRepeat = 0, prevSingle = null;
  for (const r of slice) {
    const five = (r.five_star || []).slice().sort((a,b)=>a-b);
    for (const n of five) numberHits[n] = (numberHits[n] || 0) + 1;
    fiveCombos.add(five.join(','));
    threeCombos.add((r.three_star||[]).slice().sort((a,b)=>a-b).join(','));
    singleCounts[r.single] = (singleCounts[r.single] || 0) + 1;
    const pairs = new Set();
    for (let i=0;i<five.length;i++) for (let j=i+1;j<five.length;j++) pairs.add(`${five[i]},${five[j]}`);
    for (const p of pairs) pairCounts[p] = (pairCounts[p] || 0) + 1;
    if (prevPairs) for (const p of pairs) if (prevPairs.has(p)) pairConsecutiveRepeat++;
    if (prevSingle !== null && prevSingle === r.single) singleConsecutiveRepeat++;
    prevPairs = pairs; prevSingle = r.single;
  }
  const top10 = Object.entries(numberHits).sort((a,b)=>b[1]-a[1]).slice(0, 10);
  const top5 = top10.slice(0, 5);
  const totalSlots = slice.length * 5;
  const hotTop10Ratio = totalSlots ? top10.reduce((s,[,c])=>s+c,0) / totalSlots : 0;
  const coverage = Object.values(numberHits).filter(c=>c>0).length;
  const maxSingleNumber = Math.max(...Object.values(singleCounts), 0);
  const maxPairCount = Math.max(0, ...Object.values(pairCounts));
  const CORE_GROUP = new Set([21,8,22,16,27]);
  const coreGroupHits = top5.reduce((s,[n,c])=>s + (CORE_GROUP.has(Number(n))?c:0), 0)
    + Object.entries(numberHits).reduce((s,[n,c])=>s + (CORE_GROUP.has(Number(n))?c:0), 0)
    - top5.reduce((s,[n,c])=>s + (CORE_GROUP.has(Number(n))?c:0), 0); // simpler: just sum all core group
  // simpler version
  const coreSum = Object.entries(numberHits).reduce((s,[n,c])=>s + (CORE_GROUP.has(Number(n))?c:0), 0);
  return {
    window: name,
    sample_size: slice.length,
    unique_singles: Object.keys(singleCounts).length,
    unique_five_combos: fiveCombos.size,
    unique_three_combos: threeCombos.size,
    coverage_01_39: coverage,
    hot_top10_ratio: round(hotTop10Ratio),
    max_single_repeat: maxSingleNumber,
    max_pair_count: maxPairCount,
    pair_consecutive_repeat: pairConsecutiveRepeat,
    single_consecutive_repeat: singleConsecutiveRepeat,
    core_group_count: coreSum,
    core_group_ratio: round(coreSum / Math.max(1, totalSlots)),
    top5_numbers: top10.slice(0,5).map(([n,c])=>({n:Number(n),c})),
  };
}

function round(n){return Math.round(n*1000)/1000;}

const WINDOWS = FORCED_WINDOW ? [['recent_' + FORCED_WINDOW, records.slice(-FORCED_WINDOW)]] : [
  ['recent_10', records.slice(-10)],
  ['recent_20', records.slice(-20)],
  ['recent_30', records.slice(-30)],
  ['all',       records],
];

console.log(`[stats] file=${FILE} label=${LABEL_FILTER||'(all)'} records=${records.length}`);
console.log('');
for (const [name, slice] of WINDOWS) {
  const r = aggregate(slice, name);
  if (!r) continue;
  console.log(`=== ${name} (sample=${r.sample_size}) ===`);
  console.log(`  unique_singles:           ${r.unique_singles}  (健康 recent_10 >= 7)`);
  console.log(`  unique_five_combos:       ${r.unique_five_combos}  (健康 recent_10 = 10、recent_30 >= 25)`);
  console.log(`  coverage_01_39:           ${r.coverage_01_39}  (健康 recent_30 >= 28)`);
  console.log(`  hot_top10_ratio:          ${r.hot_top10_ratio}  (健康 < 0.55；> 0.65 = 集中)`);
  console.log(`  max_single_repeat:        ${r.max_single_repeat}  (健康 recent_10 <= 3、recent_30 <= 6)`);
  console.log(`  max_pair_count:           ${r.max_pair_count}  (健康 recent_30 <= 6)`);
  console.log(`  pair_consecutive_repeat:  ${r.pair_consecutive_repeat}  (健康 = 0；> 0 = pair lock 沒生效)`);
  console.log(`  single_consecutive_repeat:${r.single_consecutive_repeat}  (健康 = 0)`);
  console.log(`  core_group_count(21/8/22/16/27): ${r.core_group_count}  ratio=${r.core_group_ratio}`);
  console.log(`     (健康 ratio < 0.18；> 0.25 = 核心群霸榜)`);
  console.log(`  top5 numbers: ${r.top5_numbers.map(x=>`${x.n}(${x.c})`).join(', ')}`);

  // Red flags
  const flags = [];
  if (r.sample_size >= 10 && r.unique_singles < r.sample_size * 0.6) flags.push('⚠ unique_singles 過少 → 可能固定核心群');
  if (r.hot_top10_ratio > 0.65) flags.push('⚠ hot_top10_ratio 過高 → hot dominance');
  if (r.core_group_ratio > 0.25) flags.push('⚠ core_group_ratio > 0.25 → 21/8/22/16/27 霸榜');
  if (r.pair_consecutive_repeat > 0) flags.push('⚠ pair_consecutive_repeat > 0 → pair lock 失效');
  if (r.single_consecutive_repeat > 0) flags.push('⚠ single_consecutive_repeat > 0 → single rotation 失效');
  if (r.sample_size >= 14 && r.coverage_01_39 >= 38 && r.hot_top10_ratio < 0.30) flags.push('⚠ 過度平均（coverage 滿 + hot_ratio 極低）→ 可能 random 化');
  if (flags.length) {
    console.log(`  RED FLAGS:`);
    for (const f of flags) console.log(`    ${f}`);
  } else if (r.sample_size >= 10) {
    console.log(`  ✓ no red flags`);
  }
  console.log('');
}
