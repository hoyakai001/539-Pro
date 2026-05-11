#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];

function check(name, ok) {
  checks.push({ name, ok });
}

const routes = read('backend/src/api/routes.ts');
const helper = read('backend/src/stats/comboSupport.ts');
const dashboard = read('frontend/src/components/Dashboard.tsx');
const predictionCard = read('frontend/src/components/PredictionCard.tsx');
const comboCard = read('frontend/src/components/ComboSupportCard.tsx');
const client = read('frontend/src/api/client.ts');
const types = read('frontend/src/types.ts');
const pkg = JSON.parse(read('package.json'));
const all = read('scripts/verify/all.js');
const enginePrediction = read('backend/src/engine/statisticalPrediction.ts');
const engineModel = read('backend/src/engine/AdvancedStatsModel.ts');
const removedComboLabel = '4' + '+3';
const removedComboField = ['four', 'plus', 'three'].join('_');
const comboFiles = [helper, comboCard].join('\n');

check('combo helper exists', helper.includes('buildComboSupportSummary'));
check('prediction response carries display-only combo_support_summary', routes.includes('combo_support_summary') || routes.includes('withComboSupport'));
check('Dashboard renders ComboSupportCard below PredictionCard', /<PredictionCard[\s\S]*<ComboSupportCard[\s\S]*<HitPerformanceCard/.test(dashboard));
check('Dashboard passes existing performance data only', dashboard.includes('performance={state.performance}') && !client.includes('combo-support') && !client.includes('comboSupport'));
check('removed type/tracking sentence from PredictionCard', !predictionCard.includes('型態：') && !predictionCard.includes('三星追蹤：'));
check('removed extension combo from display helper, UI, types, and verify expectations', !helper.includes(removedComboLabel) && !comboCard.includes(removedComboLabel) && !types.includes(removedComboLabel) && !types.includes(removedComboField));
check('UI displays only requested support rows', ['2+2', '3+2', '3+3', '4+4'].every(label => comboCard.includes(label)));
check('2+2 and 3+2 have short-term display logic', comboCard.includes('two_plus_two_short') && comboCard.includes('three_plus_two_short') && helper.includes("mode === 'short'"));
check('short-term supports Top4 display only', helper.includes('.slice(0, 4)') && comboCard.includes('SHORT_LIMIT = 4') && comboCard.includes('.slice(0, SHORT_LIMIT)'));
check('support count is raw co-occurrence minus one', helper.includes('function supportCount(') && helper.includes('Math.max(0, safeCount(item, window) - 1)') && comboCard.includes('Math.max(0, count(item, window) - 1)'));
check('primary support shows when any display window has support_count > 0', helper.includes('supportOrNull(twoRanked[0] ?? null)') && helper.includes('supportOrNull(threePairRanked[0] ?? null)') && helper.includes('supportOrNull(threeItem)') && helper.includes('WINDOWS.some(window => supportCount(item, window) > 0)') && comboCard.includes('hasAnySupport(item)'));
check('4+4 keeps one 30-draw co-occurrence threshold', helper.includes('safeCount(fourItem, 30) > 0') && comboCard.includes('displayableMainItem(item, 1, Boolean(fourFour))'));
check('4+4 still displays raw 30-draw count', comboCard.includes('rawCount = false') && comboCard.includes('rawCount ? count(item, 30) >= min30 : hasAnySupport(item)') && comboCard.includes('30期${count(displayItem, 30)}次'));
check('short-term supports require support_count >= 1', helper.includes('supportCount(item, 5) >= 1 || supportCount(item, 10) >= 1') && comboCard.includes('supportCount(item, 5) >= 1 || supportCount(item, 10) >= 1'));
check('short-term list excludes the primary combo and disappears without a second combo', comboCard.includes('visibleShortSupportItems') && comboCard.includes('formatNumbers(item.numbers) !== mainKey') && comboCard.includes('visibleShortItems.length > 0'));
check('3+3 has no short-term field', !comboCard.includes('three_plus_three_short') && !helper.includes('three_plus_three_short') && !types.includes('three_plus_three_short'));
check('4+4 can render no-data state', comboCard.includes('fourFour') && comboCard.includes('>無</div>'));
check('UI uses safe count fallback for all windows', comboCard.includes('function count(') && comboCard.includes('DISPLAY_WINDOWS') && comboCard.includes('Number.isFinite(value) ? value : 0'));
check('main counts use support period labels', comboCard.includes('`${window}期支撐${supportCount(item, window)}`'));
check('UI does not render debug parenthesized full counts', !/（\$\{countsText\(item\)\}|\\\(\d+\s*\/\s*\d+\s*\/\s*\d+\s*\/\s*\d+\s*\/\s*\d+\\\)/.test(comboCard));
check('short-term display is limited to positive 5/10 support labels', comboCard.includes('window <= 10') && comboCard.includes('row.value > 0') && comboCard.includes('期支撐'));
check('short-term single co-occurrence is filtered out', comboCard.includes('isShortRepeatSupport') && helper.includes('isShortRepeatSupport') && !helper.includes('safeCount(item, 5) > 0 || safeCount(item, 10) > 0') && !comboCard.includes('count(item, 5) >= 2 || count(item, 10) >= 2'));
check('helper completes all window counts', helper.includes('completeCounts') && helper.includes('finiteCount') && helper.includes('isComboSupportSummaryComplete'));
check('combo support explanation states support-count definition and display-only behavior', comboCard.includes('支撐次數 = 共同出現次數 - 1') && comboCard.includes('任一窗口需至少支撐1次才顯示') && comboCard.includes('不影響本日抓牌結果'));
check('PredictionCard includes soft red display-only combo support note', predictionCard.includes('組合支撐分析為歷史共現參考，不影響本日抓牌結果') && predictionCard.includes('text-rose-500') && predictionCard.includes('dark:text-rose-300'));
check('UI guards against undefined/null/NaN display', comboCard.includes('safeAdvice') && comboCard.includes('safeLevel') && comboCard.includes('safeHeat') && !comboCard.includes('undefined') && !comboCard.includes('NaN'));
check('reference_advice exists and has fallback', helper.includes('reference_advice') && types.includes('reference_advice') && comboCard.includes('support.reference_advice') && comboCard.includes("小攻（一般）"));
check('cached invalid combo summary is rebuilt with limited draw read', routes.includes('isComboSupportSummaryComplete') && routes.includes('adapter.getDraws(30)'));
check('reference_advice does not overwrite original betting recommendation', !routes.includes('bet_advice =') && !routes.includes('bet_advice: buildReferenceAdvice') && helper.includes('originalLevel'));
check('frontend has no extra combo support API call', !client.includes('combo-support') && !client.includes('comboSupport'));
check('number scores are not modified by combo support helper', !helper.includes('number_scores') && !helper.includes('numberScores'));
check('prediction main result keys are not reassigned by combo support', !helper.includes('single_number') && !helper.includes('two_star =') && !helper.includes('three_star =') && !helper.includes('five_star ='));
check('strategy engine files are not importing combo support helper', !enginePrediction.includes('comboSupport') && !engineModel.includes('comboSupport'));
check('cloud mode avoids full draw scan for combo support', !routes.includes('adapter.getDraws()') && routes.includes('adapter.getDraws(30)'));
check('no random/fake/mock/demo text in combo files', !/Math\.random|fake|mock|demo/i.test(comboFiles));
check('verify script registered in package.json', pkg.scripts && pkg.scripts['verify:combo-support'] === 'node scripts/verify/combo-support.js');
check('verify:all includes combo-support', all.includes("['combo-support', 'combo-support.js']"));

const failed = checks.filter(item => !item.ok);
for (const item of checks) {
  console.log(`${item.ok ? '[PASS]' : '[FAIL]'} ${item.name}`);
}
if (failed.length) {
  console.error(`verify:combo-support failed (${failed.length})`);
  process.exit(1);
}
console.log('[PASS] verify:combo-support');
