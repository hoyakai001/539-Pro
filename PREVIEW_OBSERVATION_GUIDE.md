# Vercel Preview 觀察期指南（Variant C）

> Phase 2.5 候選版 **Variant C** 的觀察期操作手冊。
> Production 完全不動；只在 Preview 環境啟用，觀察 1-2 週後再決定是否上 production。

---

## 0. 前提

正式站（production）目前狀態（**不動**）：

```env
MULTI_STRATEGY_ENABLED=true
ENSEMBLE_VOTING_ENABLED=false       # ← production 保持 false
```

本指南所有操作都針對 **Preview** 環境，不會接觸 production ENV、不會觸發 production redeploy。

> Vercel ENV 作用域：在 Dashboard → Project → Settings → Environment Variables 設值時，
> 每筆都有 Environment 勾選欄（Production / Preview / Development）。**只勾 Preview**。

---

## 1. Preview ENV 設定

在 Vercel Dashboard → Settings → Environment Variables，新增以下 6 個，**Environment 只勾 `Preview`**：

| Key | Value |
|---|---|
| `ENSEMBLE_VOTING_ENABLED` | `true` |
| `ENSEMBLE_VOTING_VERSION` | `ensemble_voting_v1` |
| `ENSEMBLE_NUMBER_EXPOSURE_MAX_REPEAT` | `3` |
| `ENSEMBLE_NUMBER_EXPOSURE_PENALTY` | `0.75` |
| `ENSEMBLE_CORE_GROUP_MAX_EXPOSURE` | `3` |
| `ENSEMBLE_CORE_GROUP_PENALTY` | `0.78` |

`MULTI_STRATEGY_ENABLED=true` 已存在於 Preview（與 Production 共用 / 各自設）— 如未設則新增 `MULTI_STRATEGY_ENABLED=true` 於 Preview。

**其餘 `ENSEMBLE_*` 全部走預設**，不要再加 ENV。

---

## 2. 如何在 Vercel Preview 啟用 Variant C

兩種方法擇一：

### A. 開 Preview deployment（推薦）

1. 本機建一個臨時分支：`git checkout -b preview/ensemble-c-observation`
2. **不修改任何檔案**（候選 ENV 已在 .env.example 註解區；不要把 ENV 寫進倉庫）
3. push 分支到遠端：`git push origin preview/ensemble-c-observation`
4. Vercel 自動為這個 branch 產生 Preview deployment（URL 形如 `539-pro-git-preview-ensemble-c-observation-<team>.vercel.app`）
5. Preview build 自動讀 Preview-scope 的 ENV → Variant C 生效

> 如果你不想 push 任何 branch，可在 Vercel CLI 跑 `vercel --target=preview`，
> 或在 Vercel Dashboard 對任意非-main commit 點 "Promote to Preview"。

### B. 用既有 PR 的 Preview

任何開放的 PR 都有自己的 Preview URL；只要 Preview-scope ENV 設好，該 PR 的 Preview build 就會跑 Variant C。

---

## 3. Rollback 方法（兩種速度）

### 立即 rollback（不需 redeploy）

Vercel Preview deployments 都會讀**最新的** Preview-scope ENV。所以：

1. 去 Vercel Settings → Environment Variables
2. 把 `ENSEMBLE_VOTING_ENABLED` 改成 `false`（或刪掉這個 ENV）
3. 在 Vercel Deployments 頁面 Redeploy 最新的 Preview build（30-60 秒）

→ Preview 行為立刻退回 multi_strategy_v1 / baseline。**不影響 production**。

### 完全移除候選 ENV

把上述 6 個 Preview-scope ENV 全部刪除 → Preview 與 production 行為一致。

### Production 保險

Production ENV 全程沒被觸碰；Vercel 不會把 Preview 的 ENV 帶到 production。即使你忘了清 Preview ENV，production 也不會吃到。

---

## 4. 如何確認 Preview build 正常

Preview deployment 發佈後，記下 Preview URL（例：`https://539-pro-git-...vercel.app`），跑：

```bash
# 健康檢查
curl -s "$PREVIEW/api/health" | jq

# 預期關鍵欄位：
#   "cloud_readonly": false        ← Preview 預設不開 cloud-readonly（除非你另外設）
#                                    若你要 Preview 也 readonly，加 CLOUD_READONLY=true 至 Preview ENV
#   "mode": "node"
```

如果 health 不通：去 Vercel Deployments → 該 build → Function Logs 看錯誤訊息。

Build 本身的成功訊號（Vercel Dashboard 內 build log 尾端）：
```
✓ built in X.XXs
Build Completed in /vercel/output [...]
```

---

## 5. 如何確認 Preview API 正常

