# Provider 整合

## 安裝原則

程式啟動只做唯讀 status 檢查，不會自行修改外部設定。每個 Provider 的「啟用精準偵測」都需要使用者確認；安裝器會先備份既有檔案、保留無關 hook，再以暫存檔原子替換。重複執行不會重複加入本專案 hook。

## 支援事件

| Provider | 設定位置 | 事件範圍 |
|---|---|---|
| Codex | `~/.codex/hooks.json`；若本機既有 nested hooks，沿用 `~/.codex/hooks/hooks.json` | SessionStart、UserPromptSubmit、Stop、SubagentStart/Stop、SessionEnd、PermissionRequest |
| Claude | `~/.claude/settings.json` | SessionStart、UserPromptSubmit、Stop、SubagentStart/Stop、SessionEnd、Notification |
| Gemini | `~/.gemini/settings.json` | SessionStart、BeforeAgent、AfterAgent、SessionEnd |
| Grok | `~/.grok/hooks/ai-office-dollhouse.json` | SessionStart、UserPromptSubmit、Stop、SubagentStart/Stop、SessionEnd、Notification |

Gemini 的 agent 區間只表示主工作輪次，不會被畫成虛構 subagent。Grok 若載入 Claude 相容 hook，轉接器以 host 環境標記阻止同一事件被誤記成 Claude。

## 多任務與 App／CLI

hook 提供的 `session_id` 是工作分流主鍵；同 Provider 的多個 App／CLI session 會共用團隊樓層，但分成獨立專案桌。事件沒有可靠 session 或 parent 時，不猜測歸屬，最多進入 unassigned／unknown 區。

presence 掃描能分辨已知 App／CLI 表面，但不能讀出 App 內開了幾個任務。Codex App、Claude App 的多任務只有在各 session 真的送出結構化事件時才會分桌顯示。

## 移除

目前 v0.1.0 不提供一鍵移除，避免自動刪錯其他 hook。可用安裝時產生的 `*.bak_ai_office_<timestamp>` 比對後手動移除含 `AIOfficeHookRelay.exe` 的 hook 群組。不要直接用舊備份覆蓋較新的整份設定。
