#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const perf = fs.readFileSync(path.join(ROOT, 'backend/src/engine/strategyPerformance.ts'), 'utf8');
const routes = fs.readFileSync(path.join(ROOT, 'backend/src/api/routes.ts'), 'utf8');
const card = fs.readFileSync(path.join(ROOT, 'frontend/src/components/HitPerformanceCard.tsx'), 'utf8');

function check(ok, message) {
  if (!ok) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

for (const token of [
  'week',
  'previous_week',
  'month',
  'previous_month',
  '資料不足',
  '樣本偏少，僅供參考',
  'single_hit_count',
  'two_star_hit_count',
  'three_star_hit_count',
  'four_star_hit_count',
  'five_star_hit_count',
  'hitRateSingle',
  'hitRateTwo',
  'hitRateThree',
  'hitRateFour',
  'hitRateFive',
]) {
  check(perf.includes(token), `strategy performance period token missing: ${token}`);
}
check(perf.includes('isEvaluatedObservation') && perf.includes('actual_numbers') && perf.includes('three_star_hits'), 'pending observations must be excluded from period statistics');
check(perf.includes("previous_week: computePeriod('previous_week', '上週'") && perf.includes('addDaysIso(weekStart, -7)') && perf.includes('addDaysIso(weekStart, -1)'), 'previous week period must be the previous full Monday-Sunday week');
check(perf.includes('threeStarHit(row)') && perf.includes('fourStarHit(row)') && perf.includes('fiveStarHit(row)'), 'star hit counts must use strict all-number hit helpers');
check(perf.includes('startOfWeekIso') && perf.includes('Asia/Taipei'), 'week range must be based on Taiwan time');
check(routes.includes('getStats(Math.max(safeWindow, 60))'), 'cloud performance must use bounded 60-observation read for period stats');
check(routes.includes('period_anchor'), 'performance cache must include a daily period anchor');
check(routes.includes('isStrictPerformancePayload') && routes.includes('previous_week') && routes.includes('hitRateSingle'), 'old performance cache without strict fields must be rebuilt');
check(routes.includes('hasPeriodRecords') && routes.includes('recent_records'), 'old performance cache without period-filtered records must be rebuilt');
check(!/collection\('observation_logs'\)[\s\S]*\.get\(\)/.test(routes), 'routes must not scan full observation_logs collection');
check(card.includes("['week', '本週']") && card.includes("['previous_week', '上週']") && card.includes("['month', '本月']") && card.includes("['previous_month', '上月']"), 'UI period tabs missing');
check(card.includes('僅統計已完成開獎的預測紀錄，未開獎資料不列入統計。'), 'plain-language statistics description missing');
check(card.includes('此期間尚無已完成開獎的預測紀錄。'), 'empty period message missing');
check(!/evaluation|observation logs|pending/.test(card), 'UI must not show technical evaluation/observation/pending wording');
check(card.includes('⚠ 目前樣本較少，統計結果可能不穩定。'), 'low-sample warning text missing');
check(card.includes('獨支命中率') && card.includes('二星命中率') && card.includes('三星命中率') && card.includes('四星命中率') && card.includes('五星命中率'), 'UI must render single/two/three/four/five hit rates');
check(card.includes('獨支命中次數') && card.includes('二星命中次數') && card.includes('五星命中次數'), 'UI must render hit counts for period stats');
check(card.includes('最高全中星級') && card.includes('highestFullStarFromPeriod') && card.includes('return 0;') && card.includes('starText'), 'UI must render highest full-hit star with star unit and return 0 when no group fully hits');
check((card.match(/md:grid-cols-5/g) || []).length >= 2 && card.includes('md:grid-cols-3'), 'hit statistics must be grouped into summary, hit-rate, and hit-count rows');
check(
  card.includes('HitBadge label="獨支"') &&
  card.includes('HitBadge label="二星"') &&
  card.includes('HitBadge label="三星"') &&
  card.includes('HitBadge label="四星"') &&
  card.includes('HitBadge label="五星"'),
  'recent records must render strict hit statuses',
);
check(perf.includes('recent_records: scoped.slice(0, 10).map(toPerformanceRecord)'), 'period history rows must come from the same scoped period dataset');
check(card.includes('const periodRecords = period?.recent_records ?? []') && card.includes('periodRecords.map') && !card.includes('performance.recent_records.map'), 'UI history rows must use current period records');
check(card.includes('period && period.sample_size > 0'), 'history rows must be hidden when the current period has no data');
check(!card.includes('命中幾顆') && !card.includes('交集命中') && !card.includes('平均命中'), 'UI must not show intersection hit count or average-hit wording');
check(!card.includes('cache=') && !card.includes('latest_used_draw_no=') && !card.includes('prediction_updated_at='), 'PredictionCard must not render raw debug cache fields');
const hitRateLabelCount = (card.match(/命中率/g) || []).length;
check(hitRateLabelCount === 5, `hit-rate labels should appear once as one summary group, found ${hitRateLabelCount}`);
check(card.includes('下注建議表現') && card.includes('強攻') && card.includes('小攻') && card.includes('觀望'), 'advice performance UI missing');
check(card.includes('樣本：{data.sample_size}') && card.includes('最高全中：{starText(highestFullStarFromAdvice(data))}'), 'advice performance should be simplified to sample count and highest full-hit star');
check(!/Math\.random/.test(perf + routes + card), 'Math.random must not be used');

console.log('[PASS] weekly/monthly hit statistics are evaluated-only, strict, bounded, cached, and rendered in the UI');
