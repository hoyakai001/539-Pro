import { config as dotenvConfig } from 'dotenv';
import * as path from 'path';
dotenvConfig({ path: path.resolve(__dirname, '..', '..', '.env') });
import { CREATE_TABLES_SQL, DEFAULT_STRATEGY_WEIGHTS } from './schema';
import { resolveDbPath } from '../config/pathResolver';
import { setDbConfigLoader } from '../config/configService';
import type { AppConfig } from '../config/configService';
import { normalizeDrawDate } from '../data/dateUtils';

type BetterSqliteConstructor = typeof import('better-sqlite3');
type SqliteDatabase = import('better-sqlite3').Database;

let db: SqliteDatabase;

export function getDB(): SqliteDatabase {
  if (!db) throw new Error('[DB] 資料庫尚未初始化，請先呼叫 initDB()');
  return db;
}

export function initDB(): void {
  const dbPath = resolveDbPath();
  const Database = loadBetterSqlite();

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_TABLES_SQL);

  migrateSyncLogs();
  migrateDraws();
  migratePredictions();
  migrateBacktests();
  migrateStrategyObservationLogs();
  normalizeStoredDrawDates();
  seedStrategyWeights();
  wireConfigLoader();

  console.log(`[DB] 初始化完成：${dbPath}`);
}

function loadBetterSqlite(): BetterSqliteConstructor {
  try {
    return require('better-sqlite3') as BetterSqliteConstructor;
  } catch (error) {
    throw new Error(`better-sqlite3 is required in local APP_MODE. Run "cd backend && npm install" before local SQLite startup. ${(error as Error).message}`);
  }
}

function migrateSyncLogs(): void {
  const cols = new Set((getDB().prepare('PRAGMA table_info(sync_logs)').all() as { name: string }[]).map(c => c.name));
  const add = (name: string, sql: string) => {
    if (!cols.has(name)) getDB().exec(`ALTER TABLE sync_logs ADD COLUMN ${name} ${sql}`);
  };
  add('type', "TEXT NOT NULL DEFAULT 'sync-now'");
  add('active_source', 'TEXT');
  add('source_url', 'TEXT');
  add('retry_count', 'INTEGER NOT NULL DEFAULT 0');
  add('retry_stage', 'TEXT');
  add('recovery_mode', 'INTEGER NOT NULL DEFAULT 0');
  add('inserted_count', 'INTEGER NOT NULL DEFAULT 0');
  add('diagnostic', 'TEXT');
}

