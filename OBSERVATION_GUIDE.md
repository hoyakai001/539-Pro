# Observation Guide — observation_logs 與 rolling 指標

> Production Integration Final Phase 的 Observation 規格與使用方式。
> 這份文件取代 PREVIEW_OBSERVATION_GUIDE.md 的觀察部分（PREVIEW_OBSERVATION_GUIDE.md
> 仍保留作 Vercel Preview 設定的快速指南）。

## Observation 流程一覽

```
22:00 (UTC 14:00) Vercel cron
  → POST /api/cron/sync
    → cloudSyncNow({ type: 'cron-sync' })
      → fetchLatest() 抓官方最新一期
      → insertDraw() upsert 到 'draws' collection
      → evaluatePredictionForDraw(draw)   ← 觀察記錄寫入點
          → getPredictionByDrawNo() 取出當期 cached prediction
          → saveObservation() 上 'observation_logs' collection（upsert）
              key = `${target_draw_no}_${model_version}` → **不會重複寫**
              respect cloud-readonly guard → readonly 模式自動跳過
      → setCache('latest_draw', ...) 更新前端用 cache
      → writeCloudSyncLog() 寫 sync_logs
```

**沒有第二個 cron。**Observation 完全寄生在現有 22:00 cron sync 流程裡。

## 寫入語義

- **per draw 一次**：每個 `target_draw_no` 只會被 evaluate 一次（getPredictionByDrawNo 找到才寫；找不到回 false skip）
- **deterministic upsert key**：`{target_draw_no}_{model_version}` → 重跑 cron 也不會爆寫
- **cloud-readonly safe**：FirestoreAdapter.saveObservation 內 `assertWritable()` 會拋 CloudReadonlyError → readonly 模式不會寫
- **scan-safe**：Firestore 讀的是 `orderBy('target_draw_no', 'desc').limit(N)`，永不掃全集合；N 由 API caller 控制（最大 100）

## Observation 記錄欄位（Production Integration Final Phase 新增）

每筆 `observation_logs` 文件包含：

### 基本識別 / hit-rate（原有）
- `target_draw_no`, `target_date`, `prediction_id`, `model_version`
- `latest_used_draw_no`（新增）
- `selected_single`, `selected_two_star`, `selected_three_star`, `selected_four_star`, `selected_five_star`
- `actual_numbers`（開獎號碼）
- `single_hit`, `two_star_hit`, `three_star_hits`, `four_star_hits`, `five_star_hits`
- `advice_level`, `advice_label`, `confidence`
- `created_at`, `updated_at`, `evaluated_at`

### Ensemble diagnostic snapshot（新增）
- `schema`（`anti_hot_selection_schema`）
- `multi_strategy_enabled`, `multi_strategy_version`
- `ensemble_voting_enabled`, `ensemble_voting_version`
- `trend_only_count`, `trend_only_ratio`
- `dominance_penalty_applied`
- `pair_lock_penalty_applied`
- `triple_lock_penalty_applied`
- `exposure_penalty_applied`
- `core_group_penalty_applied`
- `hot_top10_penalty_applied`
- `consensus_protected_count`
- `core_group_count`（被選五星中 21/8/22/16/27 出現次數）

## 觀察 API

### `GET /api/observations/status?window=N`

回傳最近 N（1–100，default 30）筆 observation_logs 的 rolling 統計與 health flags。

```json
{
  "success": true,
  "data": {
    "window": 30,
    "sample_size": 30,
    "ready": true,
    "schema": "recent_weighted_scoring_single_rotation_structure_fatigue_v1+multi_strategy_v1+ensemble_voting_v1",
    "ensemble_versions": ["ensemble_voting_v1"],
    "rolling_metrics": {
      "unique_singles": 8,
      "unique_five_combos": 28,
      "unique_three_combos": 26,
      "coverage_01_39": 29,
      "hot_top10_ratio": 0.4733,
      "max_pair_count": 5,
      "pair_consecutive_repeat": 0,
      "single_consecutive_repeat": 0,
      "core_group_count": 9,
      "core_group_ratio": 0.06,
      "trend_only_ratio_avg": 0.01
    },
    "hit_rate": { "single": 0.1333, "two": 0.0, "three_full": 0.0 },
    "top10_numbers": [{ "n": 15, "c": 7 }, ...],
    "health_flags": {
      "hot_top10_high": false,
      "core_group_dominant": false,
      "pair_lock_failed": false,
      "single_rotation_failed": false,
      "excessive_uniformity": false
    }
  }
}
```

健康閾值：
- `hot_top10_high`：`hot_top10_ratio > 0.65` → hot dominance 警告
- `core_group_dominant`：`core_group_ratio > 0.25` → 核心群霸榜警告
- `pair_lock_failed`：`pair_consecutive_repeat > 0` → pair lock 沒生效
- `single_rotation_failed`：`single_consecutive_repeat > 0` → single 連續重複
- `excessive_uniformity`：sample ≥14 且 `coverage_01_39 ≥ 38` 且 `hot_top10_ratio < 0.30` → 可能 random 化

### `GET /api/observations/recent?window=N`

回傳最近 N（1–100，default 20）筆完整 observation 記錄。

