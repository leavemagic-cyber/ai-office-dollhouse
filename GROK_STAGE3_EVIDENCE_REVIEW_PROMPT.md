你已受委託做 AI 玩偶辦公室 Stage 3 的最終證據 gate。前一次逐檔工具讀取超過執行時限，現在不要呼叫任何工具；只依下列已擷取的精確程式證據判定。不得討論 Stage 4/5。

Owner 硬要求：同 Provider 多 SessionPod 不混；subagent 無 3/5 人上限；每 7 人垂直插入分隊；presence/舊紀錄不造 live 人員；Owner 請示及明確討論才跨樓；A–J 事件動畫全有；完成不能由 process exit 合成；全域佇列有界且重要事件優先；動態樓層可釋放。

精確證據（目前行號）：
- `domain.js:117-160` 正規化 session/agent/parent/correlation/participants/authority，重要事件由 allowlist 決定；`domain.js:261-275` pod 與 active agent 分開計數，以 2 pods 或 7 人建立 annex，session 身分不改。
- `domain.js:314-349` subagent 依真實 session/parent 建立，不存在可靠 pod 時只進 unknown/unassigned；已移除 renderer 原本的 5 人 slice。
- `domain.js:375-386` process_exited 只關 surface；adapter_disconnect 只降 unknown，兩者都不完成 session。
- `domain.js:414-425` 同一 pod 重複 Owner request 不重複 inbox，收到回覆才返回 running；`domain.js:440-451` 只有明確 session_stopped 才完成 pod 並把全部 child 標 finished。
- `domain.js:458-487` B/C/E/F/H 與 decision record 均維持在原 session pod；discussion 需要真實 session，保存 correlationId；delegated authority 只記錄授權範圍，觀察器沒有派工 API。
- `main.js:41-103` livePods 僅來自 active structured state；snapshot 分開保存並以 recent 判斷，舊 snapshot 不計人口；`main.js:75-90` recent snapshot 只按已列出的安全 agent 計 7 人 annex。
- `floor-layout.js:12-31` 順序固定為 Owner → 各 Provider 1/N..N/N → Lobby；`floor-layout.js:41-57` 依 session 與 agent 的真實位置決定事件落在哪個 annex。
- `main.js:225-266` 每個動態 annex 建立獨立 section/canvas/RoomRenderer(annexIndex)，有 `new-annex` 進場 class；`main.js:268-288` 不需要的樓層會 renderer.stop、IntersectionObserver.unobserve、DOM remove、Map delete，再依 SSOT 順序插入。
- `main.js:299-320` 每樓按該 annex 的 0–7 人計算高度、狀態、1/N 門牌與 start/stop；`main.js:364-385` 畫面外、收合與 document.hidden 均 stop rAF。
- `renderer.js:483-526` Owner 永久角色；waiting_owner 代表進 Owner；discussing 代表進 Lobby；Provider main 在跨樓時保留隱藏席位，subagent 無 5 人 slice，recent snapshot 另帶 snapshot=true。
- `renderer.js:697-717` 新 annex 僅在最新一層畫吊掛模組、施工條紋與亮門牌；CSS `styles.css:47-58` 有垂直插入的 annex-install 動畫。
- `choreography.js:3-15` A–J 全部對應：A spawn、B lead、C discussion、D failure、E revision、F pass、G owner、H authority、I multi-delivery、J task/session completion。
- `choreography.js:17-45` I 只有同 Provider 8 秒內至少 2 筆 agent_finished 才合成；A–H/J 都只取 recentEvents，不由 presence 合成。
- `choreography.js:47-95` 單一全域 coordinator：queue 上限 24、seen retention 45 秒、priority 排序、新高優先事件可中斷並保留低優先 cue、完成後解除 active；`main.js:326` 每個真實 compact model 只 ingest 一次。
- `choreography.js:98-107` Owner/Lobby/provider/annex 路由集中判斷；`renderer.js:829-833` 所有樓層讀同一 active cue 並只在合法目的樓畫，常態微動畫仍獨立持續。
- `renderer.js:640-694` A–J 使用原創 2.5D 箱、夾板、對話牌、工具卡、修訂文件、印章、敲門公事包、鑰匙卡、排隊文件、最終成果夾繪製，沒有外部資產或 Logo。
- 測試結果：`npm.cmd test` 27/27 PASS，含 A–J 完整映射、queue bounded、G preemption、跨樓真實路由、I 至少兩件、SessionPod 隔離、20 subagent=3 annex、Owner request 去重、session stop child release、垂直樓層順序。
- 專案檢查：`npm.cmd run check` PASS：61 files、15 JS、audioAssets=0、runtimeLogging=false；`git diff --check` 無 whitespace error（只有 Windows LF→CRLF 提示）。

請只輸出繁體中文：
1. `VERDICT: PASS` 或 `VERDICT: CHANGE`
2. 最多 6 個可由上述證據直接支持的 finding；沒有具體反例不得判 CHANGE
3. 已核對要求清單（多任務、垂直分隊、跨樓真實性、A–J、全域佇列、釋放）

