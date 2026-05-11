#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const sourcePath = path.join(ROOT, 'backend/src/engine/strategyPerformance.ts');
const distPath = path.join(ROOT, 'backend/dist/engine/strategyPerformance.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function check(ok, message) {
  if (!ok) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

check(source.includes('function singleHit'), 'single strict hit helper missing');
check(source.includes('function twoStarHit'), 'two-star strict hit helper missing');
check(source.includes('function threeStarHit'), 'three-star strict hit helper missing');
check(source.includes('function fourStarHit'), 'four-star strict hit helper missing');
check(source.includes('function fiveStarHit'), 'five-star strict hit helper missing');
check(source.includes('pick.length === 3') && source.includes('pick.length === 4') && source.includes('pick.length === 5'), 'star helpers must require full group size');
check(source.includes('Number(row.three_star_hits ?? 0) >= 3'), 'three-star fallback must require 3/3');
check(source.includes('Number(row.four_star_hits ?? 0) >= 4'), 'four-star fallback must require 4/4');
check(source.includes('Number(row.five_star_hits ?? 0) >= 5'), 'five-star fallback must require 5/5');
check(!/Math\.random/.test(source), 'Math.random must not be used');

if (fs.existsSync(distPath)) {
  const { computeStrategyPerformance } = require(distPath);
  const rows = [
    {
      target_draw_no: 'A',
      target_date: todayIso(),
      selected_single: 8,
      selected_two_star: [8, 27],
      selected_three_star: [8, 22, 27],
      selected_four_star: [8, 16, 24, 27],
      selected_five_star: [8, 16, 24, 27, 37],
      actual_numbers: [8, 16, 24, 27, 37],
      single_hit: 1,
      two_star_hit: 1,
      three_star_hits: 2,
      four_star_hits: 4,
      five_star_hits: 5,
      advice_level: 'SMALL',
    },
    {
      target_draw_no: 'B',
      target_date: todayIso(),
      selected_single: 9,
      selected_two_star: [1, 9],
      selected_three_star: [1, 2, 3],
      selected_four_star: [1, 2, 3, 4],
      selected_five_star: [1, 2, 3, 4, 5],
      actual_numbers: [1, 2, 3, 4, 5],
      single_hit: 0,
      two_star_hit: 0,
      three_star_hits: 3,
      four_star_hits: 4,
      five_star_hits: 5,
      advice_level: 'WATCH',
    },
    {
      target_draw_no: 'PENDING',
      target_date: todayIso(),
      selected_single: 1,
      selected_two_star: [1, 2],
      selected_three_star: [1, 2, 3],
      selected_four_star: [1, 2, 3, 4],
      selected_five_star: [1, 2, 3, 4, 5],
      actual_numbers: null,
      three_star_hits: null,
      five_star_hits: null,
    },
  ];
  const data = computeStrategyPerformance(rows, 3);
  check(data.sample_size === 2, 'pending observation must not be counted');
  check(data.pending_count === 1, 'pending count must be preserved');
  check(data.single_hit_count === 1 && data.hitRateSingle === 0.5, 'single hit must require 1/1');
  check(data.two_star_hit_count === 1 && data.hitRateTwo === 0.5, 'two-star hit must require 2/2');
  check(data.three_star_hit_count === 1 && data.hitRateThree === 0.5, 'three-star hit must require 3/3; 2/3 is not a hit');
  check(data.four_star_hit_count === 2 && data.hitRateFour === 1, 'four-star hit must require 4/4');
  check(data.five_star_hit_count === 2 && data.hitRateFive === 1, 'five-star hit must require 5/5');
  check(data.recent_records[0].three_star_hit === false && data.recent_records[0].hit_count === 5, 'partial three-star hit must remain miss while average hit count is kept');
}

console.log('[PASS] strict hit definition verifies single 1/1, two 2/2, three 3/3, four 4/4, five 5/5, and excludes pending records');

function todayIso() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
