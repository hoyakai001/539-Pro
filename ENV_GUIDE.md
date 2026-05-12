# ENV Guide — Canonical Source of Truth

> 所有 ENV 的用途、作用域、預設值、active/legacy/unused 狀態。
>
> 修改 .env / .env.example 前先看這份。所有環境的 ENV 行為由本指南定義。

## Source-of-Truth 規則

- 本檔（ENV_GUIDE.md）是 **唯一** ENV 規格來源。
- 4 個 .env.example 檔（root + backend 三個）只是「複製範本」。
- 若 .env.example 與本檔不一致，**以本檔為準**，並回頭修 .env.example。
- 程式碼中讀的 ENV key 與本檔對照表必須吻合（已 audit）。

## ENV 分區結構

```
┌─ INFRA: app mode / database / firestore
├─ FRONTEND: Vite build-time
├─ SYNC / CRON: 排程與資料來源
├─ ADMIN: 後台密碼
├─ PREDICTION CORE: baseline / hidden kill-switches
├─ PREDICTION MULTI_STRATEGY_V1 (Phase 1)
├─ PREDICTION ENSEMBLE_VOTING_V1 (Phase 2)
├─ PREDICTION ENSEMBLE 2.5 (核心群控制)
└─ LEGACY / DEPRECATED（待移除）
```

## 1. INFRA

| ENV | Default | Local | Cloud-Readonly | Production | 用途 |
|---|---|---|---|---|---|
| `APP_MODE` | `local` | `''` (= local) | `cloud` | `cloud` | 切換 SQLite / Firestore 來源 |
| `NODE_ENV` | `development` | `development` | `development` | `production` | Express / Vite 行為切換 |
| `CLOUD_READONLY` | `false` | `''` (= off) | **`true`** | `false` | 啟用 Firestore write guard。**production 必須 false** |
| `DB_PATH` | `./data/539.db` | 本機 SQLite 路徑 | 不用 | 不用 | sqlite 模式下指定 DB 檔位置 |
| `PORT` | `3001` | `3001` | `3001` | Vercel 控制 | backend listen port |
| `FIREBASE_PROJECT_ID` | — | 不設 | 必填 | 必填 | Firestore 連線 |
| `FIREBASE_CLIENT_EMAIL` | — | 不設 | 必填 | 必填 | Firestore service account |
| `FIREBASE_PRIVATE_KEY` | — | 不設 | 必填 | 必填 | Firestore service account key |

## 2. FRONTEND

| ENV | Default | Production | 用途 |
|---|---|---|---|
| `VITE_API_BASE_URL` | `/api` | `/api`（Vercel）/ `http://localhost:3001/api`（本機 dev） | frontend 打 API 用的 base URL |

## 3. SYNC / CRON

| ENV | Default | Production | 用途 |
|---|---|---|---|
| `CRON_SECRET` | — | 必填 | Vercel cron `/api/cron/sync` 驗證 |
| `SYNC_CRON` | `30 13 * * *` | `0 14 * * *`（**Vercel cron 控制；本 ENV 僅本機 dev 用**） | 本機 standalone sync 排程 |
| `SYNC_INTERVAL_MINUTES` | `30` | local only | local 模式定期 sync 間隔 |
| `AUTO_SYNC_INTERVAL_MINUTES` | `30` | local only | 與上同義（舊名稱保留） |
| `RECOVERY_RETRY_MINUTES` | `5` | local only | sync 失敗後重試間隔 |
| `TW_LOTTERY_RESULT_URL` | hardcoded | optional override | 官方結果頁 URL |
| `TW_LOTTERY_HISTORY_RESULT_URL` | hardcoded | optional override | 官方歷史結果頁 URL |
| `TW_LOTTERY_HISTORY_DOWNLOAD_URL` | hardcoded | optional override | 官方歷史下載 URL |
| `TW_LOTTERY_API_LATEST` | `''` | optional | 官方 JSON API URL（留空走 HTML 解析） |
| `TW_LOTTERY_API_HISTORY_BASE` | `''` | optional | 官方歷史 JSON API |
| `OFFICIAL_API_URL` | unset | optional override | 官方 JSON API URL；不設走 `DEFAULT_OFFICIAL_API_URL` |
| `OFFICIAL_API_CANDIDATES` | unset | optional | 多個官方 API 備援（逗號分隔） |
| `OFFICIAL_HTML_URL` | unset | optional override | 官方 HTML 頁面 URL；不設走 `DEFAULT_OFFICIAL_HTML_URL` |
| `OPTIONAL_SECONDARY_SOURCE_URL` | unset | optional | 次要資料來源 URL（fallback 用） |
| `PILIO_ENABLED` | `false` | optional | 啟用第二資料來源 |
| `PILIO_MODE` | — | 配合 above | pilio 模式 |
| `PILIO_BASE_URL` | — | 配合 above | pilio API URL |
| `PILIO_PAGES` | — | 配合 above | 抓取頁數 |
| `PILIO_REQUEST_DELAY_MS` | — | 配合 above | 請求間隔 |
| `PILIO_TIMEOUT_MS` | — | 配合 above | 超時 |

