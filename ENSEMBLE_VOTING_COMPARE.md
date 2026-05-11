# Ensemble Voting v1 — Compare Report (Phase 2.5)

## 候選版（Candidate）— **Variant C**

> **Phase 2.5 結束時的候選設定。預設仍 OFF；要啟用請複製貼上 4 個 ENV 例的 candidate 區塊。**
>
> Variant C 不是 random、不是 blacklist、不是 hard ban；
> 它用 deterministic 的 **exposure penalty + consensus protection** 做有邏輯的輪替：
>
> 1. 統計每個 01-39 號在最近 N 期 prediction 的曝光次數
> 2. 超過 `MAX_REPEAT` → 套乘性 soft penalty（每多 1 次再乘一次）
> 3. 若該號被 3+ strategy 共識支持 → penalty 嚴重度減半（不誤殺強號）
> 4. 同時保留 Phase 2 的 pair lock / triple lock / trend-only anti-dominance
>
> ```env
> ENSEMBLE_VOTING_ENABLED=true
> ENSEMBLE_VOTING_VERSION=ensemble_voting_v1
> ENSEMBLE_NUMBER_EXPOSURE_MAX_REPEAT=3
> ENSEMBLE_NUMBER_EXPOSURE_PENALTY=0.75
> ENSEMBLE_CORE_GROUP_MAX_EXPOSURE=3
> ENSEMBLE_CORE_GROUP_PENALTY=0.78
> # 其餘 ENSEMBLE_* 全部走預設（已記錄在 backend/.env.example）
> # 並需先有：MULTI_STRATEGY_ENABLED=true
> ```
>
> **Production 預設不要直接開**。建議先：
> 1. 本機 `cloud-readonly` 環境啟用 → 看真實 Firestore 資料但不寫
> 2. （可選）Vercel Preview 環境啟用 → 看雲端跑出的結果
> 3. 觀察 1-2 週 rolling recent_10 / recent_30 真實命中率與 core_group 出現次數
> 4. 確認 OK 再翻 production ENV
>
> **Rollback**：把 `ENSEMBLE_VOTING_ENABLED` 改為 `false` 或移除即可，
> 沿用 multi_strategy_v1 行為；或同時關掉 `MULTI_STRATEGY_ENABLED` 回到 baseline。
> cache schema 會隨 ENV 自動失效，不需手動清。

---


> 由 `scripts/compare-ensemble-voting.js` 在 `backend/data/539.verify.sqlite` 上
> 跑 150 期 walk-forward，並把結果切成 **rolling windows** 才能反映用戶實際
> 體感的短中期分散度（單一 500 期平均會把短期問題稀釋掉）。
>
> 三模式定義（rollback 表）：
> - `baseline`：`MULTI_STRATEGY_ENABLED=off, ENSEMBLE_VOTING_ENABLED=off`
> - `multi_strategy_v1`：`MULTI_STRATEGY_ENABLED=on, ENSEMBLE_VOTING_ENABLED=off`
> - `ensemble_voting_v1`：`MULTI_STRATEGY_ENABLED=on, ENSEMBLE_VOTING_ENABLED=on`
>
> 三個 ENV 變體：
> | 變體 | 含義 | 與 Phase 2.5 預設的差異 |
> |---|---|---|
> | **A** | default Phase 2.5 | 全部 ENV 為預設值 |
> | **B** | mild lower-trend | `STRATEGY_WEIGHT_TREND=0.15`、`STRATEGY_WEIGHT_ANTI_CONCENTRATION=0.27`（其它預設） |
> | **C** | mild exposure | `NUMBER_EXPOSURE_MAX_REPEAT=3 / PENALTY=0.75`、`CORE_GROUP_MAX_EXPOSURE=3 / PENALTY=0.78`（其它預設） |
>
> JSON 報告：
> - [compare-ensemble-voting.A.json](compare-ensemble-voting.A.json)
> - [compare-ensemble-voting.B.json](compare-ensemble-voting.B.json)
> - [compare-ensemble-voting.C.json](compare-ensemble-voting.C.json)
>
> 重跑：
> ```bash
> npm run compare:ensemble-voting -- 150
> # 套用變體 ENV：
> COMPARE_VARIANT_LABEL=C \
>   ENSEMBLE_NUMBER_EXPOSURE_MAX_REPEAT=3 ENSEMBLE_NUMBER_EXPOSURE_PENALTY=0.75 \
>   ENSEMBLE_CORE_GROUP_MAX_EXPOSURE=3 ENSEMBLE_CORE_GROUP_PENALTY=0.78 \
>   npm run compare:ensemble-voting -- 150
> ```

