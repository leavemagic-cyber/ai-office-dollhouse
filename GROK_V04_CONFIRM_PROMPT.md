# Grok 第二輪確認審查

請唯讀開啟目前工作目錄內的 `AI_OFFICE_DOLLHOUSE_DESIGN_SPEC.md`，確認檔案版本為 `Concept Spec v0.4`，再審查完整規格。

背景：你先前對 v0.1 給出 `GO_WITH_CHANGES`。Codex 已根據 Owner 決定與你的工程性建議更新規格，並另外加入：

- 明確的觀測面／控制面邊界。
- `AgentInstance`、`WorkItem`、`AuthorityGrant`、`MeetingRecord` 與事件關聯欄位。
- `LayoutPolicy` 本機化、事件冪等、排序、背壓與 coalescing。
- 全樓真實狀態＋微動畫，以及大型演出的全域動畫預算。
- 一鍵隱私遮罩、redaction、retention 與本機 IPC 鑑權。
- `ResourceLifecycleManager`、LRU、日誌輪替、renderer-only restart 與 8 小時 soak test。
- `MainlineProtection`：只降低玩偶辦公室本身的 CPU、FPS、I/O 與動畫，不得干預任何外部 AI／CLI 程序。
- Owner 決定 A–J 全部保留為 V1 設計目標；Phase 0 先通過效能沙盒，再以共用 animation primitives 分批完成。

請檢查：

1. 第一輪提出的主要 blocker 是否已解決；逐項標為 `RESOLVED`、`PARTIAL` 或 `OPEN`。
2. v0.4 是否產生新的矛盾、資料遺失風險或控制面越界。
3. 自動資源釋放是否可能誤清理 P0–P2、Owner 請示、未完成工作或外部 AI 程序。
4. `MainlineProtection` 是否足以讓主線 Codex／CLI 工作優先，又不讓觀察狀態失真。
5. 所有可見樓層維持微動畫、同時限制大型位移的方案是否可實作。
6. 效能目標與測試方法是否合理；哪些數字必須等 prototype 校準。
7. 保留 A–J 為 V1 目標、但先做 Phase 0 效能閘門，是否可以接受。
8. 是否仍有任何會阻止開始 Phase 0 synthetic-event 動畫沙盒的 MUST-FIX。

限制：

- 唯讀，不要修改、建立或刪除任何檔案。
- 不要執行外部命令、網路搜尋、安裝或 subagent。
- 不讀取 `.env`、credentials、auth、session 或其他敏感檔案。
- 不要把 Provider 固定成永久職級或人格。
- 不要建議 fork、複製或重用相似 repo 的程式、美術、文案或品牌資產。
- 不要把模型隱藏思考當成可取得資料。
- Owner 已決定 A–J 保留；可建議實作排序，但不要再次把刪除 A–J 當作 blocker。

請用繁體中文輸出：

- 一段 bottom line。
- 第一輪問題的逐項狀態表。
- 新發現（若無則寫「無新的 MUST-FIX」）。
- 最多 8 項修改建議，清楚區分 `MUST-FIX before Phase 0`、`SHOULD-FIX during Phase 0`、`LATER`。
- 最終 verdict：`GO_PHASE_0`、`GO_PHASE_0_WITH_GUARDS` 或 `HOLD`。