```bash
PREVIEW="https://539-pro-git-preview-ensemble-c-observation-<team>.vercel.app"

for p in data/status latest-draw previous-draw prediction/today; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$PREVIEW/api/$p")
  echo "$p -> $code"
done
```

預期：
- `/api/data/status` → 200
- `/api/latest-draw` → 200
- `/api/previous-draw` → 200
- `/api/prediction/today` → 200

確認 Variant C 真的有跑（prediction 內部）：

```bash
curl -s "$PREVIEW/api/prediction/today" | jq '.data.strategy_scores | {
  ensemble_voting_enabled,
  ensemble_voting_version,
  anti_hot_selection_schema,
  trend_only_count,
  trend_only_ratio,
  dominance_penalty_applied,
  pair_lock_penalty_applied,
  triple_lock_penalty_applied,
  exposure_penalty_applied,
  core_group_penalty_applied,
  hot_top10_penalty_applied,
  consensus_protected_count,
  cross_strategy_consensus_avg: null
}'
```

關鍵驗證點：
- `ensemble_voting_enabled: true`
- `ensemble_voting_version: "ensemble_voting_v1"`
- `anti_hot_selection_schema` 結尾應為 `...+multi_strategy_v1+ensemble_voting_v1`
- 其他 `*_applied` 計數至少有部分 > 0（表示 penalty 真的有觸發）

---

## 6. 如何確認 Firestore / cloud-readonly guard 正常

Preview 預設**不開** cloud-readonly（會正常讀寫 Firestore — 你的 Preview 與 production 共用 Firestore 嗎？若是，請小心）。兩種策略：

### 策略 1：Preview 開 cloud-readonly（最安全，推薦觀察期使用）

新增一筆 Preview-scope ENV：
```
CLOUD_READONLY=true
```

驗證：
```bash
curl -s "$PREVIEW/api/health" | jq '.cloud_readonly'   # 應為 true

# sync-now 應被擋
curl -X POST -s -o /dev/null -w "%{http_code}\n" "$PREVIEW/api/sync-now"
# 預期 403，response body 含 "CLOUD_READONLY_BLOCKED"
```

優點：Preview 永遠不會寫 production Firestore；觀察期 0 風險。
缺點：Preview cron 不會自動 sync 開獎資料 — 但讀仍用 production Firestore 的最新資料，prediction 還是用「最新一期」算的。

### 策略 2：Preview 用獨立 Firebase project（更乾淨但需設定）

如果你有第二組 Firebase credentials，可在 Preview-scope 覆蓋 `FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY`，讓 Preview 用獨立資料庫。觀察期不建議走這條，因為 prediction 需要連續歷史，建獨立 DB 還要先 sync。

**建議：用策略 1（CLOUD_READONLY=true）**。

---

## 7. 如何觀察 recent_10 / recent_20 / recent_30 真實 prediction

Variant C 的價值在「短中期分散」，所以觀察必須是滾動的，不是一次性。

### 每日記錄（最簡單）

每天 cron 跑完後（台灣時間 22:00 後）打一次：

```bash
# 抓 Preview 當天 prediction
curl -s "$PREVIEW/api/prediction/today" \
  | jq '{
      date: .data.target_date,
      single: .data.single,
      five_star: .data.five_star,
      three_star: .data.three_star,
      schema: .data.strategy_scores.anti_hot_selection_schema,
      penalties_fired: {
        exposure: .data.strategy_scores.exposure_penalty_applied,
        core_group: .data.strategy_scores.core_group_penalty_applied,
        hot_top10: .data.strategy_scores.hot_top10_penalty_applied,
        pair_lock: .data.strategy_scores.pair_lock_penalty_applied,
        triple_lock: .data.strategy_scores.triple_lock_penalty_applied,
        consensus_protected: .data.strategy_scores.consensus_protected_count
      }
    }' >> preview-observations.jsonl
```

累積 14 天後（或自動每日 append），用本機腳本算 rolling：

```bash
# rolling recent_10
tail -10 preview-observations.jsonl | jq -s '
{
  predictions: length,
  unique_singles: ([.[].single] | unique | length),
  unique_fives:   ([.[].five_star | sort | tostring] | unique | length),
  number_freq:    ([.[].five_star[]] | group_by(.) | map({n: .[0], c: length}) | sort_by(-.c))
}'
```

關鍵指標：
- `unique_singles` 在 10 期內 ≥ 7（多樣性夠）
- `unique_fives` 在 10 期內 = 10（沒有重複五星組合）
- `number_freq[0:5]` 看最常出現的 5 個號碼 — 如果某個號 10 期出現 ≥ 6 次，exposure penalty 沒生效

對比 production（multi_strategy_v1）每日 prediction，用同樣 jq 算一份。

