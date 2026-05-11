#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const PORT = process.env.PORT || 3001;

function request(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}${pathname}`, { timeout: 10000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function subset(a, b) {
  return a.every(n => b.includes(n));
}

(async () => {
  const res = await request('/api/prediction/today');
  if (!res.success || !res.data) throw new Error('prediction missing');
  const p = res.data;
  if (!Array.isArray(p.two_star) || p.two_star.length !== 2) throw new Error('two_star must contain 2 numbers');
  if (!Array.isArray(p.three_star) || p.three_star.length !== 3) throw new Error('three_star must contain 3 numbers');
  if (!Array.isArray(p.four_star) || p.four_star.length !== 4) throw new Error('four_star must contain 4 numbers');
  if (!Array.isArray(p.five_star) || p.five_star.length !== 5) throw new Error('five_star must contain 5 numbers');
  if (p.strategy_scores?.three_star_main_enabled === true) {
    if (!subset(p.two_star, p.three_star)) throw new Error('three-star must be generated from the selected core two-star pair');
  }
  if (!subset(p.three_star, p.four_star)) throw new Error('four-star must extend three-star');
  if (!subset(p.four_star, p.five_star)) throw new Error('five-star must extend four-star');

  const s = p.three_star_summary;
  if (!s) throw new Error('three_star_summary missing');
  const componentFields = ['main_pair_score', 'third_number_pair_support_score', 'triple_history_score', 'number_strength_score', 'gap_reversion_score', 'balance_overheat_score', 'three_star_score'];
  for (const field of componentFields) {
    if (typeof s[field] !== 'number' || !Number.isFinite(s[field])) throw new Error(`three_star_summary.${field} invalid`);
  }
  if (s.weights_total !== 1) throw new Error('three-star component weights must total 1');
  if (p.strategy_scores?.three_star_main_enabled === true) {
    for (const source of ['historical100', 'topPairExtension', 'active30']) {
      if (!s.candidate_sources.includes(source)) throw new Error(`candidate source missing: ${source}`);
    }
    if (!Array.isArray(s.top_candidates) || s.top_candidates.length < 5) throw new Error('top three-star candidates missing');
  } else {
    if (!Array.isArray(s.candidate_sources) || !s.candidate_sources.includes('stableRecentMode')) {
      throw new Error('fallback mode must declare candidate source stableRecentMode');
    }
    if (!Array.isArray(s.top_candidates) || s.top_candidates.length < 1) throw new Error('fallback mode must still expose at least one candidate');
  }

  const source = fs.readFileSync(path.resolve(__dirname, '../../backend/src/engine/AdvancedStatsModel.ts'), 'utf8');
  for (const token of ['buildThreeStarCandidates', 'scoreThreeStarCandidate', 'normalizedPairScore', 'extendCombination', 'THREE_STAR_WEIGHTS']) {
    if (!source.includes(token)) throw new Error(`three-star core source missing ${token}`);
  }
  if (source.includes('Math.random')) throw new Error('Math.random must not be used');
  console.log('[PASS] three-star core uses required sources, six weighted components, and sequential four/five extension');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
