export const CREATE_TABLES_SQL = `
-- ─── 開獎資料 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS draws (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  draw_no      TEXT    UNIQUE NOT NULL,
  draw_date    TEXT    NOT NULL,
  numbers_json TEXT    NOT NULL,
  source       TEXT    NOT NULL DEFAULT 'official',
  source_url   TEXT,
  verified     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now','localtime')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now','localtime'))
);

-- ─── 預測記錄 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS predictions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  target_date           TEXT NOT NULL,
  target_draw_no        TEXT,
  latest_used_draw_no   TEXT NOT NULL,
  latest_used_draw_date TEXT NOT NULL,
  single_number         INTEGER,
  three_star_json       TEXT,
  four_star_json        TEXT,
  five_star_json        TEXT,
  number_scores_json    TEXT,
  strategy_scores_json  TEXT,
  bet_advice_json       TEXT,
  confidence_label      TEXT,
  recommendation        TEXT,
  data_status           TEXT NOT NULL DEFAULT 'INVALID',
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now','localtime'))
);

CREATE TABLE IF NOT EXISTS history_audits (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  checked_at                 TEXT NOT NULL,
  status                     TEXT NOT NULL,
  checked_count              INTEGER NOT NULL,
  latest_draw_no             TEXT,
  latest_draw_date           TEXT,
  previous_draw_no           TEXT,
  previous_draw_date         TEXT,
  official_api_reachable     INTEGER NOT NULL DEFAULT 0,
  can_run_official_backtest  INTEGER NOT NULL DEFAULT 0,
  can_predict                INTEGER NOT NULL DEFAULT 0,
  warnings_json              TEXT NOT NULL DEFAULT '[]',
  errors_json                TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS pilio_verifications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  checked_at        TEXT NOT NULL,
  mode              TEXT NOT NULL,
  pages_fetched     INTEGER NOT NULL,
  total_draws       INTEGER NOT NULL,
  matched_count     INTEGER NOT NULL,
  conflict_count    INTEGER NOT NULL,
  missing_in_db     INTEGER NOT NULL,
  missing_in_pilio  INTEGER NOT NULL,
  checked_count     INTEGER NOT NULL,
  newest_draw_no    TEXT,
  newest_draw_date  TEXT,
  status            TEXT NOT NULL,
  diagnostic_json   TEXT NOT NULL DEFAULT '{}'
);

-- ─── 預測稽核日誌 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prediction_audit_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  prediction_id   INTEGER NOT NULL REFERENCES predictions(id),
  actual_draw_no  TEXT    NOT NULL,
  actual_numbers  TEXT    NOT NULL,  -- JSON array
  single_hit      INTEGER NOT NULL DEFAULT 0,
  three_star_hits INTEGER NOT NULL DEFAULT 0,
  four_star_hits  INTEGER NOT NULL DEFAULT 0,
  five_star_hits  INTEGER NOT NULL DEFAULT 0,
  evaluated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now','localtime'))
);

-- ─── 回測結果 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategy_observation_logs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  prediction_id        INTEGER REFERENCES predictions(id),
  model_version        TEXT    NOT NULL,
  target_draw_no       TEXT,
  target_date          TEXT    NOT NULL,
  selected_single      INTEGER,
  selected_two_star    TEXT    NOT NULL,
  selected_three_star  TEXT    NOT NULL,
  selected_four_star   TEXT    NOT NULL,
  selected_five_star   TEXT    NOT NULL,
  advice_label         TEXT,
  advice_level         TEXT,
  confidence           TEXT,
  draw_profile         TEXT,
  actual_numbers       TEXT,
  single_hit           INTEGER,
  two_star_hit         INTEGER,
  three_star_hits      INTEGER,
  four_star_hits       INTEGER,
  five_star_hits       INTEGER,
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now','localtime')),
  evaluated_at         TEXT,
  UNIQUE(model_version, target_date, target_draw_no)
);

CREATE TABLE IF NOT EXISTS backtests (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  run_date          TEXT    NOT NULL,
  window_size       INTEGER NOT NULL,
  strategy_name     TEXT    NOT NULL,
  hit_rate_single   REAL,
  hit_rate_three    REAL,
  hit_rate_four     REAL,
  hit_rate_five     REAL,
  avg_hits_three    REAL,
  avg_hits_four     REAL,
  avg_hits_five     REAL,
  max_losing_streak INTEGER,
  score             REAL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now','localtime'))
);

-- ─── 策略權重 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategy_weights (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_name TEXT UNIQUE NOT NULL,
  weight        REAL NOT NULL DEFAULT 1.0,
  last_score    REAL,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now','localtime'))
);

-- ─── 同步記錄 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_logs (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at            TEXT NOT NULL,
  finished_at           TEXT,
  status                TEXT NOT NULL DEFAULT 'running',  -- running / success / failed / partial
  latest_draw_no_before TEXT,
  latest_draw_no_after  TEXT,
  new_draws_inserted    INTEGER NOT NULL DEFAULT 0,
  message               TEXT,
  error_stack           TEXT
);

-- ─── 應用程式設定 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_config (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT UNIQUE NOT NULL,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now','localtime'))
);

-- ─── 索引 ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_draws_no        ON draws(draw_no);
CREATE INDEX IF NOT EXISTS idx_draws_date      ON draws(draw_date);
CREATE INDEX IF NOT EXISTS idx_pred_date       ON predictions(target_date);
CREATE INDEX IF NOT EXISTS idx_pred_audit      ON prediction_audit_logs(prediction_id);
CREATE INDEX IF NOT EXISTS idx_observation_mv  ON strategy_observation_logs(model_version, target_date);
CREATE INDEX IF NOT EXISTS idx_bt_date         ON backtests(run_date);
CREATE INDEX IF NOT EXISTS idx_sync_started    ON sync_logs(started_at);
CREATE INDEX IF NOT EXISTS idx_app_config_key  ON app_config(key);
CREATE INDEX IF NOT EXISTS idx_history_audit   ON history_audits(checked_at);
CREATE INDEX IF NOT EXISTS idx_pilio_verify    ON pilio_verifications(checked_at);
`;

export const DEFAULT_STRATEGY_WEIGHTS = [
  { strategy_name: 'hot_100',       weight: 1.0 },
  { strategy_name: 'hot_30',        weight: 1.0 },
  { strategy_name: 'hot_10',        weight: 1.0 },
  { strategy_name: 'gap',           weight: 1.0 },
  { strategy_name: 'tail',          weight: 1.0 },
  { strategy_name: 'cooccurrence',  weight: 1.0 },
  { strategy_name: 'repeat',        weight: 1.0 },
  { strategy_name: 'balance',       weight: 1.0 },
  { strategy_name: 'backtest_adj',  weight: 1.0 },
];
