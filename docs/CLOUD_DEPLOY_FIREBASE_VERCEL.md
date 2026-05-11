# Cloud Deploy Guide: Firebase Firestore + Vercel

這份文件說明如何把 539-system 從本機 SQLite 版部署成 Vercel + Firebase Firestore 網站版，同時避免 Firestore 免費版 quota 爆掉。

## 1. 為什麼不能直接把 SQLite 丟到 Vercel

Vercel 的 serverless runtime 不適合當長期可寫入的 SQLite 主機：

- serverless 檔案系統不是穩定資料庫。
- instance 可能隨時重建。
- SQLite 檔案不應放進 build artifact。
- 多個 serverless instance 同時寫 SQLite 會有一致性風險。

所以本機 SQLite 不應直接上傳到 Vercel。正確方式是把必要資料轉成 Firestore 文件。

## 2. Firebase Firestore 與 Vercel 的角色

Firebase Firestore 是拿來存網站營運資料，不是拿來跑完整歷史策略的大資料倉庫。

Vercel 負責：

- frontend
- serverless API
- cron
- 管理員操作入口

Firestore 負責：

- `draws`
- `predictions`
- `observation_logs`
- `admin`
- `sync_logs`
- `stats_cache`

策略計算仍在 backend API 內執行，但 cloud mode 必須只讀必要資料，並且用 cache。

## 3. 本機 SQLite 與雲端 Firestore 分工

### local mode

- 使用 SQLite。
- 可保留完整歷史資料。
- 用於本機測試、開發、完整稽核、回測、migration。
- 可用 `SQLITE_PATH` 指定 DB。

### cloud mode

- 使用 Firestore。
- 只保留今年資料或最近約 150 期必要資料。
- API 必須 limit + cache。
- 不使用 `DB_PATH`。
- 不掃全表。

## 4. 什麼是完全移植

「完全移植」不是把 SQLite 檔案上傳到 Vercel。

正確意思是：

- `draws` 搬到 Firestore。
- `predictions` 搬到 Firestore。
- `observation_logs` 搬到 Firestore。
- `admin` 設定搬到 Firestore。
- `sync_logs` 可只搬最近 N 筆。
- API 行為 local/cloud 一致。
- 本機能看的資料，雲端也能透過 API 看。

網站版不需要完整 2007 起歷史才能運作。v6.1 主模型只需要最近 100 期；prediction 最多讀 120 期。

## 5. Firebase quota 注意事項

Firestore 免費版會計算讀取與寫入文件數。

容易爆 quota 的行為：

- 一次搬 2007 起全部資料。
- 重跑全量 migration。
- 全表掃描 `draws`。
- 狂刷 `/api/sync-now`。
- verify 或 API 測試反覆讀幾千筆。

之前爆掉的典型原因是：全量 migration + verify + API 測試，造成大量讀寫。

正確做法：

- history 預設只讀 30。
- number-analysis 只讀 100。
- prediction/today 最多讀 120。
- performance 最多讀 30 到 60。
- sync_logs 最多讀 50。
- latest 沒變就回 `stats_cache`。

## 6. 正確 migration

建議先用 dry-run：

```bash
npm run migrate:firestore -- --dry-run --recent=150
```

或搬今年：

```bash
npm run migrate:firestore -- --dry-run --year=2026
```

確認筆數後才正式寫入：

```bash
npm run migrate:firestore -- --yes --recent=150
```

如果本機 DB 少於 200 期但已有至少 120 期，可以先搬最近可用資料到 Firestore。雲端仍可提供 `latest-draw`、`prediction/today` 與 `number-analysis`；只有完整 100-sample A/B backtest 會標記為 `sample_insufficient`，等資料累積到 200 期後再跑完整驗證。

預設策略：

- 預設只搬今年資料。
- 若今年不足 100 期，fallback 最近 150 期。
- 不預設搬 5853 筆。
- document id 固定，因此 idempotent，重跑不重複。

如果真的要搬全歷史，必須明確加：

```bash
npm run migrate:firestore -- --yes --all-history --confirm-all-history
```

不建議在免費版 Firestore 使用這個模式。

## 7. Vercel ENV 設定

```env
APP_MODE=cloud
NODE_ENV=production
HISTORY_MODE=year
HISTORY_START_YEAR=2026
HISTORY_RECENT_LIMIT=120
ANTIHOT_ENABLED=true
ANTIHOT_WINDOW=5
ANTIHOT_MIN_FACTOR=0.60
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
ADMIN_RESET_TOKEN=
CRON_SECRET=
TW_LOTTERY_RESULT_URL=
TW_LOTTERY_HISTORY_DOWNLOAD_URL=
TW_LOTTERY_HISTORY_RESULT_URL=
TW_LOTTERY_API_LATEST=
TW_LOTTERY_API_HISTORY_BASE=
VITE_API_BASE_URL=
```