## 4. ADMIN

| ENV | Default | Production | 用途 |
|---|---|---|---|
| `ADMIN_RESET_TOKEN` | — | 必填 | `/api/admin/reset` 重設密碼用 token |
| `ADMIN_PASSWORD_HASH` | — | （首次 setup 後自動寫入 Firestore admin 集合） | bcrypt hash |
| `ADMIN_SESSION_SECRET` | optional | optional | 若設則簽 HMAC v1 token；不設則用隨機 token（建議不設） |

## 5. PREDICTION CORE（baseline / hidden kill-switches）

baseline 行為，全部 default 已穩定。**production 預設不設 = 全部 ENABLED**。
列在 .env 只在「需要 hot-fix rollback 某個 baseline feature」時用。

| ENV | Default | 用途 / Rollback 場景 |
|---|---|---|
| `ANTIHOT_ENABLED` | `true` | 關閉 anti-hot penalty（極少用） |
| `ANTIHOT_WINDOW` | `5` | anti-hot 計算視窗 |
| `ANTIHOT_MIN_FACTOR` | `0.60` | anti-hot 最低乘性下限 |
| `ANTIHOT_SELECTION_PENALTY_ENABLED` | `true` | hidden killswitch；selection-stage penalty |
| `ANTIHOT_SELECTION_WINDOW` | `4` | hidden |
| `ANTIHOT_SELECTION_MIN_FACTOR` | `0.50` | hidden |
| `TOP_SCORE_COMPRESSION_DISABLED` | `false` | rollback compression layer |
| `PLAN_B_TUNING_ENABLED` | `false` | hidden experimental tuning |
| `POOL_DIVERSIFICATION_DISABLED` | `false` | rollback diversification |
| `SINGLE_ROTATION_DISABLED` | `false` | rollback single-rotation feature |
| `STRUCTURE_FATIGUE_REVERTED` | `false` | rollback structure-fatigue feature |

## 6. PREDICTION — MULTI_STRATEGY_V1 (Phase 1)

| ENV | Default | Production 當前 | 用途 |
|---|---|---|---|
| `MULTI_STRATEGY_ENABLED` | `false` | **`true`** | 開啟 5 策略 ensemble layer |
| `MULTI_STRATEGY_VERSION` | `multi_strategy_v1` | `multi_strategy_v1` | cache schema 後綴 |
| `STRATEGY_WEIGHT_TREND` | `0.35` | default | 5 strategy 權重，會被 normalize |
| `STRATEGY_WEIGHT_BALANCE` | `0.20` | default | |
| `STRATEGY_WEIGHT_ANTI_CONCENTRATION` | `0.20` | default | |
| `STRATEGY_WEIGHT_REVERSION` | `0.15` | default | |
| `STRATEGY_WEIGHT_COVERAGE` | `0.10` | default | |
| `MULTI_STRATEGY_MIN_SUPPORT_FACTOR` | `0.40` | default | reversion 最低 baseline 門檻 |
| `MULTI_STRATEGY_MAX_HOT_RATIO` | `0.60` | default | five_star 中 hot 號比例上限 |
| `MULTI_STRATEGY_MIN_MID_COLD_RATIO` | `0.40` | default | five_star 中 mid+cold 比例下限 |
| `MULTI_STRATEGY_RECENT_RECOMMEND_WINDOW` | `5` | default | 最近 N 期推薦視窗 |
| `MULTI_STRATEGY_PAIR_REPEAT_PENALTY` | `0.88` | default | pair 重複 penalty 倍率 |
| `MULTI_STRATEGY_TRIPLE_REPEAT_PENALTY` | `0.82` | default | triple 重複 penalty 倍率 |
| `MULTI_STRATEGY_REVERSION_BONUS` | `1.08` | default | reversion 加成倍率（>= 1.0） |
| `MULTI_STRATEGY_COVERAGE_BONUS` | `1.06` | default | coverage 加成倍率（>= 1.0） |

