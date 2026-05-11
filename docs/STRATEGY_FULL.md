# 539-system Strategy Full Guide

目前策略版本：`v6.1-three-star-stable`

這套系統是純歷史統計抓牌系統，不是 AI 明牌系統，也不是隨機選號器。所有結果必須從官方開獎資料或已驗證 DB 重新計算，並且要能追溯、驗證、重算。

## 1. 本日抓牌如何產生

系統永遠預測下一期尚未開獎，不預測最新已開獎期。

核心欄位：

- `latest_used_draw_no`：目前 DB 中最新已正式公布的期數。
- `latest_used_draw_date`：該期開獎日期。
- `target_draw_no`：下一期目標期數，通常是 `latest_used_draw_no + 1`。
- `target_date`：下一個有效開獎日。
- `model_version`：固定為 `v6.1-three-star-stable`。

prediction cache key 必須包含：

- `target_date`
- `target_draw_no`
- `latest_used_draw_no`
- `model_version`

只有這些條件完全相同，才可以回 cached prediction。日期或 target 變了，就必須建立新的 prediction，不可拿昨天的 cached 結果假裝今天可用。

## 2. 單號分數

每個號碼 01 到 39 都會由 backend 依最近 100 期真實 DB 計算分數。前端只顯示 backend 回傳結果，不自行算分。

主要分數來源：

- `frequency_score`：近 100 期單號頻率。
- `gap_score`：目前遺漏期數與平均 GAP 的回補狀態。
- `tail_score`：尾數分布。
- `pair_score`：二星共現支撐。
- `repeat_score`：與最新期重複分布。
- `balance_score`：奇偶、大小、區間、尾數、連號、重複等平衡。
- `backtest_score`：walk-forward 回測摘要修正。
- `overheat_score`：既有過熱控制，包含連開扣分與 100 期偏熱扣分。
- `anti-hot`：最後一層保守降權，只處理最近幾期短期過熱。

分數輸出保留：

- `original_score`
- `recent_hit_count`
- `antihot_factor`
- `anti_hot_adjusted_score`
- `antihot_reason`
- `raw_total_score`
- `normalized_score`
- `total_score`

## 3. 三星主力模型

v6.1 的核心是三星主力穩定版：

> 二星決定方向，補碼決定三星，三中三只是加分，平衡決定穩定。

三星不是單號 Top3 直接拼出來，而是從三種來源建立候選池：

1. 最近 100 期實際出現過的三星組合。
2. Top 二星延伸出的三星組合。
3. 最近 30 期活躍三星組合。

每組三星候選計算六個 component：

- `main_pair_score`：主二星骨架強度。
- `third_number_pair_support_score`：補碼與二星骨架的支撐。
- `triple_history_score`：三中三歷史共現，只加分，不是硬性優先。
- `number_strength_score`：三個單號本身強度。
- `gap_reversion_score`：GAP 回補狀態。
- `balance_overheat_score`：平衡與過熱控制。

權重固定：

```text
three_star_score =
main_pair_score * 0.35
+ third_number_pair_support_score * 0.25
+ triple_history_score * 0.15
+ number_strength_score * 0.10
+ gap_reversion_score * 0.07
+ balance_overheat_score * 0.08
```

權重總和為 1。v6.1 不自動亂調權重。

## 4. 三中二 + 1 碼如何支撐三星

三中二是主骨架。補碼 C 不是隨便補：

- 檢查 pair(A,C)
- 檢查 pair(B,C)
- 檢查 C 的 100 期頻率
- 檢查 C 的 10/20/30 近期狀態
- 檢查 C 是否過熱或過冷

三中三歷史只當加分：

- 近 100 期出現 3 次以上：高加分
- 出現 2 次：中加分
- 出現 1 次：小加分
- 沒出現：不扣分，也不刪除

## 5. 四星 / 五星延伸

四星與五星必須從主力三星延伸：

- 四星 = 主力三星 + 第 4 顆最佳號碼
- 五星 = 四星 + 第 5 顆最佳號碼

第 4、第 5 顆會考慮：

- 單號分數
- 與三星內號碼的 pair 支撐
- GAP 補分
- 過熱扣分
- 平衡模型
- 組合去重
- 未中降權

禁止重新亂拼，也禁止前端自行組合。

## 6. 過熱控制

過熱控制不是封殺號碼，只是扣分。

### 連開扣分

從最新已開獎期往前看：

- 0 期：0
- 1 期：-1
- 2 期：-3
- 3 期：-6
- 4 期以上：-9

### 100 期偏熱扣分

用最近 100 期的實際分布算：

- `mean100`
- `std100`
- `count100`

規則：

- `count100 > mean100 + 2 * std100`：扣 3
- `count100 > mean100 + 1 * std100`：扣 1
- 其他：不扣

### Top10 熱號控制

Top10 中熱門號太多時，只對後段熱號做輕微降權，不刪號碼。

## 7. GAP 冷號補分

GAP 是平衡用途，不是盲目追冷。

分成：

- 正常
- 接近回補
- 偏冷觀察
- 過冷不追

極端過冷不會無限加分，避免冷號陷阱。

## 8. Anti-hot 保守版

anti-hot 是最後一層短期過熱降權，目的只是避免最近 5 期內反覆開出的號碼長期霸榜。

設定：

```env
ANTIHOT_ENABLED=true
ANTIHOT_WINDOW=5
ANTIHOT_MIN_FACTOR=0.60
```

規則：

- 最近 `ANTIHOT_WINDOW` 期出現 0 到 1 次：`factor = 1.00`
- 出現 2 次：`factor = 0.90`
- 出現 3 次：`factor = 0.80`
- 出現 4 次以上：`factor = 0.65`

最後：

```text
anti_hot_adjusted_score = original_score * factor
```

`factor` 不可低於 `ANTIHOT_MIN_FACTOR`。

anti-hot 不刪除號碼、不封殺號碼、不讓分數直接變 0。像 08 這類短期過熱但本身仍有高統計支撐的號碼，仍可能留在榜上，只是排名會被合理壓低。

## 9. 下注建議與可信度

下注建議由 backend 計算：

- 強攻
- 小攻
- 觀望
- 不建議

可信度：

- 高
- 中
- 低

v6.1 的日常狀態以小攻 / 觀望為主；強攻只在訊號很集中且風險低時出現；不建議只在極端盤出現。

## 10. 命中統計

命中統計來自 `observation_logs`，也就是 observation logs。

每次 prediction 產生後，先記錄：

- 目標期數
- 使用資料
- 選出的獨支、二星、三星、四星、五星
- 下注建議
- 可信度

開獎後才補記：

- actual numbers
- single hit
- two-star hit
- three_star_hits
- four_star_hits
- five_star_hits

統計項目：

- 三星命中率
- `avgHits`
- `maxLoseStreak`
- 依強攻 / 小攻 / 觀望 / 不建議分組

pending prediction 不算未中。

## 11. 模型限制

這套系統不是保證中獎，也不是官方推薦。它只是一個基於真實歷史資料、100 期統計、walk-forward 回測與固定策略版本的選號輔助工具。

資料異常、官方資料不可確認、DB 不足 100 期時，系統不應出正式結果，也不應補假資料。