**支援的常用 window**：10 / 20 / 30 / 40 / 50 / 60 / 70 / 80 / 90 / 100
（實際上接受 1–100 任意整數；超出範圍會被 clamp）。

讀取量保護：
- `getObservations(limit)` 內 `orderBy('target_draw_no', 'desc').limit(limit)` → 永不掃全集合
- API 層 clamp 到 [1, 100]
- 一次呼叫最多讀 100 個 doc（Firestore 計費上限以內）

```json
{
  "success": true,
  "data": {
    "window": 10,
    "count": 10,
    "observations": [
      {
        "id": "115000114_v6.1-three-star-stable",
        "target_draw_no": "115000114",
        "target_date": "2026/05/09",
        "selected_single": 15,
        "selected_five_star": [4, 7, 9, 14, 15],
        "actual_numbers": [11, 18, 21, 22, 25],
        "single_hit": false,
        "core_group_count": 0,
        "ensemble_voting_enabled": true,
        "ensemble_voting_version": "ensemble_voting_v1",
        "schema": "...+multi_strategy_v1+ensemble_voting_v1",
        ...
      },
      ...
    ]
  }
}
```

## 三層觀察工具

### 1. 後端內建 API（雲端原生）
```bash
curl -s "$BASE/api/observations/status?window=10" | jq .data.rolling_metrics
curl -s "$BASE/api/observations/status?window=30" | jq .data.health_flags
curl -s "$BASE/api/observations/recent?window=14" | jq '.data.observations[] | .selected_five_star'
```
**優點**：Firestore 原生資料，跨機器一致。**缺點**：需要先有 cron sync 跑完。

### 2. 本機 jsonl 日誌（每日 append）
```bash
API_URL=http://localhost:3001 LABEL=local   npm run observe:prediction
API_URL=https://539-pro-...    LABEL=preview npm run observe:prediction
npm run observe:stats
```
**優點**：保留每天 prediction 快照（含 penalty counters 等不會寫進 observation_logs 的細節）。
**缺點**：要每天人工 / cron 觸發 `observe:prediction`。

### 3. 一次性檢查（CLI）
```bash
# deterministic check
A=$(curl -s $BASE/api/prediction/today | jq -c '.data | {single, five_star}')
B=$(curl -s $BASE/api/prediction/today | jq -c '.data | {single, five_star}')
[ "$A" = "$B" ] && echo PASS || echo FAIL

# random.js sanity
grep -rn "Math\.random" backend/src/engine/ensembleVoting/   # 應為 0 hits
```

## 觀察期紅旗判讀

| 症狀 | 看哪個指標 | 行動 |
|---|---|---|
| 又固定 21/8/22/16/27 | `health_flags.core_group_dominant`（status） + `top10_numbers`（status） | 觀察 5+ 天若連續紅 → 調 Candidate C exposure 參數 |
| 變 01-04 low-bias | `top10_numbers` 開頭 + 看 ensemble strategy votes | bug；查 `rankByScores` / `buildVotes` |
| Random 化 | `health_flags.excessive_uniformity` + deterministic check | bug；不該發生 |
| Hit rate 崩 | `hit_rate.single` < 0.08 持續 ≥ 2 週 | 考慮 rollback `ENSEMBLE_VOTING_ENABLED=false` |
| pair 連續重複 | `health_flags.pair_lock_failed` | 看 `pair_lock_penalty_applied` 計數；若 = 0 表 lock 沒觸發 |

## Firestore 讀寫量保護

| 操作 | 寫入 | 讀取 | 限制 |
|---|---|---|---|
| 每日 cron sync | 1× draws + 1× observation_logs + 1× sync_logs + 1× stats_cache | ~120 (HISTORY_RECENT_LIMIT) | upsert by doc id，無爆寫 |
| `/api/observations/status` | 0 | min(window, 100) | cloud-readonly 也可用（純讀） |
| `/api/observations/recent` | 0 | min(window, 100) | 同上 |
| `/api/prediction/today` (cache hit) | 0（readonly 跳過 cache write） | 1-2 | cache 命中時 |
| `/api/prediction/today` (cache miss) | 1（readonly 跳過） | ~120 + cache 1 | schema 變化才會 miss |

**無任何路徑會掃全 Firestore**。

## Cloud-Readonly 保證

- `saveObservation` → `assertWritable()` → `CloudReadonlyError`（403）
- `insertDraw` / `setCache` / `savePrediction` 同樣有 guard
- `/api/sync-now` POST 路由本身有 `readonlyMutationGuard('sync-now')`
- `/api/observations/*` GET 路由純讀，無需 guard

## Production 觀察期建議

1. **本機 cloud-readonly**（3-5 天）：startup 確認、寫入 guard、讀路徑
2. **Vercel Preview**（10-14 天）：每天 `/api/observations/status?window=10` 看 health_flags
3. **Production 翻 ENV**（觀察期通過後）：保留 Preview ENV 1 週備援
4. **長期 monitoring**：每週看一次 `?window=30` rolling

詳細條件：見 [PREVIEW_OBSERVATION_GUIDE.md](PREVIEW_OBSERVATION_GUIDE.md) 第 11 條。
