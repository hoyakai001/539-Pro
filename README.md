# 539-system

「純歷史統計抓牌系統」。固定策略版本 `v6.1-three-star-stable` + 5-strategy ensemble voting layer。
資料只允許來自官方開獎來源；**不用 AI、不用隨機、不用假資料、不用未來資料回測**。

本機：SQLite。雲端：Firebase Firestore（受限讀取 + `stats_cache`，避免免費額度爆量）。

## 📚 Source-of-Truth Docs（精簡版，2026-05 cleanup 後）

**新加入專案請依這 4 份看：**

1. **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** — 全新電腦從零到 production 完整流程
2. **[ENV_GUIDE.md](ENV_GUIDE.md)** — 所有 ENV 用途、預設值、active/legacy/unused
3. **[OBSERVATION_GUIDE.md](OBSERVATION_GUIDE.md)** — observation_logs 設計、API、健康檢查
4. **[PREVIEW_OBSERVATION_GUIDE.md](PREVIEW_OBSERVATION_GUIDE.md)** — Vercel Preview 觀察期 SOP

**策略架構（current production stack）：**

5. **[ENSEMBLE_VOTING_DESIGN.md](ENSEMBLE_VOTING_DESIGN.md)** — Phase 2 / 2.5 meta voting 完整設計
6. **[ENSEMBLE_VOTING_COMPARE.md](ENSEMBLE_VOTING_COMPARE.md)** — Phase 2 / 2.5 compare 數據 + Candidate C 來源

**策略演進歷史（不需常看）：**

7. [MULTI_STRATEGY_DESIGN.md](MULTI_STRATEGY_DESIGN.md) — Phase 1 五策略 ensemble baseline 設計
8. [MULTI_STRATEGY_COMPARE.md](MULTI_STRATEGY_COMPARE.md) — Phase 1 compare 報告
9. [docs/STRATEGY_FULL.md](docs/STRATEGY_FULL.md) — baseline 策略全貌
10. [docs/CLOUD_DEPLOY_FIREBASE_VERCEL.md](docs/CLOUD_DEPLOY_FIREBASE_VERCEL.md) — Firebase Console UI 設定步驟

## ⚡ Quick Start

```bash
# 全新電腦
git clone <repo> && cd 539-system
npm run install:all
cp backend/.env.cloud-readonly.example backend/.env
# → 編輯 backend/.env：填 Firebase 憑證 + ADMIN_RESET_TOKEN + CRON_SECRET
CLOUD_READONLY=true npm run dev
# → 開 http://localhost:5173
```

