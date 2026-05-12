# Dynamic Window v1 — Design

> 在現有 ensemble_voting_v1 之上的 soft 後處理層；**不換策略、不取代任何 strategy、不引入 hard switch**。
> 預設關閉（`DYNAMIC_WINDOW_ENABLED=false`）。

## 為什麼不是 random
- 沒有任何 `Math.random` / `crypto.random` / seed-based pseudo-random
- 訊號 100% 從**真實歷史開獎**（不是 prediction recommendation）多視窗加權頻率推導
- 相同 inputs（draws）→ 相同 outputs（factor）；連續兩次 `/api/prediction/today` 結果必須完全一致

## 為什麼不是 hard rule
- **沒有「window 70 比 80 好」這種硬切**
- 不指定「某天用 30、某天用 60」這種規則切換
- 不會封鎖任何號碼、不會強制保留任何號碼
- 整個機制只是一個**乘性微調倍率**，範圍嚴格 clamp 在 `[1 - W, 1 + W]`（預設 W = 0.05 → [0.95, 1.05]）
- W 由 ENV 控制，**W=0 等於完全 no-op**

## 機制

對每個 01-39 號碼 n：

```
raw[n] = Σ_window (window_weight * (count_in_window[n] - mean_of_window))
```

其中：
- `window_weight` 從 ENV 取（預設：30 → 0.35、60 → 0.30、70 → 0.20、80 → 0.15）
  - 這 4 個 window 是 adaptive backtest 顯示 hit_rate 訊號最強的
  - 權重已 normalize 接近 1.0；ENV 可調但需用戶手動跑回測驗證
- `count_in_window[n]` = 該號碼在最近 `window` 期真實開獎中出現次數
- `mean_of_window` = 該 window 中所有 39 個號碼的平均次數

然後正規化到 `[-1, +1]`：

```
normalized[n] = (raw[n] - median(raw)) / max_abs_deviation
```

最終 factor：

```
factor[n] = clamp(1 + W × normalized[n], 1 - W, 1 + W)
final_vote_score[n] *= factor[n]
```

## Dormant Guard（資料不足時 no-op）

- 若 `draws.length < DYNAMIC_WINDOW_MIN_OBSERVATIONS`（預設 30）→ factor 全 1.0，不套用
- 若所有 raw[n] 都相同（無訊號）→ factor 全 1.0
- `dynamic_window_dormant_reason` 會在 strategy_scores 內標示原因

## Pipeline 位置

```
DrawEntry → baseline (v6.1-three-star-stable)
          → multi_strategy_v1 [ENABLED]
          → ensemble_voting_v1 [ENABLED Candidate-C]
              ├─ 5 strategies (trend/balance/anti_concentration/reversion/coverage)
              ├─ meta voting (weighted vote sum)
              ├─ penalties (dominance / pair_lock / triple_lock / exposure / core_group)
              ├─ consensus protection
              ├─ structure_adjust [預設 OFF，已驗證 hit_rate 無提升]
              ├─ dynamic_window_adjust [預設 OFF，本檔對象] ← 新增
              ├─ anti-dominance hot_top10 post-processing
              └─ final ranking
```

## ENV

| ENV | 預設 | 說明 |
|---|---|---|
| `DYNAMIC_WINDOW_ENABLED` | `false` | 總開關。`false` → 完全 no-op |
| `DYNAMIC_WINDOW_VERSION` | `dynamic_window_v1` | cache schema 後綴 |
| `DYNAMIC_WINDOW_WEIGHT` | `0` | 倍率上限 W。建議 0.05（±5%）；最大 0.5（±50%）|
| `DYNAMIC_WINDOW_MIN_OBSERVATIONS` | `30` | draws < 此值 → dormant |
| `DYNAMIC_WINDOW_MIN_WINDOW` | `10` | 視窗下限（diagnostic only）|
| `DYNAMIC_WINDOW_MAX_WINDOW` | `100` | 視窗上限（diagnostic only）|
| `DYNAMIC_WINDOW_W1` / `W1_WEIGHT` | `30` / `0.35` | 第 1 個視窗 + 權重 |
| `DYNAMIC_WINDOW_W2` / `W2_WEIGHT` | `60` / `0.30` | 第 2 個視窗 |
| `DYNAMIC_WINDOW_W3` / `W3_WEIGHT` | `70` / `0.20` | 第 3 個視窗 |
| `DYNAMIC_WINDOW_W4` / `W4_WEIGHT` | `80` / `0.15` | 第 4 個視窗 |

## Cache Schema

啟用 DW 後，`PREDICTION_CACHE_SCHEMA` 自動加後綴：

```
recent_weighted_scoring_single_rotation_structure_fatigue_v1
  + multi_strategy_v1
  + ensemble_voting_v1
  + dynamic_window_v1     ← 新加
```

ENV 變化 → schema 變化 → 舊 cache 自動失效。**Rollback 不需手動清 cache**。

## 怎麼驗證

1. **單元級**：`grep "Math.random" backend/src/engine/ensembleVoting/dynamicWindow.ts` → 0 hits
2. **Deterministic 重現**：對同一個 target_date 連續打兩次 `/api/prediction/today`，single / five_star / dynamic_window_factor 必須完全相同
3. **多視窗回測**：`node scripts/compare-adaptive-window.js 200` 跑 A（無 DW）vs B（有 DW），看 10/20/30/40/50/60/70/80/90/100 各 window mean ± stderr
4. **健康指標**：`/api/observations/status?window=30` 看 `core_group_ratio`、`hot_top10_ratio`、`pair_consecutive_repeat`
5. **diagnostic 可讀**：prediction.strategy_scores 內 `dynamic_window_enabled / weight / applied / mean_factor / dormant_reason / weights` 全部都會輸出

## 怎麼 Rollback

| 目標 | ENV |
|---|---|
| 完全關閉 DW（回到 Phase 2 ensemble Cand-C） | `DYNAMIC_WINDOW_ENABLED=false` |
| 暫時關閉但保留 schema | `DYNAMIC_WINDOW_WEIGHT=0`（factor 變 1.0） |
| 同時關 ensemble | `ENSEMBLE_VOTING_ENABLED=false`（DW 也自動失效，因為 DW 是 ensemble 內部步驟）|

任一動作只需在 Vercel UI 改 ENV → Redeploy production build。**不會影響資料**。

## Production 是否建議開

**這次回測完成前不建議**。請看 [DYNAMIC_WINDOW_DESIGN.md](DYNAMIC_WINDOW_DESIGN.md) 同層的 `compare-adaptive-window.dw_v1.json` 與 `compare-adaptive-window.baseline.json` 的 hit_rate 對照表決定。

只有當以下全部滿足才考慮上 production：
- DW 在 ≥7 個 window 上的 `hit_rate_single` mean 不低於 baseline mean − 1 stderr
- 在 ≥7 個 window 上的 `pair_repeat_consecutive` 與 baseline 持平或更佳
- `core_group_ratio` 與 baseline 持平
- 真實 production 上連續 ≥14 天 rolling recent_30 hit_rate.single ≥ 0.10

## 嚴格禁止（已驗證）

- ❌ `Math.random` — grep `backend/src/` 0 hits
- ❌ 隨機數 / seed / pseudo-random — 沒用
- ❌ blacklist / whitelist / hardcoded 號碼 — 沒有
- ❌ 禁止任何 01-39 號碼 — 全部保留機會
- ❌ hard switch（如「某天用 30」）— 沒有；所有 window 同時加權
- ❌ fake / mock / sample data — 訊號從真實 `draws` collection 取
