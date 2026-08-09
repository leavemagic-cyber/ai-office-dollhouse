# AI 玩偶辦公室：偵測與顯示證據快照

日期：2026-08-09（Asia/Taipei）
用途：支援 Concept Spec v0.6 Candidate 的 Phase -1；不是 live-state API 保證，也不授權開始 coding。

## 結論

Windows 程序只能可靠回答「軟體是否安裝／App 是否開啟／程序是否退出」，不能回答「有幾個任務、哪個 session 正在工作、帶了幾個 subagent」。畫面身份必須以結構化 thread／session／agent ID 為主。

## 本機只讀快照

| Surface | 本機版本／套件 |
|---|---|
| Codex App | `OpenAI.Codex` 26.803.5235.0 |
| Codex CLI | `codex-cli` 0.146.0；本機 feature list 顯示 hooks 為 stable/enabled |
| Claude Desktop | `Claude` 1.26832.0.0 |
| Claude Code CLI | 2.1.220 |
| Gemini CLI | 0.47.0 |
| Grok CLI | 0.2.118 stable |
| Antigravity CLI | `agy` 1.1.10；必須和 `gemini` 分開識別 |

程序快照中，Codex App 同時存在多個 `ChatGPT.exe` helper 與一個 App 內 `codex.exe`；Claude Desktop 也存在多個 `Claude.exe` helper。這些 helper 數量是 App 架構，不是 session 或 agent 數。

Codex 本機 state database 的最近記錄同時包含：

- 「辦公室動畫」root thread，`source=vscode`。
- 「命理」root thread，`source=vscode`。
- 多筆具有明確 parent thread 的命理 subagent 記錄。

這證明同一 Codex App surface 可以同時對應兩個 root 工作與多個 child agent；但資料庫的存在或 `updated_at` 不能單獨證明目前正在運行。active／idle／completed 必須等 lifecycle 事件。

## 官方／第一方介面核對

### Codex

- [OpenAI Docs: Hooks](https://learn.chatgpt.com/docs/hooks)：hook common input 包含 `session_id`、`cwd`、event name；Codex 擴充提供 turn ID，並有 `SubagentStart`／`SubagentStop` 的 `agent_id`。
- [OpenAI Docs: Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)：`codex exec --json` 輸出 JSONL，含 thread、turn、item 與 error events。
- [OpenAI Docs: App Server](https://learn.chatgpt.com/docs/app-server)：提供 thread list、runtime status、loaded threads 與 thread／turn／item notifications；這適合由自家 client 擁有的深度整合，不能假設可無條件附著到已開啟的 Codex App。
- [OpenAI Docs: Projects and chats](https://learn.chatgpt.com/docs/projects)：建議不同 outcome 使用不同 chat；同 project 可同時包含多個 chat。

### Claude

- [Claude Code Desktop](https://code.claude.com/docs/en/desktop)：Desktop 支援 parallel sessions；每個 session 各自保存 context 與變更。Desktop Code 與 CLI 使用相同 underlying engine、共享 hooks/settings，但各自維護 session history。
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)：hook common input 包含 `session_id`、`cwd`；`SubagentStart`／`SubagentStop` 提供 `agent_id` 與 `agent_type`。
- Claude Desktop 的 Chat、Cowork、Code 是不同 surface。只有 Code 的上述 Claude Code hook 契約可直接納入 V1；其餘 surface 沒有結構化事件時只顯示 App presence。

### Gemini CLI

- [Gemini CLI hooks reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md)：提供 session、agent turn、tool、model 與 lifecycle hooks，common input 含 `session_id`。
- [Gemini CLI configuration](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md)：非互動模式支援 `--output-format stream-json`。
- [Gemini CLI subagents](https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md)：subagent 以同名 tool 委派；目前 hook reference 沒有專用 subagent lifecycle event，因此 V1 只能用該 tool 的 BeforeTool／AfterTool 表示委派區間。

### Grok CLI

- [Grok Build overview](https://docs.x.ai/build/overview)：支援 TUI、headless streaming JSON 與 ACP。
- [Grok hooks](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md)：提供 session、tool、turn、subagent 與 session-end events，common payload 含 session ID；payload 使用 camelCase。
- [Grok headless mode](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md)：`streaming-json` 為 ACP session updates 衍生的 newline-delimited JSON。
- [Grok agent mode](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md)：ACP 使用 session ID 與 `session/update` notifications。

## Phase -1 尚未通過的實機探針

1. 用不含 prompt/output 的最小 hook，證明 Codex App 與 Codex CLI 都能送出 session／turn／subagent lifecycle，並驗證 source 區分失敗時會降級。
2. 證明 Claude Desktop Code 與 Claude CLI 的 hook 可透過受信任祖先 executable path 或明確 surface marker 分流；衝突時不得猜。
3. 驗證 Gemini subagent tool 的開始／結束事件配對；不能取得的 child 內部狀態必須保持隱藏。
4. 驗證 Grok camelCase 正規化與 subagent start/stop 配對。
5. 用兩個 root session、同一 Provider 樓、多個 subagent 的 synthetic replay 驗證專案桌與 parent-child 不混桌，再請 Owner 確認顯示。
6. 為每個 surface 驗證首次 discovery、hook 缺失、一次性授權、事件重連與版本不相容時的降級行為。