function addColumnIfMissing(table: string, name: string, sql: string): void {
  const cols = new Set((getDB().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name));
  if (!cols.has(name)) getDB().exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${sql}`);
}

function migrateDraws(): void {
  addColumnIfMissing('draws', 'verified_by_pilio', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('draws', 'audit_status', "TEXT NOT NULL DEFAULT 'UNVERIFIED'");
}

function migratePredictions(): void {
  addColumnIfMissing('predictions', 'numbers_json', 'TEXT');
  addColumnIfMissing('predictions', 'two_star_json', 'TEXT');
  addColumnIfMissing('predictions', 'scores_json', 'TEXT');
  addColumnIfMissing('predictions', 'strategy', 'TEXT');
  addColumnIfMissing('predictions', 'model_version', 'TEXT');
  addColumnIfMissing('predictions', 'version', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('predictions', 'locked', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('predictions', 'bet_advice_json', 'TEXT');
}

function migrateBacktests(): void {
  addColumnIfMissing('backtests', 'hit_rate_two', 'REAL');
  addColumnIfMissing('backtests', 'avg_hits_two', 'REAL');
  addColumnIfMissing('backtests', 'avg_hits', 'REAL');
  addColumnIfMissing('backtests', 'max_losing_streak_two', 'INTEGER');
  addColumnIfMissing('backtests', 'max_losing_streak_three', 'INTEGER');
  addColumnIfMissing('backtests', 'max_losing_streak_four', 'INTEGER');
  addColumnIfMissing('backtests', 'max_losing_streak_five', 'INTEGER');
  addColumnIfMissing('backtests', 'sample_size', 'INTEGER');
  addColumnIfMissing('backtests', 'tested_draws', 'INTEGER');
  addColumnIfMissing('backtests', 'audit_status', "TEXT NOT NULL DEFAULT 'WARN'");
  addColumnIfMissing('backtests', 'details_json', 'TEXT');
}

function migrateStrategyObservationLogs(): void {
  addColumnIfMissing('strategy_observation_logs', 'prediction_id', 'INTEGER');
  addColumnIfMissing('strategy_observation_logs', 'advice_level', 'TEXT');
  addColumnIfMissing('strategy_observation_logs', 'actual_numbers', 'TEXT');
  addColumnIfMissing('strategy_observation_logs', 'single_hit', 'INTEGER');
  addColumnIfMissing('strategy_observation_logs', 'two_star_hit', 'INTEGER');
  addColumnIfMissing('strategy_observation_logs', 'three_star_hits', 'INTEGER');
  addColumnIfMissing('strategy_observation_logs', 'four_star_hits', 'INTEGER');
  addColumnIfMissing('strategy_observation_logs', 'five_star_hits', 'INTEGER');
  addColumnIfMissing('strategy_observation_logs', 'evaluated_at', 'TEXT');
}

function normalizeStoredDrawDates(): void {
  const rows = getDB().prepare('SELECT draw_no, draw_date FROM draws').all() as { draw_no: string; draw_date: string }[];
  const update = getDB().prepare(
    `UPDATE draws SET draw_date=@draw_date, updated_at=strftime('%Y-%m-%d %H:%M:%S','now','localtime') WHERE draw_no=@draw_no`
  );
  const tx = getDB().transaction((updates: { draw_no: string; draw_date: string }[]) => {
    for (const row of updates) update.run(row);
  });

  const updates = rows
    .map(row => ({ draw_no: row.draw_no, draw_date: normalizeDrawDate(row.draw_date), original: row.draw_date }))
    .filter(row => row.draw_date && row.draw_date !== row.original)
    .map(({ draw_no, draw_date }) => ({ draw_no, draw_date }));

  if (updates.length > 0) {
    tx(updates);
    console.log(`[DB] normalized ${updates.length} draw_date value(s) to YYYY-MM-DD`);
  }
}

function seedStrategyWeights(): void {
  const insert = getDB().prepare(
    `INSERT OR IGNORE INTO strategy_weights (strategy_name, weight) VALUES (@strategy_name, @weight)`
  );
  const insertMany = getDB().transaction((rows: typeof DEFAULT_STRATEGY_WEIGHTS) => {
    for (const row of rows) insert.run(row);
  });
  insertMany(DEFAULT_STRATEGY_WEIGHTS);
}

/** 讓 configService 能從 DB 讀取 app_config，避免循環依賴 */
function wireConfigLoader(): void {
  setDbConfigLoader((): Partial<AppConfig> => {
    const rows = getDB()
      .prepare('SELECT key, value FROM app_config')
      .all() as { key: string; value: string }[];

    const result: Partial<AppConfig> = {};
    for (const r of rows) {
      switch (r.key as keyof AppConfig) {
        case 'officialApiUrl':
        case 'officialHtmlUrl':
        case 'optionalSecondarySourceUrl':
        case 'tw_lottery_api_latest':
        case 'tw_lottery_history_url':
        case 'verify_source_url':
        case 'sync_cron':
          (result as Record<string, string>)[r.key] = r.value;
          break;
        case 'officialApiCandidates':
          try {
            (result as Record<string, string[]>)[r.key] = JSON.parse(r.value);
          } catch {
            (result as Record<string, string[]>)[r.key] = r.value.split(',').map(s => s.trim()).filter(Boolean);
          }
          break;
        case 'syncIntervalMinutes':
          (result as Record<string, number>)[r.key] = parseInt(r.value) || 30;
          break;
        case 'recoveryRetryMinutes':
          (result as Record<string, number>)[r.key] = parseInt(r.value) || 5;
          break;
        case 'pilio':
          try {
            result.pilio = JSON.parse(r.value);
          } catch {
            // Ignore invalid DB config and keep file/default config.
          }
          break;
        case 'verify_source_enabled':
          (result as Record<string, boolean>)[r.key] = r.value === 'true';
          break;
        case 'auto_sync_interval_minutes':
          (result as Record<string, number>)[r.key] = parseInt(r.value) || 60;
          break;
      }
    }
    return result;
  });
}

// ─── 型別定義 ────────────────────────────────────────────────────────────────

export interface DrawRow {
  id: number;
  draw_no: string;
  draw_date: string;
  numbers_json: string;
  source: string;
  source_url: string | null;
  verified: number;
  verified_by_pilio: number;
  audit_status: string;
  created_at: string;
  updated_at: string;
}

export interface PredictionRow {
  id: number;
  target_date: string;
  target_draw_no: string | null;
  latest_used_draw_no: string;
  latest_used_draw_date: string;
  single_number: number | null;
  numbers_json?: string | null;
  two_star_json?: string | null;
  three_star_json: string | null;
  four_star_json: string | null;
  five_star_json: string | null;
  number_scores_json: string | null;
  strategy_scores_json: string | null;
  bet_advice_json?: string | null;
  confidence_label: string | null;
  recommendation: string | null;
  data_status: string;
  scores_json?: string | null;
  strategy?: string | null;
  model_version?: string | null;
  version?: number;
  locked?: number;
  created_at: string;
}

export interface PredictionAuditRow {
  id: number;
  prediction_id: number;
  actual_draw_no: string;
  actual_numbers: string;
  single_hit: number;
  three_star_hits: number;
  four_star_hits: number;
  five_star_hits: number;
  evaluated_at: string;
}

export interface StrategyObservationRow {
  id: number;
  prediction_id: number | null;
  model_version: string;
  target_draw_no: string | null;
  target_date: string;
  selected_single: number | null;
  selected_two_star: string;
  selected_three_star: string;
  selected_four_star: string;
  selected_five_star: string;
  advice_label: string | null;
  advice_level: string | null;
  confidence: string | null;
  draw_profile: string | null;
  actual_numbers: string | null;
  single_hit: number | null;
  two_star_hit: number | null;
  three_star_hits: number | null;
  four_star_hits: number | null;
  five_star_hits: number | null;
  created_at: string;
  evaluated_at: string | null;
}

export interface StrategyObservationStatus {
  model_version: string;
  observed_count: number;
  target_count: number;
  status: '觀察中' | '已完成';
}

export interface BacktestRow {
  id: number;
  run_date: string;
  window_size: number;
  strategy_name: string;
  hit_rate_single: number | null;
  hit_rate_two?: number | null;
  hit_rate_three: number | null;
  hit_rate_four: number | null;
  hit_rate_five: number | null;
  avg_hits_two?: number | null;
  avg_hits_three: number | null;
  avg_hits_four: number | null;
  avg_hits_five: number | null;
  avg_hits?: number | null;
  max_losing_streak_two?: number | null;
  max_losing_streak_three?: number | null;
  max_losing_streak_four?: number | null;
  max_losing_streak_five?: number | null;
  max_losing_streak: number | null;
  sample_size?: number | null;
  tested_draws?: number | null;
  audit_status?: string | null;
  details_json?: string | null;
  score: number | null;
  created_at: string;
}

export interface StrategyWeightRow {
  id: number;
  strategy_name: string;
  weight: number;
  last_score: number | null;
  updated_at: string;
}

export interface SyncLogRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'failed' | 'partial' | 'pending' | 'recovered';
  type: string;
  active_source: string | null;
  source_url: string | null;
  retry_count: number;
  retry_stage: string | null;
  recovery_mode: number;
  latest_draw_no_before: string | null;
  latest_draw_no_after: string | null;
  new_draws_inserted: number;
  inserted_count: number;
  message: string | null;
  diagnostic: string | null;
  error_stack: string | null;
}

// ─── Draw CRUD ───────────────────────────────────────────────────────────────

export function getDraws(limit?: number): DrawRow[] {
  const sql = limit
    ? 'SELECT * FROM draws ORDER BY draw_date DESC, draw_no DESC LIMIT ?'
    : 'SELECT * FROM draws ORDER BY draw_date DESC, draw_no DESC';
  return (limit
    ? getDB().prepare(sql).all(limit)
    : getDB().prepare(sql).all()) as DrawRow[];
}

export function getDrawByNo(draw_no: string): DrawRow | undefined {
  return getDB()
    .prepare('SELECT * FROM draws WHERE draw_no = ?')
    .get(draw_no) as DrawRow | undefined;
}

export function getLatestDraw(): DrawRow | undefined {
  return getDB()
    .prepare('SELECT * FROM draws ORDER BY draw_date DESC, draw_no DESC LIMIT 1')
    .get() as DrawRow | undefined;
}

export function getPreviousDraw(): DrawRow | undefined {
  const latest = getLatestDraw();
  if (!latest) return undefined;
  return getDB()
    .prepare(`
      SELECT * FROM draws
      WHERE draw_date < @draw_date
         OR (draw_date = @draw_date AND draw_no < @draw_no)
      ORDER BY draw_date DESC, draw_no DESC
      LIMIT 1
    `)
    .get({ draw_date: latest.draw_date, draw_no: latest.draw_no }) as DrawRow | undefined;
}

export function countDraws(): number {
  const row = getDB()
    .prepare('SELECT COUNT(*) as cnt FROM draws')
    .get() as { cnt: number };
  return row.cnt;
}

export function upsertDraw(params: {
  draw_no: string;
  draw_date: string;
  numbers: number[];
  source: string;
  source_url?: string;
  verified?: boolean;
}): 'inserted' | 'existing' {
  const normalizedDate = normalizeDrawDate(params.draw_date);
  if (!normalizedDate) throw new Error(`invalid draw_date: ${params.draw_date}`);
  const existing = getDrawByNo(params.draw_no);
  if (existing) {
    const existingOrderedNums = JSON.parse(existing.numbers_json) as number[];
    const existingNums = [...existingOrderedNums].sort((a, b) => a - b);
    const newNums = [...params.numbers].sort((a, b) => a - b);
    if (JSON.stringify(newNums) !== JSON.stringify(existingNums)) {
      throw new Error(
        `期號 ${params.draw_no} 號碼衝突：` +
        `已存在 [${existingNums.join(',')}]，新資料 [${newNums.join(',')}]`
      );
    }
    const shouldUpdate =
      existing.draw_date !== normalizedDate ||
      JSON.stringify(existingOrderedNums) !== JSON.stringify(params.numbers) ||
      existing.source !== params.source ||
      (existing.source_url ?? null) !== (params.source_url ?? null) ||
      (params.verified && !existing.verified);

    if (shouldUpdate) {
      getDB().prepare(
        `UPDATE draws
         SET draw_date=@draw_date,
             numbers_json=@numbers_json,
             source=@source,
             source_url=@source_url,
             verified=CASE WHEN @verified=1 THEN 1 ELSE verified END,
             updated_at=strftime('%Y-%m-%d %H:%M:%S','now','localtime')
         WHERE draw_no=@draw_no`
      ).run({
        draw_no: params.draw_no,
        draw_date: normalizedDate,
        numbers_json: JSON.stringify(params.numbers),
        source: params.source,
        source_url: params.source_url ?? null,
        verified: params.verified ? 1 : 0,
      });
    }
    return 'existing';
  }

  getDB().prepare(`
    INSERT INTO draws (draw_no, draw_date, numbers_json, source, source_url, verified)
    VALUES (@draw_no, @draw_date, @numbers_json, @source, @source_url, @verified)
  `).run({
    draw_no:      params.draw_no,
    draw_date:    normalizedDate,
    numbers_json: JSON.stringify(params.numbers),
    source:       params.source,
    source_url:   params.source_url ?? null,
    verified:     params.verified ? 1 : 0,
  });
  return 'inserted';
}

// ─── Prediction CRUD ─────────────────────────────────────────────────────────

export function savePrediction(p: Omit<PredictionRow, 'id' | 'created_at'>): number {
  const result = getDB().prepare(`
    INSERT INTO predictions
      (target_date, target_draw_no, latest_used_draw_no, latest_used_draw_date,
       single_number, numbers_json, two_star_json, three_star_json, four_star_json, five_star_json,
       number_scores_json, strategy_scores_json, bet_advice_json, confidence_label,
       recommendation, data_status, scores_json, strategy, model_version, version, locked)
    VALUES
      (@target_date, @target_draw_no, @latest_used_draw_no, @latest_used_draw_date,
       @single_number, @numbers_json, @two_star_json, @three_star_json, @four_star_json, @five_star_json,
       @number_scores_json, @strategy_scores_json, @bet_advice_json, @confidence_label,
       @recommendation, @data_status, @scores_json, @strategy, @model_version, @version, @locked)
  `).run({
    ...p,
    numbers_json: p.numbers_json ?? null,
    two_star_json: p.two_star_json ?? null,
    bet_advice_json: p.bet_advice_json ?? null,
    scores_json: p.scores_json ?? p.number_scores_json ?? null,
    strategy: p.strategy ?? null,
    model_version: p.model_version ?? null,
    version: p.version ?? 1,
    locked: p.locked ?? 1,
  });
  return result.lastInsertRowid as number;
}

export function getTodayPrediction(date: string): PredictionRow | undefined {
  return getDB()
    .prepare('SELECT * FROM predictions WHERE target_date=? ORDER BY id DESC LIMIT 1')
    .get(date) as PredictionRow | undefined;
}

export function getLockedPrediction(params: {
  target_date: string;
  target_draw_no: string | null;
  latest_used_draw_no: string;
  model_version: string;
}): PredictionRow | undefined {
  return getDB().prepare(`
    SELECT * FROM predictions
    WHERE target_date=@target_date
      AND COALESCE(target_draw_no, '')=COALESCE(@target_draw_no, '')
      AND latest_used_draw_no=@latest_used_draw_no
      AND model_version=@model_version
    ORDER BY id DESC
    LIMIT 1
  `).get(params) as PredictionRow | undefined;
}

export function getNextPredictionVersion(date: string): number {
  const row = getDB()
    .prepare('SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM predictions WHERE target_date=?')
    .get(date) as { next_version: number };
  return row.next_version;
}

export function getPredictionById(id: number): PredictionRow | undefined {
  return getDB()
    .prepare('SELECT * FROM predictions WHERE id=?')
    .get(id) as PredictionRow | undefined;
}

export function getLatestPrediction(): PredictionRow | undefined {
  return getDB()
    .prepare("SELECT * FROM predictions WHERE data_status='VALID' ORDER BY id DESC LIMIT 1")
    .get() as PredictionRow | undefined;
}

export function getUnevaluatedPredictions(): PredictionRow[] {
  return getDB().prepare(`
    SELECT p.* FROM predictions p
    WHERE p.data_status = 'VALID'
      AND p.target_draw_no IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM prediction_audit_logs a WHERE a.prediction_id = p.id
      )
  `).all() as PredictionRow[];
}

// ─── Prediction Audit CRUD ───────────────────────────────────────────────────

export function savePredictionAudit(params: {
  prediction_id: number;
  actual_draw_no: string;
  actual_numbers: number[];
  single_hit: boolean;
  three_star_hits: number;
  four_star_hits: number;
  five_star_hits: number;
}): void {
  getDB().prepare(`
    INSERT INTO prediction_audit_logs
      (prediction_id, actual_draw_no, actual_numbers,
       single_hit, three_star_hits, four_star_hits, five_star_hits)
    VALUES
      (@prediction_id, @actual_draw_no, @actual_numbers,
       @single_hit, @three_star_hits, @four_star_hits, @five_star_hits)
  `).run({
    prediction_id:   params.prediction_id,
    actual_draw_no:  params.actual_draw_no,
    actual_numbers:  JSON.stringify(params.actual_numbers),
    single_hit:      params.single_hit ? 1 : 0,
    three_star_hits: params.three_star_hits,
    four_star_hits:  params.four_star_hits,
    five_star_hits:  params.five_star_hits,
  });
}

export function getRecentAuditLogs(limit = 30): PredictionAuditRow[] {
  return getDB()
    .prepare('SELECT * FROM prediction_audit_logs ORDER BY id DESC LIMIT ?')
    .all(limit) as PredictionAuditRow[];
}

export function saveStrategyObservationLog(params: {
  prediction_id: number;
  model_version: string;
  target_draw_no: string | null;
  target_date: string;
  selected_single: number;
  selected_two_star: number[];
  selected_three_star: number[];
  selected_four_star: number[];
  selected_five_star: number[];
  advice_level?: string | null;
  advice_label: string;
  confidence: string;
  draw_profile: string;
}): void {
  getDB().prepare(`
    INSERT OR IGNORE INTO strategy_observation_logs
      (prediction_id, model_version, target_draw_no, target_date,
       selected_single, selected_two_star, selected_three_star, selected_four_star, selected_five_star,
       advice_label, advice_level, confidence, draw_profile)
    VALUES
      (@prediction_id, @model_version, @target_draw_no, @target_date,
       @selected_single, @selected_two_star, @selected_three_star, @selected_four_star, @selected_five_star,
       @advice_label, @advice_level, @confidence, @draw_profile)
  `).run({
    ...params,
    selected_two_star: JSON.stringify(sortNumeric(params.selected_two_star)),
    selected_three_star: JSON.stringify(sortNumeric(params.selected_three_star)),
    selected_four_star: JSON.stringify(sortNumeric(params.selected_four_star)),
    selected_five_star: JSON.stringify(sortNumeric(params.selected_five_star)),
    advice_level: params.advice_level ?? null,
  });
}

export function evaluateStrategyObservationLogs(): void {
  const pending = getDB().prepare(`
    SELECT * FROM strategy_observation_logs
    WHERE evaluated_at IS NULL
    ORDER BY id ASC
    LIMIT 200
  `).all() as StrategyObservationRow[];
  if (!pending.length) return;

  const drawByDate = getDB().prepare('SELECT * FROM draws WHERE draw_date=? ORDER BY draw_no DESC LIMIT 1');
  const update = getDB().prepare(`
    UPDATE strategy_observation_logs SET
      actual_numbers=@actual_numbers,
      single_hit=@single_hit,
      two_star_hit=@two_star_hit,
      three_star_hits=@three_star_hits,
      four_star_hits=@four_star_hits,
      five_star_hits=@five_star_hits,
      evaluated_at=strftime('%Y-%m-%d %H:%M:%S','now','localtime')
    WHERE id=@id
  `);

  const tx = getDB().transaction((rows: StrategyObservationRow[]) => {
    for (const row of rows) {
      const draw = row.target_draw_no
        ? getDrawByNo(row.target_draw_no)
        : drawByDate.get(row.target_date) as DrawRow | undefined;
      if (!draw) continue;
      const actual = parseJsonNumbers(draw.numbers_json);
      const two = parseJsonNumbers(row.selected_two_star);
      const three = parseJsonNumbers(row.selected_three_star);
      const four = parseJsonNumbers(row.selected_four_star);
      const five = parseJsonNumbers(row.selected_five_star);
      update.run({
        id: row.id,
        actual_numbers: JSON.stringify(actual),
        single_hit: row.selected_single && actual.includes(row.selected_single) ? 1 : 0,
        two_star_hit: two.every(n => actual.includes(n)) ? 1 : 0,
        three_star_hits: three.filter(n => actual.includes(n)).length,
        four_star_hits: four.filter(n => actual.includes(n)).length,
        five_star_hits: five.filter(n => actual.includes(n)).length,
      });
    }
  });
  tx(pending);
}

export function getStrategyObservationLogs(limit = 30, modelVersion?: string): StrategyObservationRow[] {
  evaluateStrategyObservationLogs();
  const safeLimit = Math.max(1, Math.min(limit, 100));
  if (modelVersion) {
    return getDB().prepare(`
      SELECT * FROM strategy_observation_logs
      WHERE model_version=?
      ORDER BY target_date DESC, id DESC
      LIMIT ?
    `).all(modelVersion, safeLimit) as StrategyObservationRow[];
  }
  return getDB().prepare(`
    SELECT * FROM strategy_observation_logs
    ORDER BY target_date DESC, id DESC
    LIMIT ?
  `).all(safeLimit) as StrategyObservationRow[];
}

export function getStrategyObservationStatus(modelVersion: string, targetCount = 30): StrategyObservationStatus {
  const row = getDB().prepare(`
    SELECT COUNT(*) as cnt FROM strategy_observation_logs
    WHERE model_version=?
  `).get(modelVersion) as { cnt: number };
  const observed = Math.min(row.cnt, targetCount);
  return {
    model_version: modelVersion,
    observed_count: observed,
    target_count: targetCount,
    status: observed >= targetCount ? '已完成' : '觀察中',
  };
}

// ─── Backtest CRUD ───────────────────────────────────────────────────────────

export function saveBacktest(b: Omit<BacktestRow, 'id' | 'created_at'>): void {
  getDB().prepare(`
    INSERT INTO backtests
      (run_date, window_size, strategy_name,
       hit_rate_single, hit_rate_two, hit_rate_three, hit_rate_four, hit_rate_five,
       avg_hits_two, avg_hits_three, avg_hits_four, avg_hits_five, avg_hits,
       max_losing_streak_two, max_losing_streak_three, max_losing_streak_four, max_losing_streak_five,
       max_losing_streak, sample_size, tested_draws, audit_status, details_json, score)
    VALUES
      (@run_date, @window_size, @strategy_name,
       @hit_rate_single, @hit_rate_two, @hit_rate_three, @hit_rate_four, @hit_rate_five,
       @avg_hits_two, @avg_hits_three, @avg_hits_four, @avg_hits_five, @avg_hits,
       @max_losing_streak_two, @max_losing_streak_three, @max_losing_streak_four, @max_losing_streak_five,
       @max_losing_streak, @sample_size, @tested_draws, @audit_status, @details_json, @score)
  `).run({
    ...b,
    hit_rate_two: b.hit_rate_two ?? null,
    avg_hits_two: b.avg_hits_two ?? null,
    avg_hits: b.avg_hits ?? null,
    max_losing_streak_two: b.max_losing_streak_two ?? null,
    max_losing_streak_three: b.max_losing_streak_three ?? null,
    max_losing_streak_four: b.max_losing_streak_four ?? null,
    max_losing_streak_five: b.max_losing_streak_five ?? null,
    sample_size: b.sample_size ?? null,
    tested_draws: b.tested_draws ?? null,
    audit_status: b.audit_status ?? 'WARN',
    details_json: b.details_json ?? null,
  });
}

export function getLatestBacktests(): BacktestRow[] {
  return getDB().prepare(`
    SELECT b.* FROM backtests b
    INNER JOIN (
      SELECT window_size, strategy_name, MAX(id) as max_id
      FROM backtests GROUP BY window_size, strategy_name
    ) latest ON b.id = latest.max_id
    ORDER BY b.window_size, b.strategy_name
  `).all() as BacktestRow[];
}

// ─── Strategy Weights ────────────────────────────────────────────────────────

export function getStrategyWeights(): StrategyWeightRow[] {
  return getDB().prepare('SELECT * FROM strategy_weights').all() as StrategyWeightRow[];
}

export function updateStrategyWeight(strategy_name: string, weight: number, last_score: number): void {
  getDB().prepare(`
    UPDATE strategy_weights
    SET weight=@weight, last_score=@last_score,
        updated_at=strftime('%Y-%m-%d %H:%M:%S','now','localtime')
    WHERE strategy_name=@strategy_name
  `).run({ strategy_name, weight, last_score });
}

// ─── Sync Logs ───────────────────────────────────────────────────────────────

export function insertSyncLog(params: {
  started_at: string;
  latest_draw_no_before: string | null;
  type?: string;
  retry_count?: number;
  retry_stage?: string | null;
  recovery_mode?: boolean;
}): number {
  const result = getDB().prepare(`
    INSERT INTO sync_logs
      (started_at, status, latest_draw_no_before, type, retry_count, retry_stage, recovery_mode)
    VALUES
      (@started_at, 'running', @latest_draw_no_before, @type, @retry_count, @retry_stage, @recovery_mode)
  `).run({
    ...params,
    type: params.type ?? 'sync-now',
    retry_count: params.retry_count ?? 0,
    retry_stage: params.retry_stage ?? null,
    recovery_mode: params.recovery_mode ? 1 : 0,
  });
  return result.lastInsertRowid as number;
}

export function finishSyncLog(id: number, params: {
  finished_at: string;
  status: 'success' | 'failed' | 'partial' | 'pending' | 'recovered';
  active_source?: string | null;
  source_url?: string | null;
  retry_count?: number;
  retry_stage?: string | null;
  recovery_mode?: boolean;
  latest_draw_no_after: string | null;
  new_draws_inserted: number;
  message: string;
  diagnostic?: string | null;
  error_stack?: string | null;
}): void {
  getDB().prepare(`
    UPDATE sync_logs SET
      finished_at=@finished_at, status=@status,
      active_source=@active_source, source_url=@source_url,
      retry_count=@retry_count, retry_stage=@retry_stage, recovery_mode=@recovery_mode,
      latest_draw_no_after=@latest_draw_no_after,
      new_draws_inserted=@new_draws_inserted, inserted_count=@new_draws_inserted,
      message=@message, diagnostic=@diagnostic, error_stack=@error_stack
    WHERE id=@id
  `).run({
    ...params,
    active_source: params.active_source ?? null,
    source_url: params.source_url ?? null,
    retry_count: params.retry_count ?? 0,
    retry_stage: params.retry_stage ?? null,
    recovery_mode: params.recovery_mode ? 1 : 0,
    diagnostic: params.diagnostic ?? null,
    error_stack: params.error_stack ?? null,
    id,
  });
}

export function getRecentSyncLogs(limit = 20): SyncLogRow[] {
  return getDB()
    .prepare('SELECT * FROM sync_logs ORDER BY id DESC LIMIT ?')
    .all(limit) as SyncLogRow[];
}

export function getLastSuccessfulSync(): SyncLogRow | undefined {
  return getDB()
    .prepare(`SELECT * FROM sync_logs WHERE status IN ('success','partial','recovered') ORDER BY id DESC LIMIT 1`)
    .get() as SyncLogRow | undefined;
}

// ─── App Config ──────────────────────────────────────────────────────────────

function parseJsonNumbers(value: string | null): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? sortNumeric(parsed.map(Number).filter(Number.isFinite)) : [];
  } catch {
    return [];
  }
}

function sortNumeric(nums: number[]): number[] {
  return [...nums].sort((a, b) => a - b);
}

export function getAppConfigValue(key: string): string | null {
  const row = getDB()
    .prepare('SELECT value FROM app_config WHERE key=?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setAppConfigValue(key: string, value: string): void {
  getDB().prepare(`
    INSERT INTO app_config (key, value)
    VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET
      value=@value,
      updated_at=strftime('%Y-%m-%d %H:%M:%S','now','localtime')
  `).run({ key, value });
}

export function getAllAppConfig(): Record<string, string> {
  const rows = getDB()
    .prepare('SELECT key, value FROM app_config')
    .all() as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const r of rows) result[r.key] = r.value;
  return result;
}