`VITE_API_BASE_URL` 若前後端同站，可用 `/api`。

## 8. Firebase private_key 格式

Firebase service account JSON 裡的 `private_key` 會包含換行。

在 Vercel ENV 可直接貼整段。如果放在單行 `.env`，可用 `\n` 代表換行。程式會把 `\n` 轉回真正換行。

常見錯誤：

- 少了 `-----BEGIN PRIVATE KEY-----`
- 少了 `-----END PRIVATE KEY-----`
- 把 `\n` 寫成普通文字但程式沒有轉換
- Vercel ENV 改完沒有 redeploy

## 9. Cron 設定

`vercel.json` 使用每日一次 cron：

```json
{
  "crons": [
    { "path": "/api/cron/sync", "schedule": "0 14 * * *" }
  ]
}
```

說明：

- `0 14 * * *`：UTC 14:00，也就是台灣時間 22:00 主動同步。

Cron 使用 `CRON_SECRET`，不需要管理員登入。

Cron 行為：

- 沒新資料：回 `NO_NEW_DATA`，不重算、不刷新全部 cache。
- 有新資料：寫入 `draws`，evaluate matching prediction，更新必要 cache。
- 官方資料失敗：回錯誤，不補假資料。

## 10. UI 與同步權限

一般使用者：

- 不顯示「立即同步」。
- 不顯示同步 UI。
- 不可呼叫 `/api/sync-now`。

管理員：

- 登入後才看到同步按鈕。
- `/api/sync-now` 需要 admin token。
- 5 分鐘內不可重複手動同步。

## 11. Firestore API 讀取量

主要 API 目標讀取量：

- `/api/latest-draw`：cache hit 0 draws；miss 1 draw。
- `/api/data/status`：cache hit 0 draws；miss 最多 100 draws。
- `/api/prediction/today`：cache hit 0 draws；miss 最多 120 draws。
- `/api/stats/number-analysis?window=100`：cache hit 0 draws；miss 100 draws。
- `/api/history/draws?recent=30`：30 draws。
- `/api/strategy/performance?window=30`：30 observations。
- `/api/sync-logs?limit=50`：最多 50 sync logs。

## 12. 常見問題

### Firebase quota exceeded

表示 Firestore 今日讀寫額度用完。API 應回：

```json
{
  "success": false,
  "status": "FIREBASE_QUOTA_EXCEEDED",
  "message": "今日額度已用完"
}
```

解法：

- 等隔日額度恢復。
- 確認沒有全表掃描。
- 不要重跑全量 migration。
- 確認 cache hit。

### Vercel 500

可能原因：

- Firebase key 格式錯。
- Firestore quota 用完但 handler 沒攔。
- ENV 沒設或沒 redeploy。
- API 嘗試使用本機 SQLite。

### 沒資料

可能原因：

- Firestore 還是空的。
- migration 沒跑。
- migration 跑到錯的 Firebase project。
- `APP_MODE=cloud` 未設定。

### build tsc not found

先跑：

```bash
npm run install:all
```

frontend build 使用 `vite build`。

### Firebase private key 格式錯

檢查 private key 是否包含完整 header/footer，換行是否正確。

### Vercel env 沒生效

Vercel ENV 改完需要重新部署。Preview / Production 的 ENV 要分別確認。

### 一般使用者看到同步按鈕

檢查 frontend 是否先呼叫 `/api/admin/status`，且 `authenticated=false` 時不 render button。預設狀態必須是不顯示。

### 本機有資料但雲端沒資料

本機 SQLite 不會自動變成 Firestore。需要執行 migration，或用管理員 bootstrap 從官方補最近 100 期。

## 13. 建議重建 Firebase + Vercel 的流程

1. 新建 Firebase project。
2. 啟用 Firestore。
3. 建立 service account key。
4. 在 Vercel 設定 ENV。
5. 先部署網站。
6. 本機設定同一組 Firebase ENV。
7. 跑：

```bash
npm run migrate:firestore -- --dry-run --recent=150
```

8. 確認筆數後跑：

```bash
npm run migrate:firestore -- --yes --recent=150
```

9. 到 Firebase Console 確認 collections。
10. 開 Vercel Dashboard 測：

```text
/api/data/status
/api/prediction/today
/api/stats/number-analysis?window=100&view=summary
```

11. 等 cron 自動同步，不要讓一般使用者手動同步。

## 14. 核心原則

- 不使用 fake/mock/demo/sample。
- 不使用 Math.random。
- 不 hardcode prediction 或 stats。
- 不用未來資料。
- 不因 migration 或 quota 問題補假資料。
- Firestore 只存營運所需資料，完整歷史留給本機 SQLite。
