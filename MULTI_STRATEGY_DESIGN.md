# MULTI_STRATEGY_DESIGN.md

> 539-system multi_strategy_v1：5 策略 ensemble 設計
> 加入日期：2026-05-10
> 配套：[MULTI_STRATEGY_COMPARE.md](MULTI_STRATEGY_COMPARE.md)、[ENV_SPLIT_GUIDE.md](ENV_SPLIT_GUIDE.md)

---

## 1. 動機

baseline 是**單一歷史統計排序模型**，本質會持續偏向：

- 高頻號
- 近期熱號
- 強共現 pair / triple
- 固定核心群輪替

→ 推薦永遠在少數幾組號碼裡輪替，01-39 沒有自然輪替。

multi_strategy_v1 在 baseline **之上**加一層 ensemble，強制引入分散邏輯。**baseline 完全保留**，由 ENV `MULTI_STRATEGY_ENABLED` 開關，可隨時 rollback。

---

## 2. 五個策略

每個策略都吃 baseline `number_scores[*].normalized_score` (1-39) 做為輸入，輸出 1-39 的 score map。**永不刪號、永不黑名單、無 random、無 hardcode 禁號。**

### 2.1 Trend Strategy（35%）— `engine/multiStrategy/strategies.ts:trendStrategy`

直接沿用 baseline normalized_score；保留現行高分熱號與 pair/triple 統計價值。**baseline 即 trend strategy**。

### 2.2 Balance Strategy（20%）— `balanceStrategy`

依近 60 期實際出現頻率分組：

- 偏熱（>1.30 × 期望值）→ 乘性 soft 衰減（最多 0.30）
- mid 號 → ×1.05 加成
- 冷號 → ×1.02 加成

效果：避免推薦全部集中在 Top 10 熱號。

### 2.3 Anti-Concentration Strategy（20%）— `antiConcentrationStrategy`

對最近 N 期（預設 5）prediction 推薦的號碼乘上 `0.92^N`（最低 0.65）。同時 diagnostic 記錄 pair / triple 重複次數。**只 soft penalty，不刪號。**

效果：降低固定核心群連續霸榜。

### 2.4 Reversion Strategy（15%）— `reversionStrategy`

對符合下列**全部**條件的號加成 ×1.08：

1. 近 30 期實際出現次數 ≤ 期望值的 60%
2. 近 N 期推薦池中**從未出現**
3. baseline normalized_score ≥ Top1 × `MIN_SUPPORT_FACTOR`（預設 0.40）

第 3 條保證不會把完全沒支撐的號硬上。

### 2.5 Coverage Strategy（10%）— `coverageStrategy`

對最近 N 期推薦五星 pool **完全沒出現**且 baseline > 0 的號加成 ×1.06。

效果：增加 distinct combos 與 01-39 coverage。

---

## 3. 投票與合併

### 3.1 Aggregator (`aggregator.ts:aggregate`)

每個策略 score map 個別 **min-max normalize 到 0-100**，乘上權重後相加：

```
final[n] = w_trend * norm_trend[n]
        + w_balance * norm_balance[n]
        + w_anti * norm_anti[n]
        + w_reversion * norm_rev[n]
        + w_coverage * norm_cov[n]
```

### 3.2 Tie-break（deterministic）

同分時，**號碼小者排前**。沒有任何隨機。

### 3.3 權重 normalize

ENV 給的權重會自動 `weight / sum(weights)`，使總和 = 1.0。即使你寫 `TREND=70 BALANCE=10` 也會 normalize 成 0.875 / 0.125。若全部設 0（degenerate），fallback 為 trend=1.0（純 baseline）。

### 3.4 Hot/Mid/Cold 分組與比例約束

從近 60 期頻率分為：

- Hot = Top 10
- Mid = 11-26 名
- Cold = 27-39 名

從 ensemble final score 排序取 Top 5 後，若 hot 號數量 > `floor(5 × MAX_HOT_RATIO)`（預設 0.60 → 上限 3），由排名最低的 hot 號逐一替換成 ranked list 中下一個非 hot 號。**所有替換都是 deterministic（按 final score + 號碼小者 tie-break）**。

---

## 4. ENV 旋鈕

完整列表：[ENV_SPLIT_GUIDE.md §5](ENV_SPLIT_GUIDE.md)。摘要：