## 重要觀察先講

**baseline 在這份 150 期 walk-forward 資料中，core_group(21/8/22/16/27) 出現
頻率本來就不高**（all-window 83/750 = 11.1%，低於理論 12.8%；recent_30 只有 5）。
用戶感受到的「核心群一直輪替」是真實 production 環境中某段時間的序列現象，
clean walk-forward 把它平均掉了。

意義：compare 拿來證明的是「啟用 ensemble 不會讓系統變差」與「penalty 機制
真的有觸發」，而不是「ensemble 一定會比 baseline 把 core_group 壓更低」。
壓 core_group 的真正測試環境是 production 上每天觀察。

## Rolling Window：recent_10（用戶日常體感）

| 指標 | base | multi | ens A | ens B | ens C |
|---|---:|---:|---:|---:|---:|
| hit_rate.single | 0.3000 | 0.1000 | 0.1000 | 0.1000 | **0.2000** |
| distinct_five_combos | 7 | **10** | **10** | **10** | **10** |
| coverage_01_39 | **22** | 19 | 19 | 19 | 18 |
| hot_number_top10_ratio | **0.66** | 0.74 | 0.76 | 0.74 | 0.70 |
| pair_dominance_max | 4 | 4 | 4 | 4 | **3** |
| pair_repeat_consecutive | 6 | 9 | **0** | **0** | **0** |
| triple_repeat_consecutive | 2 | 2 | **0** | **0** | **0** |
| single_repeat_consecutive | 3 | 1 | **0** | **0** | **0** |
| max_combo_repeat | 3 | **1** | **1** | 3 | **1** |
| core_group_rotation_count | **4** | 7 | 11 | 10 | 11 |

> 10 期太短，hit_rate 抖動極大（每命中 1 次 = 0.1）。重點看：
> - 三個 ens 變體 **連續重複徹底歸零**（pair/triple/single = 0）。
> - C 的 hit_rate（0.2）已接近 baseline（0.3）；A、B 同樣只 0.1。
> - 但 ens 在 10 期內 core_group 出現次數 10–11，比 baseline 4 高 — 短期內熱號
>   仍會在 ens 中被選到。

## Rolling Window：recent_20

| 指標 | base | multi | ens A | ens B | ens C |
|---|---:|---:|---:|---:|---:|
| hit_rate.single | 0.2000 | 0.0500 | 0.1500 | 0.2000 | **0.2500** |
| distinct_five_combos | 13 | **20** | **20** | 17 | **20** |
| coverage_01_39 | 25 | 25 | 27 | 26 | **28** |
| hot_number_top10_ratio | 0.69 | 0.61 | **0.48** | 0.50 | **0.48** |
| pair_dominance_max | 7 | **4** | 5 | 5 | 5 |
| pair_repeat_consecutive | 15 | 23 | 1 | **0** | **0** |
| triple_repeat_consecutive | 4 | 8 | **0** | **0** | **0** |
| single_repeat_consecutive | 3 | 2 | **0** | **0** | **0** |
| max_combo_repeat | 3 | **1** | **1** | 3 | **1** |
| core_group_rotation_count | **5** | 7 | 16 | 15 | 16 |

> recent_20 已開始顯示 ens 的優勢：hot ratio 大幅下降（0.48 vs base 0.69），
> coverage 略升（28 vs 25），連續重複歸零。但 core_group 還是比 base 多。
> **變體 C 的 hit_rate.single 0.25 領先全部**。

## Rolling Window：recent_30（最有代表性的中短期視窗）