## 7. PREDICTION — ENSEMBLE_VOTING_V1 (Phase 2)

| ENV | Default | Candidate C | 用途 |
|---|---|---|---|
| `ENSEMBLE_VOTING_ENABLED` | `false` | **`true`** | 啟用 meta voting layer |
| `ENSEMBLE_VOTING_VERSION` | `ensemble_voting_v1` | same | cache schema 後綴 |
| `ENSEMBLE_TOP_K` | `10` | default | 每 strategy 自選 topK |
| `ENSEMBLE_MIN_SUPPORT_STRATEGIES` | `2` | default | dominance penalty 觸發門檻 |
| `ENSEMBLE_TREND_ONLY_PENALTY` | `0.72` | default | trend-only 號的衰減 |
| `ENSEMBLE_MAX_TREND_ONLY_TOP10_RATIO` | `0.35` | default | final top10 trend-only 比例上限 |
| `ENSEMBLE_PAIR_LOCK_PENALTY` | `0.82` | default | pair lock 倍率 |
| `ENSEMBLE_TRIPLE_LOCK_PENALTY` | `0.78` | default | triple lock 倍率 |
| `ENSEMBLE_DOMINANCE_WINDOW` | `5` | default | dominance 統計視窗 |
| `ENSEMBLE_PAIR_LOCK_WINDOW` | `5` | default | pair lock 統計視窗 |
| `ENSEMBLE_PAIR_LOCK_MAX_REPEAT` | `2` | default | pair 觸發門檻 |
| `ENSEMBLE_TRIPLE_LOCK_WINDOW` | `5` | default | triple lock 統計視窗 |
| `ENSEMBLE_TRIPLE_LOCK_MAX_REPEAT` | `1` | default | triple 觸發門檻 |
| `ENSEMBLE_COVERAGE_TARGET` | `39` | default | diagnostic only |
| `ENSEMBLE_MAX_SINGLE_STRATEGY_DOMINANCE` | `0.40` | default | diagnostic only |
| `ENSEMBLE_STRATEGY_WEIGHT_TREND` | `0.22` | default | meta voting strategy 權重 |
| `ENSEMBLE_STRATEGY_WEIGHT_BALANCE` | `0.22` | default | |
| `ENSEMBLE_STRATEGY_WEIGHT_ANTI_CONCENTRATION` | `0.22` | default | |
| `ENSEMBLE_STRATEGY_WEIGHT_REVERSION` | `0.17` | default | |
| `ENSEMBLE_STRATEGY_WEIGHT_COVERAGE` | `0.17` | default | |

## 8. PREDICTION — ENSEMBLE 2.5（核心群控制）

| ENV | Default | **Candidate C** | 用途 |
|---|---|---|---|
| `ENSEMBLE_NUMBER_EXPOSURE_WINDOW` | `10` | default | exposure 統計視窗 |
| `ENSEMBLE_NUMBER_EXPOSURE_MAX_REPEAT` | `4` | **`3`** | 號碼曝光 ≥ 此值起算 penalty |
| `ENSEMBLE_NUMBER_EXPOSURE_PENALTY` | `0.80` | **`0.75`** | exposure 倍率 |
| `ENSEMBLE_HOT_TOP10_MAX_RATIO` | `0.35` | default | trend topK 在 top10 比例上限 |
| `ENSEMBLE_HOT_TOP10_PENALTY` | `0.84` | default | hot top10 倍率 |
| `ENSEMBLE_CORE_GROUP_PENALTY` | `0.82` | **`0.78`** | core group 倍率 |
| `ENSEMBLE_CORE_GROUP_WINDOW` | `10` | default | three_star 視窗 |
| `ENSEMBLE_CORE_GROUP_MAX_EXPOSURE` | `4` | **`3`** | core group 觸發門檻 |
| `ENSEMBLE_CONSENSUS_PROTECTION_MIN_SUPPORT` | `3` | default | 共識保護門檻 |
| `ENSEMBLE_CONSENSUS_PROTECTION_FACTOR` | `0.50` | default | 共識保護嚴重度減半 |

## 8.5 Dynamic Window v1（soft 多視窗 re-weighting；預設關閉）

詳見 [DYNAMIC_WINDOW_DESIGN.md](DYNAMIC_WINDOW_DESIGN.md)。

