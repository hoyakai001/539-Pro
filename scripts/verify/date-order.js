#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '../..');
const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(ROOT, 'backend/data/539.db');

function loadBetterSqlite3() {
  try {
    return require('better-sqlite3');
  } catch (_) {
    // fall through to backend-scoped resolution
  }
  const backendPkg = path.join(ROOT, 'backend', 'package.json');
  if (fs.existsSync(backendPkg)) {
    const backendRequire = createRequire(backendPkg);
    return backendRequire('better-sqlite3');
  }
  throw new Error('better-sqlite3 is not installed; run "cd backend && npm install" with optional dependencies enabled');
}

if (!fs.existsSync(dbPath)) {
  console.warn(`[SKIP] date-order check skipped: DB not found at ${dbPath}`);
  process.exit(0);
}

let Database;
try {
  Database = loadBetterSqlite3();
} catch (err) {
  console.warn(`[SKIP] date-order check skipped: ${err.message}`);
  process.exit(0);
}

const db = new Database(dbPath, { readonly: true });

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

const badDates = db.prepare(`
  SELECT draw_no, draw_date FROM draws
  WHERE draw_date NOT GLOB '????-??-??'
     OR CAST(substr(draw_date, 1, 4) AS INTEGER) < 1911
  LIMIT 20
`).all();

if (badDates.length > 0) {
  fail(`DB contains non-ISO or ROC draw_date values: ${JSON.stringify(badDates)}`);
} else {
  pass('all draws.draw_date values are ISO YYYY-MM-DD and not ROC years');
}

const latest = db.prepare(`
  SELECT draw_no, draw_date FROM draws
  ORDER BY draw_date DESC, draw_no DESC
  LIMIT 1
`).get();

const maxDate = db.prepare('SELECT MAX(draw_date) AS maxDate FROM draws').get()?.maxDate;

if (!latest) {
  fail('draws table is empty');
} else if (latest.draw_date !== maxDate) {
  fail(`latest draw_date ${latest.draw_date} is not MAX(draw_date) ${maxDate}`);
} else {
  pass(`latest draw is ${latest.draw_no} / ${latest.draw_date}`);
}

if (latest) {
  const previous = db.prepare(`
    SELECT draw_no, draw_date FROM draws
    WHERE draw_date < @draw_date
       OR (draw_date = @draw_date AND draw_no < @draw_no)
    ORDER BY draw_date DESC, draw_no DESC
    LIMIT 1
  `).get(latest);

  if (!previous) {
    fail('previous draw was not found');
  } else if (previous.draw_date >= latest.draw_date && previous.draw_no >= latest.draw_no) {
    fail(`previous draw ${previous.draw_no}/${previous.draw_date} is not older than latest ${latest.draw_no}/${latest.draw_date}`);
  } else {
    pass(`previous draw is ${previous.draw_no} / ${previous.draw_date}`);
  }
}

if (latest && latest.draw_no !== '115000108') {
  console.warn(`[WARN] latest_draw_no is ${latest.draw_no}; expected 115000108 only if the official API has not advanced`);
} else if (latest) {
  pass('latest_draw_no matches 115000108');
}

const rocLike = db.prepare(`
  SELECT draw_no, draw_date FROM draws
  WHERE CAST(substr(draw_date, 1, 4) AS INTEGER) < 1911
  LIMIT 1
`).get();

if (rocLike) fail(`ROC date appears stored directly: ${JSON.stringify(rocLike)}`);
else pass('no ROC dates are stored directly');

if (latest && !isIsoDate(latest.draw_date)) fail(`latest date is not ISO: ${latest.draw_date}`);

if (process.exitCode) process.exit(process.exitCode);
