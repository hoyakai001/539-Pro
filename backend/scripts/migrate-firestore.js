#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const Database = require('better-sqlite3');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const BACKEND_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(BACKEND_DIR, '..');
const REQUIRED_FIREBASE_ENV = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
];

loadEnv();

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const yes = args.has('--yes');
const scope = resolveMigrationScope();

main().catch(error => {
  console.error(`[migrate:firestore] ${error.message}`);
  process.exit(1);
});

async function main() {
  if (!dryRun && !yes) {
    throw new Error('refusing to write Firestore without --yes. Use --dry-run to inspect counts first.');
  }
  if (!dryRun && scope.mode === 'all' && !args.has('--confirm-all-history')) {
    throw new Error('refusing all-history Firestore migration without --confirm-all-history. Prefer --recent=150 or --year=YYYY.');
  }
  const missing = REQUIRED_FIREBASE_ENV.filter(name => !process.env[name]);
  if (missing.length) throw new Error(`missing Firebase env: ${missing.join(', ')}`);

  const dbPath = resolveSqlitePath();
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
  const snapshot = readSqliteSnapshot(sqlite);
  const plan = {
    sqlite_db_path: dbPath,
    dry_run: dryRun,
    counts: snapshot.counts,
    scope,
    admin_exists: snapshot.adminHash !== null,
    collections: snapshot.collections,
  };

  if (dryRun) {
    console.log(JSON.stringify(plan, null, 2));
    sqlite.close();
    return;
  }

  const firestore = getFirestoreDb();
  const result = {
    sqlite_db_path: dbPath,
    sqlite: snapshot.counts,
    firestore: {
      draws: await upsertDocs(firestore, 'draws', snapshot.draws),
      predictions: await upsertDocs(firestore, 'predictions', snapshot.predictions),
      observation_logs: await upsertDocs(firestore, 'observation_logs', snapshot.observationLogs),
      admin: await upsertDocs(firestore, 'admin', snapshot.adminDocs),
      sync_logs: await upsertDocs(firestore, 'sync_logs', snapshot.syncLogs),
      system_status: await upsertDocs(firestore, 'system_status', snapshot.systemStatus),
    },
  };
  result.validation = await validateFirestore(firestore, snapshot);
  sqlite.close();
  console.log(JSON.stringify(result, null, 2));
}

function loadEnv() {
  dotenv.config({ path: path.join(ROOT_DIR, '.env'), override: false });
  dotenv.config({ path: path.join(BACKEND_DIR, '.env'), override: false });
}