| ENV | 預設 | 影響 |
|---|---|---|
| `MULTI_STRATEGY_ENABLED` | 未設 → false | 主開關 |
| `MULTI_STRATEGY_VERSION` | `multi_strategy_v1` | schema 後綴 |
| `STRATEGY_WEIGHT_TREND` | 0.35 | 越高越像 baseline |
| `STRATEGY_WEIGHT_BALANCE` | 0.20 | 越高越避免 Top10 集中 |
| `STRATEGY_WEIGHT_ANTI_CONCENTRATION` | 0.20 | 越高越避免推薦重複 |
| `STRATEGY_WEIGHT_REVERSION` | 0.15 | 越高越給冷門號機會 |
| `STRATEGY_WEIGHT_COVERAGE` | 0.10 | 越高越打散組合 |
| `MULTI_STRATEGY_MIN_SUPPORT_FACTOR` | 0.40 | reversion 最低分數門檻 |
| `MULTI_STRATEGY_MAX_HOT_RATIO` | 0.60 | five_star 中 hot 比例上限 |
| `MULTI_STRATEGY_MIN_MID_COLD_RATIO` | 0.40 | mid+cold 比例下限（透過 max_hot 反向達成） |
| `MULTI_STRATEGY_RECENT_RECOMMEND_WINDOW` | 5 | anti-concentration / coverage 視窗 |
| `MULTI_STRATEGY_PAIR_REPEAT_PENALTY` | 0.88 | pair 重複懲罰因子（diagnostic） |
| `MULTI_STRATEGY_TRIPLE_REPEAT_PENALTY` | 0.82 | triple 重複懲罰因子（diagnostic） |
| `MULTI_STRATEGY_REVERSION_BONUS` | 1.08 | reversion 加成倍率 |
| `MULTI_STRATEGY_COVERAGE_BONUS` | 1.06 | coverage 加成倍率 |

---

## 5. API 結構（向後相容）

multi_strategy_v1 **不破壞任何既有欄位**。`StatisticalPrediction` 仍然回傳：

- `single` / `single_number`
- `two_star` / `three_star` / `four_star` / `five_star`
- `numbers`
- `number_scores` / `number_scores_json`（39 列，selected_in_* flags 由 ensemble 重新計算）
- `strategy_scores`（保留全部既有欄位 + 新增 multi-strategy diagnostic）
- `combo_support_summary`
- `bet_advice` / `confidence_label` / `recommendation`
- `model_version` = `'v6.1-three-star-stable'`（不變，避免 cache key 改動造成混亂）
- `strategy` = `'<baseline-strategy>|multi_strategy_v1'`
- `anti_hot_selection_schema` = `'<baseline_schema>+multi_strategy_v1'`（cache schema 後綴）

新增於 `strategy_scores`：

```json
{
  "multi_strategy_enabled": true,
  "multi_strategy_version": "multi_strategy_v1",
  "strategy_weights": "{\"trend\":0.35,...}",
  "strategy_contributions": "{\"trend\":...}",
  "strategy_votes": "{\"trend\":{...diagnostic},...}",
  "trend_score": 90.92,
  "balance_score": 92.13,
  "anti_concentration_score": 83.79,
  "reversion_score": 92.28,
  "coverage_score": 94.09,
  "concentration_penalty": ...,
  "reversion_bonus": 1.08,
  "coverage_bonus": 1.06,
  "final_ensemble_score": ...,
  "coverage_improvement": 2,
  "repeat_reduction": 11,
  "hot_count_in_five_star": 3,
  "mid_cold_count_in_five_star": 2,
  "ensemble_swap_count": 0,
  "baseline_hot_count": ...,
  "swapped_in": ...
}
```

當 disabled，這些欄位都不會出現（`multi_strategy_enabled=false`），prediction 與升級前完全一致。

---

## 6. Cache schema bump 與 rollback

`PREDICTION_CACHE_SCHEMA` 動態計算：

```
enabled  → recent_weighted_scoring_single_rotation_structure_fatigue_v1+multi_strategy_v1
disabled → recent_weighted_scoring_single_rotation_structure_fatigue_v1
```

- 第一次啟用 → 舊 baseline cache 全部失效，新 cache 用新 schema 寫入。
- ENV 關閉 → schema 自動回退；若 baseline cache 還在，立刻可用；若沒有，下次 prediction 重算。
- **completely deterministic、無歷史資料污染**。

⚠️ 雲端 cloud-readonly dev 不會寫入新 cache（被 readonly guard 擋下）。Production 部署後第一次 cron-sync 才會生新 cache。

---

## 7. Rollback

最簡單：把 `backend/.env` 的 `MULTI_STRATEGY_ENABLED=true` 移除或設為 `false`，重啟 backend。

```env
# MULTI_STRATEGY_ENABLED=true   # ← comment out or set false
```

```powershell
# 本機
Get-Process node | Stop-Process -Force
npm run dev
```

Vercel 上同理：到 Vercel Dashboard → Settings → Environment Variables 把 `MULTI_STRATEGY_ENABLED` 刪掉或設 `false` → Redeploy。Schema 會自動回到 baseline，舊 baseline cache 立刻可用（如果 latest_draw 還沒變）。

**Baseline code 沒被刪、沒被改**。multi_strategy 是純 additive layer。
