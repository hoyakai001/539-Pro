# Deployment Guide — 從零到 Production

> 從「全新電腦零環境」到「Vercel production 部署」的完整流程。
> 包含本機 dev / cloud-readonly / Vercel Preview / Production 四個階段。

---

## A. 全新電腦從零安裝（10-15 分鐘）

### A1. 安裝 Node.js + Git
- **Node.js**：下載 [LTS 24.x](https://nodejs.org/)（與 `package.json#engines.node` 對應）
- **Git**：[git-scm.com](https://git-scm.com/) 或用 ZIP 下載
- 驗證：`node -v` 顯示 `v24.x`，`npm -v` 顯示 `10.x+`

### A2. 取得專案
**方法 1（推薦）：git clone**
```bash
git clone https://github.com/<your-user>/<repo>.git 539-system
cd 539-system
```

**方法 2：GitHub ZIP**
1. GitHub repo → Code → Download ZIP
2. 解壓縮到任意位置
3. `cd` 進去

### A3. 安裝相依套件
```bash
npm install                 # root（vercel-build 工具 + concurrently）
cd backend && npm install   # backend deps（express、better-sqlite3、firebase-admin、ts-node-dev）
cd ../frontend && npm install  # frontend deps（vite、react）
cd ..
```

或一行：`npm run install:all`

### A4. 建立 .env
依使用場景挑一個範本：

| 場景 | 範本 | 行為 |
|---|---|---|
| 本機完全離線 / SQLite | `backend/.env.local.example` | 不連 Firestore、本機 SQLite 自行同步 |
| 本機看 cloud 資料（推薦 dev） | `backend/.env.cloud-readonly.example` | 讀 production Firestore、寫入被擋 |
| Vercel deploy | （在 Vercel UI 設 ENV，不用本機 .env） | — |

複製：
```bash
cp backend/.env.cloud-readonly.example backend/.env
```
然後編輯 `backend/.env`，填入：
- `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`（從 Firebase Console → Project Settings → Service Accounts 下載 service account JSON 拼回去）
- `ADMIN_RESET_TOKEN` / `CRON_SECRET`（自定字串）
- 確認 `CLOUD_READONLY=true`（本機 dev 安全網）

ENV 完整對照表：[ENV_GUIDE.md](ENV_GUIDE.md)

### A5. 本機啟動
```bash
npm run dev   # 同時起 backend (3001) + frontend (5173)
```

開啟瀏覽器：
- `http://localhost:5173`（前端）
- `http://localhost:3001/api/health`（後端健檢）

### A6. 驗證
```bash
npm run verify:local -- --skip-bootstrap   # 全套自動測試
```
預期：`[PASS] verify:local completed`

第一次跑可省略 `--skip-bootstrap`，會自動從官方下載歷史資料到本機 verify SQLite（5-10 分鐘）。

---

## B. 本機 cloud-readonly dev（日常使用）

✅ 看 production Firestore 最新資料  
✅ Firestore writes 全部被擋  
✅ 適合連續觀察 ensemble 行為

```bash
# 一行啟動
CLOUD_READONLY=true npm run dev
```

或在 `backend/.env` 內固定設 `CLOUD_READONLY=true`。

驗證 cloud-readonly 生效：
```bash
curl -s http://localhost:3001/api/health | jq .cloud_readonly   # → true
curl -s -X POST http://localhost:3001/api/sync-now \
  -o /dev/null -w "%{http_code}\n"                              # → 403
```

---

## C. Vercel Preview 部署（觀察期）

詳細步驟：[PREVIEW_OBSERVATION_GUIDE.md](PREVIEW_OBSERVATION_GUIDE.md)

簡述：
1. push branch 到 GitHub → Vercel 自動建 Preview deployment
2. 在 Vercel Dashboard → Settings → Environment Variables：勾「Preview only」加入：
   - `MULTI_STRATEGY_ENABLED=true`
   - `ENSEMBLE_VOTING_ENABLED=true`（如要試 Candidate C）
   - 4 個 Candidate C 微調 ENV（見 [ENV_GUIDE.md](ENV_GUIDE.md)）
   - 強烈建議：`CLOUD_READONLY=true`（Preview-only）
3. 取得 Preview URL，從第二天開始每天 `npm run observe:prediction` 累積觀察記錄

---

## D. Vercel Production 部署

### D1. 必要的 Production ENV（Vercel Dashboard 勾「Production」）

從 [ENV_GUIDE.md](ENV_GUIDE.md) section 1, 3, 4：

```
APP_MODE=cloud
NODE_ENV=production
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...        ← 含換行的整段
CRON_SECRET=...
ADMIN_RESET_TOKEN=...
```

當前生效的 Strategy ENV（multi_strategy_v1 啟用，ensemble OFF）：
```
MULTI_STRATEGY_ENABLED=true
MULTI_STRATEGY_VERSION=multi_strategy_v1
ENSEMBLE_VOTING_ENABLED=false   ← Phase 2.5 候選版尚未上 production
```

### D2. 部署
1. push 到 `main` branch（或設定為 production branch）
2. Vercel 自動 build + deploy
3. Cron 自動跑：`0 14 * * *` UTC = 22:00 台北（在 [vercel.json](vercel.json) 設定）

### D3. 部署後驗證

```bash
PROD="https://<your-prod-domain>"
curl -s "$PROD/api/health" | jq                          # cloud_readonly:false, mode:node
curl -s "$PROD/api/data/status" | jq .data.dataStatus.status   # VALID
curl -s "$PROD/api/prediction/today" | jq .data.single        # 數字 1-39
curl -s "$PROD/api/observations/status?window=10" | jq .data  # rolling 統計（可能 sample_size 為 0 直到 cron 跑過）
```

### D4. 第一次 cron 觸發
Cron 由 Vercel 排程觸發；想立即觸發：
1. 登入 admin（`POST /api/admin/setup` 設密碼一次）
2. `POST /api/sync-now`（帶 admin token）→ 強制跑一次完整 sync flow，會：
   - 抓最新一期
   - upsert draws
   - 評估前一期 prediction（若 cached）
   - 寫 observation_logs
   - 更新 latest_draw cache

---

## E. Rollback 流程

| 場景 | 動作 |
|---|---|
| **Strategy 退回 multi_strategy_v1** | Vercel UI：`ENSEMBLE_VOTING_ENABLED=false` → Redeploy production |
| **Strategy 退回 baseline** | `MULTI_STRATEGY_ENABLED=false` + `ENSEMBLE_VOTING_ENABLED=false` → Redeploy |
| **Code rollback** | Vercel Deployments 頁面 → 找前一個 healthy build → "Promote to Production" |
| **Cron 暫停** | 移除 [vercel.json](vercel.json) `crons` 欄位 → push → 部署 |
| **完全離線回到本機** | `CLOUD_READONLY=true` + `APP_MODE=` 在 `.env` → `npm run dev` |

ENV 修改後**必須 Redeploy** 才會生效（Vercel ENV 不會 hot-reload）。

---

## F. 完整 sync → prediction → observation flow

```
22:00 台北 (UTC 14:00)
  ↓
Vercel cron POST /api/cron/sync (header: x-vercel-cron-secret)
  ↓
backend/src/api/routes.ts:180 router.all('/cron/sync')
  ↓ cronAuthStatus() 認證
  ↓ cloudSyncNow({ type: 'cron-sync' })
  ↓
backend/src/data/cloudSync.ts:52 cloudSyncNow()
  ↓ fetchLatest() 從 taiwanlottery.com 抓最新一期
  ↓ insertDraw() upsert 'draws' collection (doc id = draw_no)
  ↓ evaluatePredictionForDraw(draw)
  │   ↓ getPredictionByDrawNo() 找對應的 cached prediction
  │   ↓ saveObservation() upsert 'observation_logs'
  │       doc id = `${target_draw_no}_${model_version}` → 不重複寫
  │       含 ensemble diagnostic fields（trend_only / penalty counters / core_group_count）
  ↓ setCache('latest_draw', ...) 更新 stats_cache
  ↓ writeCloudSyncLog() 寫 sync_logs
  ↓
（cron 完成）
  ↓
其他 cron / 隔天 user 開 frontend：
  GET /api/prediction/today 命中 stats_cache → 0 額外 Firestore 讀
  GET /api/observations/status?window=30 讀最近 30 筆 observation_logs
```

詳細：[OBSERVATION_GUIDE.md](OBSERVATION_GUIDE.md)

---

## G. 故障排查

| 症狀 | 檢查 |
|---|---|
| `/api/health` 回 500 | Vercel function logs → 多半是 `FIREBASE_PRIVATE_KEY` 換行格式錯 |
| `/api/prediction/today` 慢 | 第一次 cache miss 需 ~3 秒；cache hit 後 <100ms |
| `/api/observations/status` `ready: false` | 還沒 cron 跑過，observation_logs 是空的；手動 `/api/sync-now` 觸發 |
| Cron 沒跑 | Vercel Dashboard → Cron Jobs → 看執行紀錄；常見：`CRON_SECRET` mismatch |
| Frontend 連不到 backend | `VITE_API_BASE_URL` 設錯（production 用 `/api`、dev 用 `http://localhost:3001/api`） |
| `CLOUD_READONLY_BLOCKED` 出現在 production | `CLOUD_READONLY` 不該在 production 設 true。檢查 ENV scope |

---

## H. 安全 checklist（每次 deploy 前）

- [ ] `.env` 不在 git（檢查 `git status` 看不到 `.env`，只看到 `.env.example`）
- [ ] Firebase service account 已限制權限（只開 Firestore，不開其他 GCP API）
- [ ] `CRON_SECRET` 已設且 production 與 Vercel 一致
- [ ] `ADMIN_RESET_TOKEN` 已設且不外流
- [ ] `CLOUD_READONLY=true` **不在** production scope（只在本機 dev / Preview）
- [ ] Vercel cron secret 已在 Vercel project setting 設好
- [ ] `vercel.json` 的 cron schedule 正確（`0 14 * * *`）
