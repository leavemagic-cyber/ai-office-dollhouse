# Grok v0.6 Provider 團隊樓層、多任務與自動偵測反方審查

請唯讀開啟目前工作目錄內：

1. `AI_OFFICE_DOLLHOUSE_DESIGN_SPEC.md`（應為 `Concept Spec v0.6 Candidate`）
2. `DETECTION_AND_DISPLAY_EVIDENCE_20260809.md`

只審查本輪新增的多任務顯示、App／CLI 偵測、session／subagent 身份與零音效預算。不要重做 v0.4 的整體產品審查。

Owner 的三個問題：

1. Codex App、Claude App、Codex CLI、Claude CLI、Gemini CLI、Grok CLI 應如何正確偵測？
2. 同時有「命理」與「辦公室動畫」兩個不同任務時，畫面如何在同一 Provider 樓內不混桌？
3. Codex App 與 Claude App 自身都可多 session，畫面如何避免把一個 App／程序誤當一個任務或一個人？

請特別攻擊以下候選結論：

- 樓層以 Provider 團隊為主；同 Provider 的 App／CLI session 優先共用一樓。
- 每個 top-level session 在同樓有獨立 SessionPod／專案桌；subagent 只能依可靠 parent 關係歸桌。
- `work_id` 降為可選整理標籤，不是建立樓層或正確顯示的前提。
- 跨 Provider 協作使用公共會議室，角色會後回自己的團隊樓層。
- SessionPod 永不因標題、cwd 或時間接近而自動合併；parent invocation、handoff token、correlation ID 或 Owner 對應只建立跨桌／跨團隊協作關係。
- process 只能判斷 installed／app_open／exit／unknown；不能推論任務數、agent 數或 completed。
- lifecycle hooks／JSONL／ACP 優先；本機 index/state database 只作版本探測後的補充，不把歷史列當活躍狀態。
- Claude Desktop Chat／Cowork 若沒有結構化 Code hooks，只顯示 presence，不播放具體工作動畫。
- Gemini 目前沒有專用 subagent lifecycle hook時，只顯示 subagent tool 的委派區間，不假裝看到內部步驟。
- V1 完全不建立音效引擎或 AudioContext。

請檢查：

1. 上述 display ontology 是否有概念錯置、漏掉的多任務情況或仍會重複／混層。
2. 各 surface 的偵測契約是否把「官方能力」「本機已觀察」「仍待實機探針」分得夠清楚。
3. App 與 CLI surface 無法可靠區分時，降級成「來源未確認」是否正確。
4. Provider 團隊樓層、SessionPod、附屬樓層與跨團隊會議是否還缺少會阻止 Phase 0 的規則。
5. 目前 Phase -1 coding freeze 是否足夠；什麼條件通過後才可開始 synthetic-only Phase 0。
6. 零音效方案是否真的是最低資源與最低實作複雜度。
7. 啟動主動 discovery、一次性 hook 授權與後續自動重連能否同時做到低打擾與不誤判；還缺哪些必測 failure mode。

限制：

- 唯讀，不修改、建立或刪除任何檔案。
- 不執行外部命令、網路搜尋、安裝或 subagent。
- 不讀取 `.env`、credentials、auth、raw prompt、transcript、session 內容或其他敏感檔案。
- 不要用程序數、視窗數、cwd 或更新時間猜 active task；Provider 只能決定團隊樓層，不能合併 SessionPod 或推論工作狀態。
- Owner 是最終決定者；不要宣告已授權開始 coding。

請用繁體中文輸出：

- Bottom line。
- 三個 Owner 問題逐題 verdict。
- `MUST-FIX before owner display approval`（若無請明寫無）。
- `SHOULD-FIX in Phase -1`。
- 一個「命理＋辦公室動畫」的最小正確畫面樹。
- 最終 verdict：`DISPLAY_MODEL_APPROVE`、`DISPLAY_MODEL_APPROVE_WITH_GUARDS` 或 `DISPLAY_MODEL_REVISE`。