| ENV | Default | Production 當前 | 用途 |
|---|---|---|---|
| `DYNAMIC_WINDOW_ENABLED` | `false` | `false` | 總開關 |
| `DYNAMIC_WINDOW_VERSION` | `dynamic_window_v1` | same | cache schema 後綴 |
| `DYNAMIC_WINDOW_WEIGHT` | `0` | `0` | 倍率上限（建議 0.05） |
| `DYNAMIC_WINDOW_MIN_OBSERVATIONS` | `30` | default | draws 不足時 dormant |
| `DYNAMIC_WINDOW_MIN_WINDOW` | `10` | default | 視窗下限（diagnostic） |
| `DYNAMIC_WINDOW_MAX_WINDOW` | `100` | default | 視窗上限（diagnostic） |
| `DYNAMIC_WINDOW_W1` / `W1_WEIGHT` | `30` / `0.35` | default | 視窗 1 與權重 |
| `DYNAMIC_WINDOW_W2` / `W2_WEIGHT` | `60` / `0.30` | default | 視窗 2 |
| `DYNAMIC_WINDOW_W3` / `W3_WEIGHT` | `70` / `0.20` | default | 視窗 3 |
| `DYNAMIC_WINDOW_W4` / `W4_WEIGHT` | `80` / `0.15` | default | 視窗 4 |

啟用條件：`MULTI_STRATEGY_ENABLED=true` + `ENSEMBLE_VOTING_ENABLED=true`。

## 9. LEGACY / DEPRECATED（已於 2026-05 cleanup 移除）

下面這些 ENV **曾經出現在 .env.example 但完全沒被任何程式碼引用**，已從 .env.example 刪除：

| ENV | 原狀態 | Cleanup 結果 |
|---|---|---|
| `HISTORY_MODE` | 未引用（無 process.env 讀取） | **刪除** |
| `HISTORY_START_YEAR` | 未引用 | **刪除** |
| `HISTORY_RECENT_LIMIT` | 未引用 | **刪除** |
| `HTTP_PROXY` | 註解形式存在但不會被 Node 自動使用 | **刪除** |

若 production .env 仍有設這些值，**沒有副作用**（被忽略）；但建議比照 .env.example 移除以保持一致。

## Rollback 速查

| 目標 | 設定 |
|---|---|
| **Baseline only** | `MULTI_STRATEGY_ENABLED=false`<br>`ENSEMBLE_VOTING_ENABLED=false` |
| **Multi-strategy v1（目前 production）** | `MULTI_STRATEGY_ENABLED=true`<br>`ENSEMBLE_VOTING_ENABLED=false` |
| **Ensemble v1 default (Phase 2)** | `MULTI_STRATEGY_ENABLED=true`<br>`ENSEMBLE_VOTING_ENABLED=true` |
| **Candidate C（Phase 2.5 推薦）** | 上 + 4 個 EXPOSURE/CORE 微調 ENV：<br>`ENSEMBLE_NUMBER_EXPOSURE_MAX_REPEAT=3`<br>`ENSEMBLE_NUMBER_EXPOSURE_PENALTY=0.75`<br>`ENSEMBLE_CORE_GROUP_MAX_EXPOSURE=3`<br>`ENSEMBLE_CORE_GROUP_PENALTY=0.78` |

Cache schema 跟隨 ENV 自動失效；rollback 不需手動清。

## Production Rollout 流程（搭配 PREVIEW_OBSERVATION_GUIDE.md）

1. **本機 cloud-readonly**：設 `CLOUD_READONLY=true` + Candidate C ENV，跑 3-5 天
2. **Vercel Preview**：6 個 Candidate C ENV 勾「只 Preview」，觀察 10-14 天
3. **Production**：通過 PREVIEW_OBSERVATION_GUIDE 第 11 條 6 項驗收後，把 6 個 ENV 複製到 production scope → redeploy
4. **保留 Preview ENV 1 週備援**

## Active / Legacy / Unused 總結

- **Active 且 production 用到的**：所有 INFRA、SYNC/CRON、ADMIN、`MULTI_STRATEGY_*`、HISTORY_*
- **Active 但 Local-only**：`SYNC_INTERVAL_MINUTES`、`AUTO_SYNC_INTERVAL_MINUTES`、`RECOVERY_RETRY_MINUTES`、`SYNC_CRON`、`DB_PATH`、`VITE_API_BASE_URL`
- **Active 但目前未啟用（rollback 用）**：`ENSEMBLE_*` 全部（待 Candidate C 通過觀察期才開）、PILIO_*、hidden kill-switches
- **Legacy / Unused（建議下次刪）**：`OFFICIAL_API_URL`、`OFFICIAL_API_CANDIDATES`、`OFFICIAL_HTML_URL`、`OPTIONAL_SECONDARY_SOURCE_URL`