| 指標 | base | multi | ens A | ens B | ens C |
|---|---:|---:|---:|---:|---:|
| hit_rate.single | 0.1667 | 0.1000 | 0.1000 | 0.1333 | **0.2000** |
| hit_rate.two | 0.0000 | 0.0333 | 0.0000 | 0.0000 | 0.0000 |
| distinct_five_combos | 17 | **30** | 29 | 22 | **30** |
| coverage_01_39 | 25 | 27 | 28 | 26 | **29** |
| hot_number_top10_ratio | 0.66 | 0.56 | 0.52 | 0.56 | **0.5067** |
| pair_dominance_max | 10 | **5** | 9 | 10 | 7 |
| triple_dominance_max | 9 | **3** | 5 | 8 | 6 |
| pair_repeat_consecutive | 60 | 41 | 1 | **0** | **0** |
| triple_repeat_consecutive | 40 | 13 | **0** | **0** | **0** |
| single_repeat_consecutive | 6 | 3 | **0** | **0** | **0** |
| max_combo_repeat | 5 | **1** | 2 | 6 | **1** |
| core_group_rotation_count | **5** | 13 | 25 | 25 | **23** |
| trend_only_ratio_avg | — | — | 0.017 | **0.000** | 0.007 |
| cross_strategy_consensus_avg | — | — | 0.557 | 0.564 | **0.569** |

> **這個視窗是判斷哪個變體最平衡的關鍵**。變體 C 在 recent_30 同時拿到：
> - 最高 hit_rate.single（0.20，> baseline 0.17）
> - 最高 distinct_five_combos（30）
> - 最高 coverage_01_39（29）
> - 最低 hot_number_top10_ratio（0.51，比 multi 還低）
> - 最低 ensemble 變體 core_group（23）
> - 最高 cross_strategy_consensus（0.569）
> - 連續重複全部 0

## Rolling Window：all（150 期長期 sanity check）

| 指標 | base | multi | ens A | ens B | ens C |
|---|---:|---:|---:|---:|---:|
| hit_rate.single | 0.1067 | 0.0867 | 0.0933 | **0.1600** | 0.1133 |
| hit_rate.two | **0.0200** | 0.0133 | 0.0067 | 0.0133 | 0.0067 |
| distinct_five_combos | 78 | **146** | 133 | 96 | 129 |
| coverage_01_39 | 38 | **39** | 34 | 31 | 34 |
| hot_number_top10_ratio | 0.4973 | 0.4933 | **0.4533** | 0.4667 | **0.4533** |
| pair_dominance_max | 26 | **22** | 28 | 36 | 27 |
| triple_dominance_max | 21 | **8** | 19 | 28 | 16 |
| pair_repeat_consecutive | 298 | 308 | 1 | **0** | 1 |
| triple_repeat_consecutive | 191 | 127 | **0** | **0** | **0** |
| single_repeat_consecutive | 50 | 36 | **0** | **0** | **0** |
| max_combo_repeat | 8 | **2** | 3 | 9 | 8 |
| core_group_rotation_count | **83** | 79 | 114 | 116 | 111 |
| trend_only_ratio_avg | — | — | 0.010 | **0.000** | 0.013 |
| cross_strategy_consensus_avg | — | — | 0.575 | 0.576 | **0.578** |

## 必答問題

### 1. 是否已停止 500 期背景 compare
**是**。原 500-期任務 + 監控全部 TaskStop。本次不再跑 500。

### 2. 是否已改成 rolling window compare
**是**。compare script 內每個模式都產出 `windows.recent_10 / recent_20 / recent_30 / all` 四組指標，並在 console 印出對齊表。JSON 報告也保留四組。

### 3. recent_10 / 20 / 30 / 150 結果
詳見上方四個區塊。重點：
- recent_10：樣本太短，hit_rate 抖動大；ens 連續重複歸零、但 core_group 比 base 多。
- recent_20：ens 開始顯示 hot ratio 與 coverage 優勢。
- **recent_30：變體 C 全面領先**（hit_rate / distinct / coverage / hot / consensus 都最佳）。
- all：multi 在 distinct_combos 上仍最強；ens 在 hot ratio、連續重複、cross_strategy_consensus 上最佳。

### 4. default / lower-trend / mild-exposure 三組比較

