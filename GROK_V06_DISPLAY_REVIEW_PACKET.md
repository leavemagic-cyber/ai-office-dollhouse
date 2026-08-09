# Grok v0.6 自包含反方審查包

你是唯讀設計審查者。所有必要內容都在本 prompt 內；不要讀檔、呼叫工具、搜尋網路、修改檔案或產生 subagent。Owner 尚未授權 coding。

## 目標

審查一個 Windows 桌面低解析玩偶辦公室的「正確顯示方式」。它只觀察現有 AI 工作，不控制 AI，不為動畫呼叫 LLM。

## Owner 已確認或修正的方向

- Owner 永久保留最高位置，可指定哪些 AI 討論及授權指定群組作成決定。
- 同 Provider 優先共用團隊樓層；不是一個使用者任務蓋一層。
- 一個辦公室與一個 Provider 團隊本來就可同時處理多任務。
- 建築固定寬度、垂直擴張；人員／專案桌超過單層可讀容量才建立同 Provider 附屬樓層。
- 每個可見展開樓層都有廉價工作微動畫，可收合、隱藏、低動態、勿擾或只顯示重要事件。
- V1 完全無音效引擎、AudioContext、音訊素材、混音 timer 或背景聲道。
- 程式開啟後要主動偵測，盡量不要求使用者設定或分類任務。
- 所有程式、sprite、音效、字型、文案、Logo 與視覺素材採 clean-room 原創。

## 候選顯示模型

六個身份單位不得混用：

1. RuntimeSurface：Codex App／CLI、Claude Desktop Code／CLI、Gemini CLI、Grok CLI 等來源介面。
2. RuntimeProcess：只證明 installed／app_open／exit／unknown，不代表任務、session 或 agent 數。
3. SessionInstance：具有穩定 thread／session ID 的工作階段。
4. ProviderTeam：Codex／Claude／Gemini／Grok 團隊，是動態樓層單位。
5. SessionPod：同樓內的一張專案桌／工作小組，每個 top-level session 各自一桌。
6. AgentInstance：主 agent、subagent 或 sub-lead，以 agent ID 及 parent-child 關係識別。

Workstream／work_id 只是可選的整理、篩選與跨團隊會議標籤；不存在也能正確顯示。

同 Provider 的 App／CLI session 優先共樓，但各自成為 SessionPod，來源寫在桌牌。任何 SessionPod 都不因 Provider、cwd、標題相似、程序或時間接近而合併。Subagent 只依可靠 parent_agent_id／parent_session_id 歸桌。

跨 Provider 協作不混住團隊樓層；有明確 parent invocation、handoff、correlation 或 Owner 指派時，角色到公共會議室，會後回原團隊樓。Acting lead 只由明確事件或 Owner 指派顯示，不以最忙或最後發言推測。

單層超過約 2 位主 agent／經理加 8 位 subagent 時，可建立例如 Codex 1/2、Codex 2/2；這只是初始視覺門檻，不限制 agent 數。

最小例：

```text
Owner 辦公室
└─ Codex 團隊樓層
   ├─ 專案桌 A：命理（Codex App，session A）
   │  └─ 只有 session A 的實際 subagent
   └─ 專案桌 B：辦公室動畫（Codex App，session B）
      └─ 只有 session B 的實際 subagent
```

## 候選狀態真實性規則

- installed：只表示受信任套件或 executable 存在。
- app_open：只表示 App 主程序存在。
- running：必須有 prompt／turn／agent start 到 stop／after-agent／turn completed 的結構化事件。
- waiting_owner：只由 permission／approval／elicitation／明確請示事件觸發。
- completed：只由明確完成事件觸發；程序退出、關窗或 timeout 都不能推論完成。
- unknown：事件中斷、adapter 失聯或來源衝突時，保留最後可靠狀態並顯示灰色問號。

來源優先序：官方 hooks／JSONL／stream-json／ACP／app-server；再來是版本探測後的唯讀 session index／state database 補標題與 parent，但歷史列不代表 active；程序／視窗只能 presence。

## 啟動主動偵測

每次啟動自動掃描受信任的 Windows 套件、PATH、已知安裝位置、程序與祖先程序鏈；自動連接先前已授權的事件來源；依 session ID 建樓與分桌；持續監看新 session／agent；失聯時退避重連並顯示 unknown。

若結構化 hook 尚未安裝，仍自動顯示 installed／app_open。需要修改外部工具設定時，只在第一次逐 Provider 清楚詢問一次，允許一鍵安裝或略過；授權後自動版本檢查、最小 hook 設定、測試事件與後續重用。不得因主動偵測而升高未證實狀態。

## 已取得的證據摘要

- 本機同一 Codex App 狀態來源中可見「命理」與「辦公室動畫」兩個不同 root thread，另有明確 parent root 的 subagent rows；這只證明身份與 parent，不證明當下 active。
- Codex 官方 hooks 提供 session_id／turn_id 與 SubagentStart／Stop；codex exec --json 提供 thread／turn／item JSONL。
- Claude Desktop Code 與 CLI 使用 Claude Code engine 與 hooks，可有獨立 session；Claude Chat／Cowork 不假設有同等 Code hook，只有 presence 時不播放具體工作。
- Gemini CLI 提供 session／agent／tool hooks 與 stream-json，但目前沒有專用 subagent lifecycle hook；候選方案只把 subagent tool 的 BeforeTool／AfterTool 畫成委派區間。
- Grok CLI 提供 session／turn／tool／SubagentStart／Stop hooks、streaming-json 與 ACP session update。
- Electron helper 程序數明顯不能當成 session 或 agent 數。

## Phase -1 coding freeze

目前禁止 collector、adapter、renderer 與動畫 coding。先完成：各 surface 的觀測層級測試表；首次 discovery、hook 缺失、一次性授權、版本不相容、事件遺失、重連、重複事件與來源無法區分等 failure-mode 設計；用 synthetic 狀態表驗證同樓多 session 與 parent-child 不混桌。完成並經 Owner 確認後，才可開始 synthetic-only Phase 0。

## 請輸出

請用繁體中文，直接給：

1. Bottom line。
2. 三題逐題 verdict：如何偵測各 App／CLI；兩任務如何顯示；App 內多 session 如何顯示。
3. MUST-FIX before owner display approval；無則明寫無。
4. SHOULD-FIX in Phase -1。
5. 修正後的最小畫面樹（若原樹已正確可原樣）。
6. 最終 verdict：DISPLAY_MODEL_APPROVE、DISPLAY_MODEL_APPROVE_WITH_GUARDS 或 DISPLAY_MODEL_REVISE。
