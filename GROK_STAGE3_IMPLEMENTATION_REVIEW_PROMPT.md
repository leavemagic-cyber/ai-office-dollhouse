你是 AI 玩偶辦公室 Stage 3 的唯讀實作審查者。只審查「多任務、subagent 階層、跨樓請示／討論、A–J 招牌動畫、垂直擴建與真實性」，不得擴張到 Stage 4 安裝封裝或 Stage 5 真實桌面視覺驗收。

Owner SSOT：`AI_OFFICE_DOLLHOUSE_V2_OWNER_GOAL_PLAN.md` 第 2.1–2.3、3.2、5、7.2、7.4、8、10、11 節。Stage 1、2 已經各自通過 Grok；不得推翻窄塔與 2.5D 美術方向。

請只讀：
- `resources/js/domain.js`
- `resources/js/main.js`
- `resources/js/renderer.js`
- `resources/js/floor-layout.js`
- `resources/js/choreography.js`
- `tests/domain.test.mjs`
- `tests/floor-layout.test.mjs`
- `tests/choreography.test.mjs`

本階段已驗證：`npm.cmd test` 24/24 PASS；`npm.cmd run check` PASS（60 files / 15 JS / 0 audio）；`git diff --check` 除既有 Windows LF→CRLF 提示外無 whitespace error。

硬要求：
1. 同 Provider 共樓但每個 top-level session 保持獨立 SessionPod；App／CLI 是來源，不是人口；parent-child 不跨 pod。
2. Provider 可缺席、主管不固定；只有真的產生 subagent 才成為經理；不可固定三人或五人上限。
3. 容量超過 7 人時在相同 Provider 下方插入垂直分隊樓層，門牌顯示 1/N、2/N；每層獨立 Canvas／生命週期，新增樓層有施工／吊掛／進場而非橫向擴張。
4. 近期 snapshot 可有明確 `S` 人員；舊紀錄、presence-only、程式開啟不能生成人員或工作動畫；沒有完成事件不能播完成。
5. Owner 永久保留；`owner_input_required` 讓真實 session 的代表離開來源樓、到 Owner 排隊／敲門；Owner 回覆後返回。授權決定仍保留 Owner 最終主導語義。
6. 跨 Provider 討論只由明確 `discussion_started`／correlation 事件觸發；代表前往公共大廳，不能由同時開啟程序推測。
7. A–J 全部有事件到動畫映射：A 新 subagent、B acting lead、C 討論、D 錯誤、E 修改、F 通過、G 請示、H 授權、I 多人交件、J 最終交件。A–H/J 不得由 presence 合成；I 只能由兩筆以上近期 `agent_finished` 合成。
8. 全域主演出佇列有界、重要事件優先且跨樓同步；常態工作微動畫仍可多樓並行。完成／錯誤／請示不得互相冒充。
9. 動態樓層畫面外、收合或 document hidden 時停止 rAF；樓層移除時 stop/unobserve/remove，不能累積 renderer。
10. 不新增外部素材、Logo、品牌配色、音效、LLM 呼叫、主動派工或任何控制 agent 的能力。

輸出繁體中文：
- `VERDICT: PASS` 或 `VERDICT: CHANGE`
- 最多 10 個 findings，每個必須附精確 `file:line` 與具體反例
- 若 CHANGE，只列主線內最小但完整修正；不得要求大設定頁、多視窗、固定 Provider、外部素材或降低 2.5D 品質
- 最後列出「已核對的硬要求編號」