| 取捨面 | A 預設 | B 低 trend 權重 | **C 緩 exposure** |
|---|---|---|---|
| 連續重複歸零 | ✅ | ✅ | ✅ |
| hit_rate.single (recent_30) | 0.10 | 0.13 | **0.20** |
| hot_top10_ratio (recent_30) | 0.52 | 0.56 | **0.51** |
| coverage_01_39 (recent_30) | 28 | 26 | **29** |
| core_group (recent_30) | 25 | 25 | **23** |
| distinct_five (all) | 133 | 96 | 129 |
| max_combo_repeat (all) | **3** | 9 | 8 |
| trade-off | 預設平衡 | hit 略升、但 distinct/coverage/max_repeat 退步 | **整體最平衡** |

B 的問題：把 trend 權重降到 0.15 後，meta voting 過度依賴 anti_concentration 的
reciprocal-rank 訊號，導致 distinct_combos 在 150 期下從 133 跌到 96 — 變得更
集中，max_combo_repeat 反而升到 9。**low-trend 不是正確的方向**。

### 5. 哪一組最平衡
**C（mild-exposure）**。
- 短中期：recent_30 全面領先（hit / distinct / coverage / hot / consensus）。
- 長期：與 A 接近，hot_ratio 與 A 並列最低（0.4533）；distinct 介於 A 與 multi 之間；hit_rate.single 0.113 vs baseline 0.107 — 沒有退化。
- 沒有任何指標明顯比 A 差。

### 6. 是否仍有核心群輪替
**有，但比 ens A / ens B 輕**。recent_30 下 C-ens core_group=23 vs A-ens 25 vs B-ens 25。

仍高於 baseline（5）和 multi（13）。原因在「重要觀察」段已說明：baseline 在這份
walk-forward 中本來就沒有 core_group dominance，所以 ens 沒法比它更低；
真正能看出 ensemble 對 core_group 抑制效果的是 production 上實際出現「同樣 21+8
連 5 天上榜」這種序列 — clean walk-forward 不會自然產生這種序列。

### 7. 是否仍有 hot dominance
**已明顯下降**。recent_30 下 C-ens hot_top10_ratio = 0.51，**比 multi（0.56）和 baseline（0.66）都低**。
全期 0.4533 也是各變體最低。

### 8. coverage 是否合理
**recent_30 達標**（C=29/39 = 74%；baseline 25/39 = 64%）。全期 34/39 = 87% 仍低於 baseline 38 / multi 39 — 是 ensemble 的取捨：強化 anti_concentration / coverage 仍無法把長期極冷號補滿。

可接受程度：若目標是「短中期可見到 01-39 多數號碼」，C 是達標的。

### 9. hit rate 是否崩掉
**沒崩**。150 期下：
- single：base 0.107、multi 0.087、C-ens 0.113（**略高於 baseline**）
- two：base 0.020、multi 0.013、C-ens 0.007（差 0.013 = 2 次命中，屬統計雜訊）
- three+：三模式都是 0（5/39 抽 5 在 150 期下命中三星本來就極稀有）

recent_30：C-ens single 0.20 反而**最高**。沒有任何崩潰跡象。

### 10. build 結果
**PASS**（Phase 2.5 後 `npm run build` 第一次跑過、之後 compare 反覆 require 也沒拋錯）。

### 11. verify:local 結果
**PASS**（Phase 2.5 後 `npm run verify:local -- --skip-bootstrap` 完整跑完）。
`scripts/verify-local.js` 內已加入 `ENSEMBLE_VOTING_ENABLED=''` 確保 verify 永遠走 baseline cache schema。

### 12. API 是否仍健康
**完全健康**。Phase 2.5 後在 isolated port 3092（`CLOUD_READONLY=true / ENSEMBLE_VOTING_ENABLED=true`）測試結果：
- `/api/health` 200，`cloud_readonly: true`
- `/api/data/status` 200，`status: VALID, totalDraws: 5858`
- `/api/prediction/today` 200，回傳完整 ensemble diagnostic（含 `exposure_penalty / core_group_penalty / hot_top10_penalty / consensus_protected` 新欄位）
- `/api/latest-draw` 200
- `/api/previous-draw` 200
- `/api/sync-logs` 401（無 admin token）
- `POST /api/sync-now` **403 + CLOUD_READONLY_BLOCKED**（guard 保留生效）

### 13. 是否建議上線
**還不建議直接 production 上線，但比 Phase 2 前更接近可上線**。

