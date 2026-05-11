#!/usr/bin/env node
/**
 * scripts/observe-prediction.js
 *
 * 抓 /api/prediction/today，append 一行到 observe-log.jsonl。
 * 用途：每天台灣時間 22:00 後跑一次，累積 14+ 天 prediction，用 observe-stats.js 算 rolling 指標。
 *
 * 用法：
 *   API_URL=http://localhost:3001 LABEL=local node scripts/observe-prediction.js
 *   API_URL=https://539-pro-git-preview-xxx.vercel.app LABEL=preview node scripts/observe-prediction.js
 *
 * 預設值：API_URL=http://localhost:3001，LABEL=local，輸出 observe-log.jsonl。
 * 不會覆寫既有檔案；只 append 一行 JSON。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const API_URL = process.env.API_URL || 'http://localhost:3001';
const LABEL = process.env.LABEL || 'local';
const OUT = path.resolve(__dirname, '..', process.env.OUT_FILE || 'observe-log.jsonl');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

(async () => {
  const url = `${API_URL.replace(/\/$/, '')}/api/prediction/today`;
  const j = await fetchJson(url);
  const p = j.data || j;
  const ss = p.strategy_scores || {};
  const row = {
    fetched_at: new Date().toISOString(),
    label: LABEL,
    target_date: p.target_date,
    latest_used_draw_no: p.latest_used_draw_no,
    single: p.single,
    two_star: p.two_star,
    three_star: p.three_star,
    four_star: p.four_star,
    five_star: p.five_star,
    ensemble_voting_enabled: ss.ensemble_voting_enabled === true,
    ensemble_voting_version: ss.ensemble_voting_version ?? null,
    schema: ss.anti_hot_selection_schema ?? p.anti_hot_selection_schema ?? null,
    counters: {
      dominance: ss.dominance_penalty_applied ?? null,
      pair_lock: ss.pair_lock_penalty_applied ?? null,
      triple_lock: ss.triple_lock_penalty_applied ?? null,
      exposure: ss.exposure_penalty_applied ?? null,
      core_group: ss.core_group_penalty_applied ?? null,
      hot_top10: ss.hot_top10_penalty_applied ?? null,
      consensus_protected: ss.consensus_protected_count ?? null,
    },
    trend_only_count: ss.trend_only_count ?? null,
    trend_only_ratio: ss.trend_only_ratio ?? null,
  };
  fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
  console.log(`[observe] appended ${LABEL} prediction for ${p.target_date} (single=${p.single}, five=${JSON.stringify(p.five_star)}) → ${OUT}`);
})().catch((e) => { console.error('[observe] ERROR:', e.message); process.exit(1); });
