# Ensemble Voting v1 — Design

> 統計 prediction 的 meta-voting layer。Phase 2 引入；Phase 2.5 加上核心群控制。
> 不是 random、不是 baseline-modifier、不是 blacklist；deterministic 投票機制。
>
> 與 multi_strategy_v1 的差異：multi_strategy_v1 是「加權 score 修正 baseline」（baseline++）；
> ensemble_voting_v1 是「5 個獨立 ranking 各自 topK 投票，最終 meta voting 合併」。

## Pipeline

```
DrawEntry
  ↓ buildScoredPredictionModel()           ← baseline (v6.1-three-star-stable)
  ↓ applyMultiStrategy()                   ← multi_strategy_v1 (Phase 1)
  ↓ applyEnsembleVoting()                  ← ensemble_voting_v1 (Phase 2 / 2.5)
  ↓ prediction (single / two / three / four / five star + diagnostic)
```

每層 ENV-gated；任一層 disabled → 直接透傳上一層的結果。

## 5 個獨立 ranking strategies

每個 strategy 對 01-39 產生 ranking + topK + per-number vote。
**沒有共用 baseline score**（除 trend strategy 語意上就是 trend）；
其他 4 個 strategy 用各自的特徵維度。

| Strategy | 訊號 | 高分 = | 來源 |
|---|---|---|---|
| **trend** | baseline normalized_score | hot 號 | `buildScoredPredictionModel` 輸出 |
| **balance** | 與歷史期望出現次數的距離 | 接近期望 | 最近 60 期 draws |
| **anti_concentration** | 在最近 N 期 prediction 五星出現次數 | 沒被推薦過 | recent prediction context |
| **reversion** | 100 期 z-score（負向） | 偏冷 | 最近 100 期 draws |
| **coverage** | 在最近 N 期五星 pool 的距離 | 對 pool 陌生 | recent prediction context |

### Vote 分配（Phase 2.5 修正 — low-number bias bug fix）

每個 strategy 的 raw scores 經 `rankByScores(scores, baseline)` 排序，topK 內位置的權重總和（線性遞減 1.0 → 1/K）**平均分配給 tied score 組內所有成員**。

關鍵設計：
- **deterministic tie-break**：score → secondary baseline score → number ASC。
- **tied 分數等分 vote**：避免「strategy raw score 大量相同（如 AC 中 ~25 個沒被推薦過的號全部 = 0）時，tie-break 落到 number ASC → 低號自動拿 1.0 / 0.9 / 0.8 → meta voting 永遠把 01 / 02 / 03 推到前面」的漏洞。

## Meta Voting Layer

對每個 01-39 計算：

```
base_vote_score = Σ strategyWeights[s] × vote[s][n]      ← 5 strategy weighted sum
trend_only = (support_strategy_count === 1 && trend_vote > 0)
```

然後套 6 個 deterministic 倍率 penalty：

| Penalty | 觸發條件 | 倍率 ENV | 預設 | Candidate C |
|---|---|---|---|---|
| `dominance_penalty` | `trend_only && support < MIN_SUPPORT` | `ENSEMBLE_TREND_ONLY_PENALTY` | 0.72 | 0.72 |
| `pair_lock_penalty` | 該號參與的 pair 在 window 內出現 > `PAIR_LOCK_MAX_REPEAT` | `ENSEMBLE_PAIR_LOCK_PENALTY` | 0.82 | 0.82 |
| `triple_lock_penalty` | 該號參與的 triple 在 window 內出現 > `TRIPLE_LOCK_MAX_REPEAT` | `ENSEMBLE_TRIPLE_LOCK_PENALTY` | 0.78 | 0.78 |
| `exposure_penalty` | 該號在最近 N 期 five_star 出現 ≥ `NUMBER_EXPOSURE_MAX_REPEAT` | `ENSEMBLE_NUMBER_EXPOSURE_PENALTY` | 0.80 | **0.75** |
| `core_group_penalty` | 該號在最近 N 期 three_star 出現 ≥ `CORE_GROUP_MAX_EXPOSURE` | `ENSEMBLE_CORE_GROUP_PENALTY` | 0.82 | **0.78** |
| `hot_top10_penalty` | post-processing: top10 中 trend topK 號比例 > `HOT_TOP10_MAX_RATIO` | `ENSEMBLE_HOT_TOP10_PENALTY` | 0.84 | 0.84 |

倍率乘性累加：`final_vote_score = base × dom × pair × triple × exposure × core × hot_top10`

### Consensus Protection（避免誤殺強號）

`exposure / core_group / pair_lock / triple_lock / hot_top10` 5 種 penalty 都受保護：