### 並行對照（更嚴謹）

每天同時抓 Preview（Variant C）與 Production（multi_strategy_v1）的 today prediction，存到兩份 jsonl，14 天後同時統計，看 Variant C 是否真的把 core_group 拉得比 multi_strategy_v1 低。

---

## 8. 如何確認沒有 random 化

三層驗證：

### 程式碼層
```bash
grep -rn "Math\.random\|Math\\.random" backend/src/engine/ensembleVoting/
# 預期：0 results
```

### 行為層（deterministic 重現）
同一份 Preview 對同一個 `target_date` 連續打兩次 `/api/prediction/today`，**single / five_star / strategy_scores 內所有 *_applied 計數** 必須完全相同（cache 命中）。

```bash
A=$(curl -s "$PREVIEW/api/prediction/today" | jq -S '.data | {single, five_star, ts: .strategy_scores.ensemble_voting_version}')
B=$(curl -s "$PREVIEW/api/prediction/today" | jq -S '.data | {single, five_star, ts: .strategy_scores.ensemble_voting_version}')
diff <(echo "$A") <(echo "$B") && echo "deterministic: PASS"
```

### 觀察期層
14 天紀錄裡，若 single 出現「明顯非熱號」（例如 32、35、37）出現次數 ≥ 4 次，那不是 random — random 化的話這些冷號出現次數會貼近平均（5/39 ≈ 1.3 次 in 10 期）。Variant C 應顯示「**有些號明顯多、有些明顯少，但比 baseline 更分散**」。

---

## 9. 如何確認沒有固定核心群輪替

連續 14 天的 Preview prediction，**對每個 01-39 計次**：

```bash
cat preview-observations.jsonl | jq -r '.five_star[]' | sort | uniq -c | sort -rn | head -10
```

健康樣態：
- top1 號出現次數 ≤ 7（14 期裡半數以下）
- top5 號合計出現次數 ≤ 35（14×5×0.5 = 35 是「核心群佔一半」門檻）
- 21 / 8 / 22 / 16 / 27 五個 baseline 偏好號中至少有 2 個不在前 5

不健康樣態（要 rollback）：
- top1 號 ≥ 10 次
- 21+8+22+16+27 合計 ≥ 35 次
- 任何 single number 連續 5 天以上重複（exposure 應已壓制）

---

## 10. 建議 production 觀察期長度

| 階段 | 長度 | 動作 |
|---|---|---|
| **本機 cloud-readonly** | 3-5 天 | 確認 build / API / cache schema / penalty counters 都正常 |
| **Vercel Preview** | **10-14 天**（最短 10 天） | 累積 ≥ 10 期真實 prediction；rolling recent_10 達標再評估 |
| **production 試運行**（可選） | 7 天 | 翻 production ENV，但開 monitoring 緊盯命中率與用戶反映 |
| **production 正式** | 持續 | 上述全綠才算正式 |

最少 **10 個交易日**（避開週末 + 開獎日），最理想 **14 個交易日**。少於 10 天 hit_rate 無法判斷退化與否。

---

## 11. 何時才建議正式翻 production ENV

**全部下列條件達標才翻 production**：

1. ✅ Preview build / API / Firestore guard 觀察期內無事故
2. ✅ rolling recent_10：unique_singles ≥ 7、unique_fives = 10、pair/triple/single 連續重複 = 0
3. ✅ rolling recent_30：hot_top10_ratio < production multi_strategy_v1 同期值
4. ✅ rolling recent_30：core_group_count（21/8/22/16/27 累計）≤ production multi_strategy_v1 同期值
5. ✅ rolling recent_30：hit_rate.single ≥ production 同期 × 0.85（容許 15% 抖動）
6. ✅ 用戶（你自己）主觀體感：「不再覺得每天都是那幾組」

任一條不達標 → 繼續觀察或調整候選 ENV，**不要翻 production**。

翻 production 的實際操作：
1. 把 6 個 Preview-scope ENV 複製到 Production-scope（Vercel UI 直接勾 Production）
2. Vercel Deployments → 最新 production build → Redeploy
3. 30 秒後 production cron 下次跑就會用新 ENV
4. **保留 Preview-scope ENV** 1 週，遇問題可立刻退（把 production ENV 移除 / 設 false → redeploy）

---

## 變動清單

- **新增** [PREVIEW_OBSERVATION_GUIDE.md](539-Pro-main/PREVIEW_OBSERVATION_GUIDE.md)（本檔）

本輪沒改任何 .ts / .env / package.json / vercel.json / Firestore guard / cron 設定 /
DB schema / API / frontend。沒 push GitHub、沒翻 Vercel ENV、沒動 production。
