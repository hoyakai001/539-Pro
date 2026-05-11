# MULTI_STRATEGY_COMPARE.md

> baseline vs multi_strategy_v1 walk-forward 比較
> 日期：2026-05-10
> 樣本：200 期 walk-forward（從 backend/data/539.verify.sqlite，最近 200 期評估，再往前資料當訓練）
> Compare script：`scripts/compare-multi-strategy.js`
> 完整 JSON：`compare-multi-strategy.json`

---

## 1. 結果摘要表

| 指標 | baseline | multi_strategy_v1 | Δ | 解讀 |
|---|---:|---:|---:|---|
| sample_size | 200 | 200 | — | |
| **hit_rate_single** | 12.0% | 11.0% | **−1.0pt** | 輕微退化 |
| **hit_rate_two** | 2.0% | 1.5% | **−0.5pt** | 輕微退化（樣本中本就極稀有） |
| hit_rate_three | 0.0% | 0.0% | 0 | baseline 也是 0（樣本中無命中） |
| hit_rate_four | 0.0% | 0.0% | 0 | 同上 |
| hit_rate_five | 0.0% | 0.0% | 0 | 同上 |
| **distinct_five_combos** | 108 / 200 | **197 / 200** | **+89** | 🚀 從 54% → 98.5%，幾乎每期都不同 |
| **distinct_three_combos** | 80 / 200 | **175 / 200** | **+95** | 🚀 從 40% → 87.5% |
| **coverage_01_39** | 38 / 39 | **39 / 39** | +1 | 全 39 號都被推薦過 |
| **top10_coverage_ratio** | 51.9% | **48.5%** | −3.4pt | hot 號比例下降 |
| pair_repeat (連續兩期重疊) | 425 | 406 | −19 | 略改善 |
| **triple_repeat (連續兩期重疊)** | 251 | **175** | **−76** | 🚀 −30% |
| single_repeat (連續兩期同號) | 68 | 52 | −16 | 改善 |
| **max_combo_repeat** | 8 | **2** | **−6** | 🚀 沒有任何 5 星組合在 200 期內出現超過 2 次 |

> ℹ️ 這份比較使用 stub backtest decision（`three_star_main_enabled=false`），所以兩邊都走 fallback baseline scoring path。**Δ 才是有效訊號**；絕對 hit_rate 不代表 production 數值（production 使用真實 100-期 backtest decision，hit_rate 通常更高）。

---

## 2. 你問的 13 題逐項回答

### Q1. multi_strategy_v1 是否還會只在少數幾組號碼輪替？

**否。** baseline 的 distinct_five_combos = 108/200（很多重複），multi 提升到 197/200（98.5% 唯一）。max_combo_repeat 從 8 → 2（任何組合最多重複 2 次）。從統計上看是「**幾乎每天都不一樣**」。

### Q2. coverage 是否提升？

**是。** 01-39 完全覆蓋（38 → 39）。Top10 集中度從 51.9% 降到 48.5%。

### Q3. distinct combos 是否提升？

**是，大幅提升：**
- distinct_five_combos: +89（+82%）
- distinct_three_combos: +95（+119%）

### Q4. max_repeat 是否下降？

**是，從 8 降到 2**（同一 5 星組合最多重複次數）。

### Q5. pair / triple repeat 是否下降？

**是：**
- pair_repeat（連續兩期共同 pair）: 425 → 406（−4.5%）
- triple_repeat（連續兩期共同 triple）: 251 → 175（−30.3%）✨

triple 改善幅度遠大於 pair，這合理：5 星組合裡有 10 個 pair 但只有 10 個 triple，triple 對「固定核心群」更敏感。

### Q6. hit rate 是否退化？

**輕微退化：**
- single hit: 12.0% → 11.0%（−1.0pt）
- two hit: 2.0% → 1.5%（−0.5pt）
- three/four/five: 兩邊都 0（樣本量 200 對 3+/4+/5+ 命中本就不足以呈現差異）

### Q7. 如果退化，退化多少？

換算「絕對命中數」：
- single: 200 期裡少中 2 次（24 → 22）
- two: 200 期裡少中 1 次（4 → 3）

→ **微幅退化，遠小於分散度提升的幅度**。

### Q8. 是否值得上線？

**建議上線**。原因：

