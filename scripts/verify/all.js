#!/usr/bin/env node
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const http = require('http');

const NODE = process.execPath;
const DIR = __dirname;
const PORT = process.env.PORT || 3001;

const STATIC_SCRIPTS = [
  ['no-mock', 'no-mock.js'],
  ['no-fake-data', 'no-fake-data.js'],
  ['no-hardcoded-data', 'no-hardcoded-data.js'],
  ['cloud-config', 'cloud-config.js'],
  ['data-integrity', 'data-integrity.js'],
  ['ui-no-static-data', 'ui-no-static-data.js'],
  ['pilio-source', 'pilio-source.js'],
  ['user-ui-clean', 'user-ui-clean.js'],
  ['admin-auth-ui', 'admin-auth-ui.js'],
  ['sync-button', 'sync-button.js'],
  ['sync-permission', 'sync-permission.js'],
  ['sync-logs-ui', 'sync-logs-ui.js'],
  ['cron-sync', 'cron-sync.js'],
  ['backtest-no-future-leak', 'backtest-no-future-leak.js'],
  ['antihot', 'antihot.js'],
  ['antihot-selection-penalty', 'antihot-selection-penalty.js'],
  ['recent-weighted-scoring', 'recent-weighted-scoring.js'],
  ['combo-fatigue', 'combo-fatigue.js'],
  ['recommendation-diversity', 'recommendation-diversity.js'],
  ['pair-smoothing', 'pair-smoothing.js'],
  ['freshness-balance', 'freshness-balance.js'],
  ['combo-support', 'combo-support.js'],
  ['firestore-limit', 'firestore-limit.js'],
  ['cache', 'cache.js'],
  ['quota-handler', 'quota-handler.js'],
  ['hit-performance-periods', 'hit-performance-periods.js'],
  ['hit-definition', 'hit-definition.js'],
  ['local-mode', 'local-mode.js'],
  ['cloud-mode', 'cloud-mode.js'],
  ['local-cloud-consistency', 'local-cloud-consistency.js'],
  ['strategy-docs', 'strategy-docs.js'],
  ['cloud-deploy-docs', 'cloud-deploy-docs.js'],
  ['docs-api', 'docs-api.js'],
  ['vercel-build', 'vercel-build.js'],
];

const NETWORK_SCRIPTS = [
  ['html-fetch', 'html-fetch.js', [0, 2]],
];

const BACKEND_SCRIPTS = [
  ['data-status', 'data-status.js'],
  ['sync-required', 'sync-required.js'],
  ['config-required', 'config-required.js'],
  ['admin-debug-lock', 'admin-debug-lock.js'],
  ['admin-reset', 'admin-reset.js'],
  ['admin-auth', 'admin-auth.js'],
  ['history-audit', 'history-audit.js'],
  ['backtest-integrity', 'backtest-integrity.js'],
  ['two-star-stats', 'two-star-stats.js'],
  ['score-breakdown', 'score-breakdown.js'],
  ['prediction-lock', 'prediction-lock.js'],
  ['prediction-target-future', 'prediction-target-future.js'],
  ['bet-advice', 'bet-advice.js'],
  ['sorted-numbers', 'sorted-numbers.js'],
  ['balance-model', 'balance-model.js'],
  ['advanced-stats', 'advanced-stats.js'],
  ['three-star-core', 'three-star-core.js'],
  ['three-star-main-model', 'three-star-main-model.js'],
  ['three-star-backtest', 'three-star-backtest.js'],
  ['hot-control', 'hot-control.js'],
  ['gap-reversion', 'gap-reversion.js'],
  ['overheat-balance', 'overheat-balance.js'],
  ['bet-advice-balanced', 'bet-advice-balanced.js'],
  ['draw-profile', 'draw-profile.js'],
  ['recent-stats', 'recent-stats.js'],
  ['score-normalization', 'score-normalization.js'],
  ['observation-30', 'observation-30.js'],
  ['observation-evaluation', 'observation-evaluation.js'],
  ['performance-api', 'performance-api.js'],
  ['firebase-connection', 'firebase-connection.js'],
  ['migrate-firestore', 'migrate-firestore.js'],
  ['cloud-bootstrap-history', 'cloud-bootstrap-history.js'],
  ['overheat-penalty', 'overheat-penalty.js'],
  ['combination-repeat', 'combination-repeat.js'],
  ['miss-penalty', 'miss-penalty.js'],
  ['number-analysis-ui', 'number-analysis-ui.js'],
  ['number-analysis-summary-ui', 'number-analysis-summary-ui.js'],
  ['retry-recovery', 'retry-recovery.js'],
];

function run(file, allowCodes = [0]) {
  const result = spawnSync(NODE, [path.join(DIR, file)], {
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  });
  return allowCodes.includes(result.status);
}

function isBackendUp() {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${PORT}/health`, { timeout: 2000 }, res => {
      res.resume();
      resolve(res.statusCode && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

(async () => {
  let failures = 0;
  console.log('='.repeat(60));
  console.log('verify:all');
  console.log('='.repeat(60));

  for (const [name, file] of STATIC_SCRIPTS) {
    console.log(`\n--- ${name} ---`);
    if (!run(file)) {
      console.error(`[FAIL] ${name}`);
      failures++;
    }
  }

  for (const [name, file, allowCodes] of NETWORK_SCRIPTS) {
    console.log(`\n--- ${name} ---`);
    if (!run(file, allowCodes)) {
      console.error(`[FAIL] ${name}`);
      failures++;
    }
  }

  if (await isBackendUp()) {
    for (const [name, file] of BACKEND_SCRIPTS) {
      console.log(`\n--- ${name} ---`);
      if (!run(file)) {
        console.error(`[FAIL] ${name}`);
        failures++;
      }
    }
  } else {
    console.warn(`\n[SKIP] backend is not running on localhost:${PORT}; backend verify scripts were skipped`);
  }

  console.log('\n' + '='.repeat(60));
  if (failures) {
    console.error(`[FAIL] verify:all had ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('[PASS] verify:all completed');
})();