完整流程：[DEPLOYMENT_GUIDE.md#A-全新電腦從零安裝](DEPLOYMENT_GUIDE.md#a-全新電腦從零安裝10-15-分鐘)

## 🎯 Strategy Stack（current production）

```
DrawEntry → baseline scoring (v6.1-three-star-stable)
          → multi_strategy_v1 (5-strategy weighted ensemble) [ENABLED]
          → ensemble_voting_v1 (meta voting + penalties)     [DISABLED — Candidate C 觀察期中]
          → prediction (single / two / three / four / five star)
          → cache (stats_cache.prediction_today)

22:00 cron sync → 抓官方最新 → evaluate prediction → upsert observation_logs
```

詳細：[OBSERVATION_GUIDE.md#observation-流程一覽](OBSERVATION_GUIDE.md#observation-流程一覽)

---

## 專案架構

- `frontend/`：Vite React dashboard，使用 `VITE_API_BASE_URL` 指向 API。
- `backend/`：Express API、官方資料同步、資料驗證、v6.1 固定策略輸出。
- `api/`：Vercel serverless entry，將 `/api/*` 導到 backend app。
- `backend/src/db/adapters/`：資料層切換，`SQLiteAdapter` 與 `FirestoreAdapter` 共用同一個 adapter 介面。
- `backend/data/`：本機 SQLite 預設位置，不能提交到 Git。
- `stats_cache`：雲端 Firestore cache collection，用於最新資料、今日 prediction、100期號碼分析、30期命中統計與資料狀態。

## 系統模式

### Local Mode

`APP_MODE=local` 或未設定 `APP_MODE=cloud` 時使用 SQLite。

- 適合開發、回測、完整歷史資料維護。
- 預設 DB：`backend/data/539.db`
- 可用 `SQLITE_PATH` 指定 DB。

### Cloud Mode

`APP_MODE=cloud` 時使用 Firestore。

- 禁止依賴 `DB_PATH`。
- 禁止掃描整個 `draws` collection。
- prediction 最多讀最近 120 期。
- number-analysis 固定讀最近 100 期。
- history 預設讀最近 30 期。
- performance 只讀最近 30 到 60 筆 observation。

## 安裝方式

新電腦建議先安裝 Node.js LTS。

```bash
npm run install:all
```

建立環境變數檔可參考 `.env.example`。正式 key 請放在本機 `.env`、`backend/.env`、Vercel ENV 或系統環境變數，不要提交到 Git。

## 本機啟動

```bash
npm run dev
```

預設：

- Backend: `http://localhost:3001`
- Frontend: `http://localhost:5173`
- SQLite: `backend/data/539.db`

Build：

```bash
npm run build
```

## Firebase 設定

1. 到 Firebase Console 建立專案。
2. 啟用 Firestore Database。
3. 到 Project settings > Service accounts。
4. 產生新的 private key JSON。
5. 將以下欄位填入環境變數：

```env
APP_MODE=cloud
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
ADMIN_RESET_TOKEN=
CRON_SECRET=
```

`FIREBASE_PRIVATE_KEY` 注意事項：

- 若放在 Vercel，通常整段 key 可直接貼上。
- 若使用單行 `.env`，換行可寫成 `\n`，程式會自動轉回真正換行。
- 不要把 private key 放進 repo。

Firestore collections：

- `draws`
- `predictions`
- `observation_logs`
- `admin`
- `stats_cache`
- `sync_logs`（若有遷移）
- `system_status`（若有遷移）

## Vercel 部署

1. 將專案推到 GitHub。
2. 在 Vercel 匯入 repo。
3. Build command 使用：

```bash
npm run build
```

4. 設定 Vercel Environment Variables：

```env
APP_MODE=cloud
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
ADMIN_RESET_TOKEN=
CRON_SECRET=
VITE_API_BASE_URL=/api
```

可選的歷史範圍設定：

```env
HISTORY_MODE=year
HISTORY_START_YEAR=2026
HISTORY_RECENT_LIMIT=120
ANTIHOT_ENABLED=true
ANTIHOT_WINDOW=5
ANTIHOT_MIN_FACTOR=0.60
```

`HISTORY_MODE=year` 會以今年資料為主；`HISTORY_MODE=recent` 則以最近 N 期為主。雲端 API 仍會套用各 endpoint 的讀取上限。

5. `vercel.json` 已設定 API rewrite 與 cron：

```json
{
  "crons": [
    { "path": "/api/cron/sync", "schedule": "0 14 * * *" }
  ]
}
```

`0 14 * * *` 是 UTC 14:00，約台灣 22:00。

## 同步機制

- 一般使用者不顯示同步按鈕，也不能呼叫雲端同步。
- 管理員登入後才顯示「立即同步」。
- 管理員同步 5 分鐘內不可重複。
- Cron 使用 `/api/cron/sync`，必須帶 `CRON_SECRET`。

Cron 行為：

- 沒新資料：回 `NO_NEW_DATA`，不重算、不刷新 cache。
- 有新資料：寫入 `draws`，評估相同 target 的 prediction，更新 latest cache。
- 官方來源失敗：回明確錯誤，不補假資料。

## 資料來源

資料來源順序：

1. 官方 API
2. 官方 API candidates
3. 官方 HTML fallback
4. Pilio 只能 verifyOnly 或 backup，不能取代官方主資料

若官方資料無法確認，系統會進入等待狀態，不會用舊資料假裝最新。

## 流量控制與 Cache

雲端 Firestore 免費版不能長期掃全表，因此 cloud mode 有硬限制：

- `draws` 查詢使用 `orderBy(draw_no desc).limit(120)`。
- prediction 最多讀 120 期。
- number-analysis 只讀 100 期。
- history 預設讀 30 期，最高只讀 100 期。
- performance 只讀 30 到 60 筆 observation。

`stats_cache` keys：

- `latest_draw`
- `prediction_today`
- `number_analysis_100`
- `performance_30`
- `data_status`

Cache 規則：

- latest draw 沒變時，prediction/today 直接回 cache，不重算、不讀 draws。
- latest draw 沒變時，number-analysis 直接回 cache。
- performance 使用 observation limit 並 cache。
- cache response 會帶 `read_estimate`，可用來檢查讀取量。

## Migration：本機 SQLite 搬到 Firebase

預設不搬 2007 以來全歷史資料，避免爆量。預設範圍是今年資料；若今年資料不足 100 期，會 fallback 最近 150 期。

若本機 DB 少於 200 期但已有至少 120 期，migration 可先搬最近可用資料到 Firestore；`prediction/today`、`latest-draw`、`number-analysis` 仍可用，完整 100-sample A/B backtest 會標記為 `sample_insufficient`，等資料累積到 200 期後再完整驗證。

支援參數：

```bash
npm run migrate:firestore -- --dry-run
npm run migrate:firestore -- --dry-run --recent=150
npm run migrate:firestore -- --dry-run --year=2026
```

正式寫入必須加 `--yes`：

```bash
npm run migrate:firestore -- --yes --recent=150
```

SQLite 路徑偵測順序：

1. `DB_PATH`
2. `backend/data/539.db`
3. `data/539.db`

Dry-run 會顯示：

- SQLite DB path
- draws 筆數
- predictions 筆數
- observation_logs 筆數
- admin 是否存在
- sync_logs 筆數
- 將寫入哪些 Firestore collections

正式搬移後到 Firebase Console 檢查：

- `draws`
- `predictions`
- `observation_logs`
- `admin`
- `stats_cache`

再測試：

```bash
curl "https://YOUR_APP/api/prediction/today"
curl "https://YOUR_APP/api/stats/number-analysis?window=100&view=summary"
curl -X POST "https://YOUR_APP/api/cron/sync?secret=$CRON_SECRET"
```

## Admin Reset

若管理員密碼未知，可用環境變數 `ADMIN_RESET_TOKEN` 重設：

```bash
curl -X POST https://YOUR_APP/api/admin/reset \
  -H "Content-Type: application/json" \
  -d "{\"reset_token\":\"$ADMIN_RESET_TOKEN\",\"new_password\":\"NewPassword123!\"}"
```

密碼只存 hash，不存明文。

## Verify

執行：

```bash
npm run verify:all
```

常用單項：

```bash
npm run verify:firestore-limit
npm run verify:cache
npm run verify:quota-handler
npm run verify:local-mode
npm run verify:cloud-mode
npm run verify:migrate-firestore
```

verify 會檢查：

- 不使用假資料、隨機、硬寫 prediction/stat。
- v6.1 prediction target 與 lock 規則。
- Firestore 查詢上限。
- cache key 與 cache hit read estimate。
- quota error 不 crash 500。
- local/cloud adapter 切換。
- migration 不預設全量搬資料。

## 常見錯誤

### 500 error 或 Firebase quota

若 Firestore 額度用完，API 會回：

```json
{
  "success": false,
  "status": "FIREBASE_QUOTA_EXCEEDED",
  "message": "今日額度已用完"
}
```

前端會顯示「系統今日額度已用完，請明天再試」。

### Firebase key 錯誤

檢查：

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- private key 是否保留換行或使用 `\n`

### tsc not found

請先安裝依賴：

```bash
npm run install:all
```

frontend build 使用 `vite build`，不依賴單獨的 frontend `tsc` 指令。

### Dashboard 顯示暫無資料

通常代表 Firestore 是空的。請先執行 migration 或管理員 bootstrap。

### Cron 未跑

檢查：

- Vercel 是否啟用 Cron。
- `CRON_SECRET` 是否設定。
- `/api/cron/sync?secret=...` 是否能手動呼叫。

## 30 期固定版本觀察

v6.1 是固定版本觀察，不會每期沒中就改參數。

```bash
curl "https://YOUR_APP/api/strategy/observation?limit=30"
```

一般 UI 只顯示簡短累積狀態；管理員模式可看詳細紀錄。

## multi_strategy_v1（5 策略 ensemble，可選開關）

baseline 是單一歷史統計排序模型，傾向高頻 / 熱號 / 強共現 pair 與 triple，造成推薦集中在少數組合。multi_strategy_v1 在 baseline 之上加一層 5 策略 ensemble：trend / balance / anti-concentration / reversion / coverage。

啟用：
```env
MULTI_STRATEGY_ENABLED=true
```

預設權重 35/20/20/15/10，可由 ENV 覆寫。完整設計與比較見 [MULTI_STRATEGY_DESIGN.md](MULTI_STRATEGY_DESIGN.md) 與 [MULTI_STRATEGY_COMPARE.md](MULTI_STRATEGY_COMPARE.md)。

關閉（rollback）：把 ENV 移除即可，cache schema 自動回復 baseline，舊 baseline cache 立即生效。

## 同步 / cron / 部署檢查

- Vercel cron 排程仍是 `0 14 * * *`（台灣 22:00 自動同步一次）。
- production 不要設 `CLOUD_READONLY=true`，否則 cron 會被擋。
- 本機 cloud-readonly dev 才設 `CLOUD_READONLY=true`，避免污染雲端。
- `/api/cron/sync`、`/api/sync-now`、`/api/sync-history` 全部保留；mutation route 在 cloud-readonly 下會回 `403 CLOUD_READONLY_BLOCKED`。
- 推到 GitHub 後 Vercel 自動 build → deploy；build command 仍是 `npm run build`，output 仍是 `frontend/dist`。

## 系統限制與風險

本系統只做歷史統計、資料稽核、回測與固定策略輸出。它不是保證中獎工具，也不是 AI 明牌系統。所有下注建議都只是根據最近 100 期真實歷史資料計算出的統計結果，仍然存在風險。

若資料來源異常、官方資料無法確認或資料不足，系統應停止正式出牌或顯示等待狀態，不會補假資料。