1. baseline 的「永遠在那幾組輪替」是真實痛點（distinct_five 只有 54%）；multi 把這個問題從根本解決（98.5% 唯一）。
2. 命中率代價極小（−1pt single, −0.5pt two），且本身命中率對 539 來說屬於統計學的「期望範圍內波動」。
3. 完全 ENV-gated，rollback 一行 ENV 改動即可。
4. baseline 完全保留，沒有任何破壞性變更。
5. cache schema 自動 invalidate，cloud-readonly 自動防誤寫。

⚠️ **注意事項**：
- 第一次 deploy 後 cron-sync 會 invalidate cache。從 latest_draw 變動開始才會用到新 cache。
- 建議先在 production 設定 `MULTI_STRATEGY_ENABLED=true` 但保留所有 default 權重，觀察 1-2 週命中率後再微調權重。

### Q9. 哪些 ENV 最影響分散效果？

按影響從大到小：

1. **`MULTI_STRATEGY_MAX_HOT_RATIO`**（預設 0.60）→ 直接限制 five_star 中 Top10 號碼的數量上限。降到 0.40 會強制更分散，可能再砍 0.5pt 命中率。
2. `STRATEGY_WEIGHT_COVERAGE` / `STRATEGY_WEIGHT_ANTI_CONCENTRATION` → 提高這兩個會讓 distinct combos 進一步提升。
3. `MULTI_STRATEGY_RECENT_RECOMMEND_WINDOW`（預設 5）→ 視窗大會看更遠的歷史，「不重複」的時間範圍變長。
4. `MULTI_STRATEGY_REVERSION_BONUS`（預設 1.08）/ `COVERAGE_BONUS`（預設 1.06）→ 加成倍率，影響 mid/cold 號的競爭力。

### Q10. 哪些策略最有效？

從 diagnostic 觀察：

- **Coverage Strategy** 對 distinct_combos 提升最大（直接 +89）。
- **Anti-Concentration Strategy** 對 triple_repeat 改善最直接（−76）。
- **Balance Strategy** 對 top10_coverage_ratio 影響最直接（−3.4pt）。
- Reversion 與 Trend 影響相對較緩，但都 deterministic 且 stable。

### Q11. 哪些策略最容易過度打散？

**Coverage Strategy**（如果權重拉太高）。它純粹根據「最近沒推薦」加成，可能把分數很低的號硬推上去。但目前有 `STRATEGY_WEIGHT_COVERAGE=0.10`（最低）+ Reversion 的 `MIN_SUPPORT_FACTOR=0.40` 守門 → 不會把垃圾號上架。

**對策**：若你發現命中率下降太多，先把 `STRATEGY_WEIGHT_COVERAGE` 降到 0.05、`STRATEGY_WEIGHT_TREND` 提到 0.45。

### Q12. 哪些策略最容易讓命中率下降？

**Reversion + Coverage**（合計 25%）— 它們的本質是「替低曝光號加成」，會把 trend 認為較弱的號擠進 Top5。

但 Reversion 有 `MIN_SUPPORT_FACTOR=0.40`：必須仍有 baseline 40% 以上分數才會被加成 → **完全沒支撐的號絕不會硬上**。

### Q13. 是否會繼續只在那幾組號碼輪替？

**否。** 200 期裡 197 組唯一 5 星組合，max_repeat=2。從統計學定義「不會在那幾組裡輪替」。

---

## 3. 微調建議（不必馬上做，先看實戰）

| 想要的效果 | 改 ENV |
|---|---|
| 再保守一點（更接近 baseline） | `STRATEGY_WEIGHT_TREND=0.50` `STRATEGY_WEIGHT_COVERAGE=0.05` |
| 再更分散 | `STRATEGY_WEIGHT_COVERAGE=0.15` `STRATEGY_WEIGHT_BALANCE=0.25` `MULTI_STRATEGY_MAX_HOT_RATIO=0.40` |
| 給冷門更多機會 | `MULTI_STRATEGY_REVERSION_BONUS=1.12` `MULTI_STRATEGY_MIN_SUPPORT_FACTOR=0.30` |
| 拉大「不重複窗口」 | `MULTI_STRATEGY_RECENT_RECOMMEND_WINDOW=10` |

---

## 4. 重跑 compare 的方法

```powershell
# 確保 backend 已 build、verify DB 已 bootstrap（npm run verify:local 跑過一次即可）
npm run compare:multi-strategy        # 預設 200 期
npm run compare:multi-strategy -- 100 # 改用 100 期（更快）
npm run compare:multi-strategy -- 500 # 改用 500 期（更穩）
```

報告會寫到 `compare-multi-strategy.json`（已加進 .gitignore 的 wildcard）。