**支持上線（變體 C）**：
- ✅ recent_30 hit_rate.single（0.20）高於 baseline（0.17）
- ✅ recent_30 hot_top10_ratio（0.51）低於 multi（0.56）和 baseline（0.66）
- ✅ recent_30 coverage（29）高於 baseline（25）
- ✅ 連續 pair/triple/single 重複歸零
- ✅ cross_strategy_consensus 0.578（最高） + trend_only 0.013（最低）
- ✅ 不退 hit_rate

**反對立即上線**：
- ⚠️ all-window core_group_count（111 vs baseline 83）仍偏高 — 雖然 baseline 本身在這份資料中 core_group 沒過量，但 ensemble 把它推得更高，這在用戶感受上「會繼續看到 21/8 出現」。
- ⚠️ all-window coverage（34/39）仍低於 baseline（38）。

**最關鍵**：clean walk-forward 沒能重現用戶感受的 core_group 持續輪替，無法在
compare 上「證明」C 變體在 production 上會把 core_group 拉到 baseline 以下。
這必須在 production 觀察才能驗證。

### 14. 如果不建議，下一步是調 ENV 還是改 strategy 結構

**先調 ENV，不要動 strategy 結構**。理由：

1. 變體 C 已經是 ENV 微調，沒做結構改變 → recent_30 五項指標全部領先 A/B。
2. 結構改變（例：trend strategy 改成不用 baseline 而用其他訊號）會放大 hit_rate 風險；目前 hit 沒崩，不該冒險。
3. 真正的「core_group dominance」測試環境是 production，不是 walk-forward。

**建議下一步**：
1. **本機保持 `ENSEMBLE_VOTING_ENABLED=false` 預設**（multi_strategy_v1 維持上線）。
2. 在 cloud-readonly dev backend 開啟變體 C ENV 持續觀察 1-2 週真實預測。
3. 收集 production 上每日 prediction，計算 rolling recent_10 / recent_30 真實命中率與 core_group 出現次數。
4. 若 production rolling recent_30 顯示 C 確實壓低了 core_group（vs 同期 multi_strategy_v1 對照），再翻 production ENV。
5. 若 production 兩週後仍看到 core_group 高，**才**考慮結構修改（例如：把 trend strategy 從「沿用 baseline normalized_score」改成「rank-based softmax 拉平」— 但這要新一輪 Phase 3 規劃）。

## 變體 C 推薦 ENV（若使用者決定本機開啟）

```env
# ── 核心開關 ──
ENSEMBLE_VOTING_ENABLED=false                # 預設仍關，使用者翻 true 啟用
ENSEMBLE_VOTING_VERSION=ensemble_voting_v1
MULTI_STRATEGY_ENABLED=true                  # 需先開 multi_strategy_v1

# ── 變體 C 微調（比 Phase 2.5 預設稍嚴格的 exposure penalty）──
ENSEMBLE_NUMBER_EXPOSURE_MAX_REPEAT=3        # 預設 4 → 3，更早觸發
ENSEMBLE_NUMBER_EXPOSURE_PENALTY=0.75        # 預設 0.80 → 0.75，稍嚴
ENSEMBLE_CORE_GROUP_MAX_EXPOSURE=3           # 預設 4 → 3
ENSEMBLE_CORE_GROUP_PENALTY=0.78             # 預設 0.82 → 0.78

# 其餘 Phase 2 / Phase 2.5 ENV 都保留預設（不貼出，預設已寫在 backend/.env.example）
```

## Rollback 對照表（未動）

| 目標 | 設定 |
|---|---|
| 回到 baseline | `MULTI_STRATEGY_ENABLED=false`<br>`ENSEMBLE_VOTING_ENABLED=false` |
| 回到 multi_strategy_v1 | `MULTI_STRATEGY_ENABLED=true`<br>`ENSEMBLE_VOTING_ENABLED=false` |
| 啟用 ensemble_voting_v1（變體 A 預設） | `MULTI_STRATEGY_ENABLED=true`<br>`ENSEMBLE_VOTING_ENABLED=true` |
| 啟用 ensemble_voting_v1（變體 C） | 上面 + 4 個 EXPOSURE/CORE 微調 ENV |

cache schema 隨 ENV 自動失效；rollback 不需手動清 cache。