```
if support_strategy_count >= CONSENSUS_PROTECTION_MIN_SUPPORT:    # 預設 3
    penalty = 1 + (penalty - 1) × CONSENSUS_PROTECTION_FACTOR     # 預設 0.5 → 嚴重度減半
```

- 3+ strategy 共識的號 → penalty 距 1.0 的距離減半（保留方向，減弱嚴重度）
- 僅 trend 一家撐起的號 → 完整 penalty
- 完全沒 strategy 支持的號 → base_vote_score = 0，penalty 無作用

`dominance_penalty` 不受 consensus protection（trend-only 是 dominance 的反面定義）。

### Anti-Dominance 後處理

```
if final_top10 中 trend_only 號比例 > MAX_TREND_ONLY_TOP10_RATIO (0.35):
    對所有 trend_only 號再乘一次 trendOnlyPenalty
    重排
```

ranking tie-break：`final_vote_score DESC → number ASC`。

## Cache Schema

```
baseline only            → recent_weighted_scoring_single_rotation_structure_fatigue_v1
+ multi_strategy_v1      → ...+multi_strategy_v1
+ ensemble_voting_v1     → ...+multi_strategy_v1+ensemble_voting_v1
```

ENV 變化 → schema 變化 → 舊 cache 自動失效。**rollback 不需手動清 cache**。

## Diagnostic 欄位（寫入 prediction.strategy_scores 與 observation_logs）

每筆 prediction：
- `ensemble_voting_enabled`, `ensemble_voting_version`
- `trend_only_count`, `trend_only_ratio`
- `dominance_penalty_applied`, `pair_lock_penalty_applied`, `triple_lock_penalty_applied`
- `exposure_penalty_applied`, `core_group_penalty_applied`, `hot_top10_penalty_applied`
- `consensus_protected_count`
- `meta_votes`, `strategy_vote_table`, `ensemble_strategy_confidence` (JSON strings)

每個 01-39 number_scores 內：
- `trend_vote`, `balance_vote`, `anti_concentration_vote`, `reversion_vote`, `coverage_vote`
- `support_strategies`, `cross_strategy_consensus`
- `dominance_penalty`, `pair_lock_penalty`, `triple_lock_penalty`
- `recent_number_exposure`, `core_group_exposure`
- `exposure_penalty`, `core_group_penalty`, `hot_top10_penalty`, `consensus_protected`
- `final_vote_score`, `final_vote_rank`

## 嚴格禁止（已驗證 0 違規）

- ❌ `Math.random` — 程式碼 grep 0 hits
- ❌ random shuffle / draw-no hash 擾動
- ❌ hardcoded blacklist
- ❌ hardcoded number ban
- ❌ baseline-bypass（trend 仍走 baseline，其他 4 個獨立特徵）
- ❌ 假資料 / mock / sample

## Variant C（Phase 2.5 候選）

只調 4 個 ENV：
```
ENSEMBLE_NUMBER_EXPOSURE_MAX_REPEAT=3   # 預設 4 → 3
ENSEMBLE_NUMBER_EXPOSURE_PENALTY=0.75   # 預設 0.80 → 0.75
ENSEMBLE_CORE_GROUP_MAX_EXPOSURE=3      # 預設 4 → 3
ENSEMBLE_CORE_GROUP_PENALTY=0.78        # 預設 0.82 → 0.78
```

詳細數據：[ENSEMBLE_VOTING_COMPARE.md](ENSEMBLE_VOTING_COMPARE.md)。

## 程式碼定位

```
backend/src/engine/ensembleVoting/
├── types.ts          — EnsembleStrategyVote / NumberMetaVote / EnsembleVotingResult
├── config.ts         — ENV 讀取（getEnsembleVotingConfig / isEnsembleVotingEnabled）
├── strategies.ts     — 5 個 ranking + buildVotes (tied-equal-share)
├── metaVoting.ts     — base_vote + 6 penalties + consensus protection + anti-dominance
└── index.ts          — applyEnsembleVoting() public entry
```

Pipeline 接線：[backend/src/engine/statisticalPrediction.ts](backend/src/engine/statisticalPrediction.ts) 的 `buildStatisticalPrediction` 內，applyMultiStrategy 之後呼叫 applyEnsembleVoting。

## Rollback

| 目標 | ENV |
|---|---|
| Baseline | `MULTI_STRATEGY_ENABLED=false`<br>`ENSEMBLE_VOTING_ENABLED=false` |
| Multi-strategy v1 (current prod) | `MULTI_STRATEGY_ENABLED=true`<br>`ENSEMBLE_VOTING_ENABLED=false` |
| Ensemble v1 (default) | `MULTI_STRATEGY_ENABLED=true`<br>`ENSEMBLE_VOTING_ENABLED=true` |
| Variant C | 上 + 4 個微調 ENV |