function resolveSqlitePath() {
  const candidates = [
    process.env.DB_PATH,
    path.join(ROOT_DIR, 'backend', 'data', '539.db'),
    path.join(ROOT_DIR, 'data', '539.db'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(ROOT_DIR, candidate);
    if (fs.existsSync(absolute)) return absolute;
  }
  throw new Error(`SQLite DB not found. Checked: ${candidates.join(', ')}`);
}

function readSqliteSnapshot(db) {
  const selectedDrawRows = selectDrawRows(tableRows(db, 'draws'));
  const oldestSelectedDate = selectedDrawRows[selectedDrawRows.length - 1]?.draw_date || '';
  const selectedDrawNos = new Set(selectedDrawRows.map(row => String(row.draw_no)));
  const draws = selectedDrawRows.map(row => ({
    id: safeDocId(row.draw_no),
    data: {
      draw_no: String(row.draw_no),
      draw_date: String(row.draw_date),
      date: String(row.draw_date),
      numbers: parseNumbers(row.numbers_json, `draws.${row.draw_no}.numbers_json`),
      source: String(row.source || 'official'),
      source_url: row.source_url || null,
      verified: Number(row.verified) === 1,
      verified_by_pilio: Number(row.verified_by_pilio || 0) === 1,
      audit_status: row.audit_status || null,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
    },
  }));
  for (const doc of draws) validateDrawDoc(doc.data);

  const predictions = dedupeDocs(tableRows(db, 'predictions')
    .filter(row => shouldKeepTargetRow(row, oldestSelectedDate, selectedDrawNos))
    .map(row => {
    const modelVersion = String(row.model_version || 'v6.1-three-star-stable');
    const id = safeDocId(`${row.target_draw_no || row.target_date || row.id}_${modelVersion}`);
    const betAdvice = parseJson(row.bet_advice_json, null);
    const numberScores = parseJson(row.number_scores_json, []);
    return {
      id,
      data: {
        sqlite_id: Number(row.id),
        target_draw_no: row.target_draw_no || null,
        target_date: row.target_date || null,
        latest_used_draw_no: row.latest_used_draw_no || null,
        latest_used_draw_date: row.latest_used_draw_date || null,
        model_version: modelVersion,
        version: Number(row.version || 1),
        locked: Number(row.locked ?? 1) === 1,
        single: nullableNumber(row.single_number),
        single_number: nullableNumber(row.single_number),
        numbers: parseJson(row.numbers_json, []),
        two_star: parseJson(row.two_star_json, []),
        three_star: parseJson(row.three_star_json, []),
        four_star: parseJson(row.four_star_json, []),
        five_star: parseJson(row.five_star_json, []),
        number_scores_json: numberScores,
        number_scores: numberScores,
        strategy_scores: parseJson(row.strategy_scores_json, {}),
        scores: parseJson(row.scores_json, {}),
        strategy: row.strategy || null,
        bet_advice: betAdvice,
        confidence: row.confidence_label || betAdvice?.confidence || null,
        recommendation: row.recommendation || betAdvice?.label || null,
        data_status: row.data_status || null,
        created_at: row.created_at || null,
      },
    };
  }));

  const observationLogs = tableRows(db, 'strategy_observation_logs')
    .filter(row => shouldKeepTargetRow(row, oldestSelectedDate, selectedDrawNos))
    .map(row => {
    const modelVersion = String(row.model_version || 'v6.1-three-star-stable');
    const id = safeDocId(`${row.target_draw_no || row.target_date || row.id}_${modelVersion}`);
    return {
      id,
      data: {
        sqlite_id: Number(row.id),
        prediction_id: row.prediction_id ?? null,
        model_version: modelVersion,
        target_draw_no: row.target_draw_no || null,
        target_date: row.target_date || null,
        selected_single: nullableNumber(row.selected_single),
        selected_two_star: parseJson(row.selected_two_star, []),
        selected_three_star: parseJson(row.selected_three_star, []),
        selected_four_star: parseJson(row.selected_four_star, []),
        selected_five_star: parseJson(row.selected_five_star, []),
        three_star: parseJson(row.selected_three_star, []),
        advice_label: row.advice_label || null,
        advice_level: row.advice_level || null,
        advice: row.advice_label || null,
        confidence: row.confidence || null,
        draw_profile: row.draw_profile || null,
        actual_numbers: row.actual_numbers ? parseJson(row.actual_numbers, []) : null,
        single_hit: nullableNumber(row.single_hit),
        two_star_hit: nullableNumber(row.two_star_hit),
        three_star_hits: nullableNumber(row.three_star_hits),
        four_star_hits: nullableNumber(row.four_star_hits),
        five_star_hits: nullableNumber(row.five_star_hits),
        created_at: row.created_at || null,
        evaluated_at: row.evaluated_at || null,
      },
    };
  });

  const adminHash = getAdminHash(db);
  const adminDocs = adminHash ? [
    { id: 'credentials', data: { password_hash: adminHash } },
    { id: 'default', data: { password_hash: adminHash } },
  ] : [];

  const syncLogs = tableRows(db, 'sync_logs')
    .filter(row => !oldestSelectedDate || String(row.started_at || '') >= oldestSelectedDate)
    .slice(-100)
    .map(row => ({
    id: safeDocId(row.id || hashObject(row)),
    data: copyPlainRow(row),
  }));
  const systemStatus = tableRows(db, 'system_status').map(row => ({
    id: safeDocId(row.id || row.key || hashObject(row)),
    data: copyPlainRow(row),
  }));

  return {
    draws,
    predictions,
    observationLogs,
    adminDocs,
    syncLogs,
    systemStatus,
    adminHash,
    collections: ['draws', 'predictions', 'observation_logs', 'admin', 'sync_logs', 'system_status'],
    counts: {
      draws: draws.length,
      predictions: predictions.length,
      observation_logs: observationLogs.length,
      admin: adminHash ? 1 : 0,
      sync_logs: syncLogs.length,
      system_status: systemStatus.length,
    },
  };
}

function resolveMigrationScope() {
  const recentArg = argValue('--recent');
  const yearArg = argValue('--year');
  if (args.has('--all-history')) return { mode: 'all', source: '--all-history' };
  if (recentArg) return { mode: 'recent', recent: positiveInt(recentArg, 150), source: '--recent' };
  if (yearArg) return { mode: 'year', year: positiveInt(yearArg, new Date().getFullYear()), source: '--year' };
  if (process.env.HISTORY_MODE === 'recent') {
    return { mode: 'recent', recent: positiveInt(process.env.HISTORY_RECENT_LIMIT, 150), source: 'HISTORY_MODE' };
  }
  return { mode: 'year', year: positiveInt(process.env.HISTORY_START_YEAR, new Date().getFullYear()), source: 'default' };
}

function argValue(name) {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

function selectDrawRows(rows) {
  const sorted = [...rows].sort((a, b) => String(b.draw_date).localeCompare(String(a.draw_date)) || String(b.draw_no).localeCompare(String(a.draw_no)));
  if (scope.mode === 'all') return sorted;
  if (scope.mode === 'recent') return sorted.slice(0, Math.min(scope.recent, 150));
  const yearRows = sorted.filter(row => String(row.draw_date || '').startsWith(`${scope.year}-`));
  return yearRows.length >= 100 ? yearRows : sorted.slice(0, 150);
}

function shouldKeepTargetRow(row, oldestSelectedDate, selectedDrawNos) {
  const targetDrawNo = row.target_draw_no ? String(row.target_draw_no) : '';
  if (targetDrawNo && selectedDrawNos.has(targetDrawNo)) return true;
  const targetDate = String(row.target_date || '');
  return Boolean(targetDate && (!oldestSelectedDate || targetDate >= oldestSelectedDate));
}

function positiveInt(value, fallback) {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function tableRows(db, table) {
  if (!tableExists(db, table)) return [];
  return db.prepare(`SELECT * FROM ${table}`).all();
}

function tableExists(db, table) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  return Boolean(row);
}

function getAdminHash(db) {
  if (!tableExists(db, 'app_config')) return null;
  const row = db.prepare("SELECT value FROM app_config WHERE key='admin_password_hash'").get();
  return row?.value || null;
}

function getFirestoreDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

async function upsertDocs(firestore, collectionName, docs) {
  const report = { written: 0, skipped: 0, updated: 0, errors: [] };
  for (const doc of docs) {
    try {
      const ref = firestore.collection(collectionName).doc(doc.id);
      const existing = await ref.get();
      if (existing.exists && containsData(existing.data(), doc.data)) {
        report.skipped++;
        continue;
      }
      await ref.set(doc.data, { merge: true });
      if (existing.exists) report.updated++;
      else report.written++;
    } catch (error) {
      report.errors.push({ id: doc.id, message: error.message });
    }
  }
  return report;
}

async function validateFirestore(firestore, snapshot) {
  const drawSnap = await firestore.collection('draws').orderBy('draw_no', 'desc').limit(Math.min(150, Math.max(100, snapshot.counts.draws))).get();
  const recent = drawSnap.docs.map(doc => doc.data());
  const latest = recent[0] || null;
  const predictionSnap = await firestore.collection('predictions').limit(100).get();
  const observationSnap = await firestore.collection('observation_logs').limit(100).get();
  const modelRead = validateModelRead(recent.slice(0, 300));
  return {
    firestore_draws_seen: recent.length,
    sqlite_draws_count: snapshot.counts.draws,
    recent_100_available: recent.length >= 100,
    recent_120_available: recent.length >= 120,
    latest_draw_no: latest?.draw_no || null,
    latest_draw_date: latest?.draw_date || latest?.date || null,
    predictions_count: predictionSnap.size,
    observation_logs_count: observationSnap.size,
    number_analysis_count: modelRead.number_analysis_count,
    prediction_readiness: modelRead.prediction_readiness,
    backtest_status: modelRead.backtest_status,
    backtest_sample_size: modelRead.backtest_sample_size,
    backtest_reason: modelRead.backtest_reason,
  };
}

function validateModelRead(drawDocs) {
  if (drawDocs.length < 100) {
    return {
      number_analysis_count: 0,
      prediction_readiness: false,
      backtest_status: 'sample_insufficient',
      backtest_sample_size: drawDocs.length,
      backtest_reason: 'at least 100 draws are required for number-analysis and prediction readiness',
    };
  }
  const entries = drawDocs.map(doc => ({
    draw_no: String(doc.draw_no),
    draw_date: String(doc.draw_date || doc.date),
    numbers: Array.isArray(doc.numbers) ? doc.numbers.map(Number).sort((a, b) => a - b) : [],
  }));
  const advanced = require('../dist/engine/AdvancedStatsModel');
  const statistical = require('../dist/engine/statisticalPrediction');
  const decision = entries.length >= 200
    ? advanced.runAdvancedBacktest(entries)
    : {
      advanced_stats_enabled: false,
      three_star_main_enabled: false,
      decision: 'disabled',
      reason: 'sample_insufficient: full 100-sample A/B backtest requires at least 200 verified draws',
      sample_size: entries.length,
    };
  const analysis = advanced.toNumberAnalysisSummary(advanced.getNumberAnalysis(entries, decision.advanced_stats_enabled));
  const targetDate = nextDrawDate(entries[0].draw_date);
  const prediction = statistical.buildStatisticalPrediction(entries, targetDate, [], undefined, null);
  return {
    number_analysis_count: Array.isArray(analysis) ? analysis.length : 0,
    prediction_readiness: Boolean(prediction && prediction.model_version === 'v6.1-three-star-stable'),
    backtest_status: entries.length >= 200 ? 'ok' : 'sample_insufficient',
    backtest_sample_size: entries.length,
    backtest_reason: entries.length >= 200
      ? '100-sample A/B backtest validated'
      : 'full 100-sample A/B backtest skipped because fewer than 200 verified draws were migrated',
  };
}

function validateDrawDoc(draw) {
  const numbers = Array.isArray(draw.numbers) ? draw.numbers.map(Number) : [];
  const unique = new Set(numbers);
  if (!draw.draw_no) throw new Error('draw is missing draw_no');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draw.draw_date)) throw new Error(`draw ${draw.draw_no} has invalid draw_date ${draw.draw_date}`);
  if (numbers.length !== 5 || unique.size !== 5 || numbers.some(n => !Number.isInteger(n) || n < 1 || n > 39)) {
    throw new Error(`draw ${draw.draw_no} has invalid numbers`);
  }
}

function parseNumbers(value, label) {
  const parsed = parseJson(value, []);
  const numbers = Array.isArray(parsed) ? parsed.map(Number).sort((a, b) => a - b) : [];
  if (numbers.length !== 5) throw new Error(`${label} must contain 5 numbers`);
  return numbers;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function copyPlainRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) out[key] = value === undefined ? null : value;
  return out;
}

function dedupeDocs(docs) {
  const map = new Map();
  for (const doc of docs) map.set(doc.id, doc);
  return [...map.values()];
}

function safeDocId(value) {
  return String(value).replace(/[\/\\#?]/g, '_');
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${key}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function containsData(existing, desired) {
  if (!existing || typeof existing !== 'object') return false;
  for (const [key, value] of Object.entries(desired)) {
    if (stable(existing[key]) !== stable(value)) return false;
  }
  return true;
}

function hashObject(value) {
  return crypto.createHash('sha1').update(stable(value)).digest('hex');
}

function nextDrawDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + 1));
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
