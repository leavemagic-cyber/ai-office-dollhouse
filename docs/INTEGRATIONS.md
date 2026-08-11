# Provider 整合

## 安裝原則

Owner 選擇一鍵方案：發行包安裝器會自動備份既有設定、保留無關 hook，再以暫存檔原子合併允許的生命週期 hook。程式啟動時主動做 status 檢查，若某 Provider 缺少本專案 hook，會自動補上；重複執行不會重複加入。Codex 自身若要求第一次信任，仍由使用者在 Codex 內確認。

## 支援事件

| Provider | 設定位置 | 事件範圍 |
|---|---|---|
| Codex | `~/.codex/hooks.json`；若本機既有 nested hooks，沿用 `~/.codex/hooks/hooks.json` | SessionStart、UserPromptSubmit、Stop、SubagentStart/Stop、SessionEnd、PermissionRequest |
| Claude | `~/.claude/settings.json` | SessionStart、UserPromptSubmit、Stop、SubagentStart/Stop、SessionEnd、Notification |
| Gemini | `~/.gemini/settings.json` | SessionStart、BeforeAgent、AfterAgent、SessionEnd |
| Grok | `~/.grok/hooks/ai-office-dollhouse.json` | SessionStart、UserPromptSubmit、Stop、SubagentStart/Stop、SessionEnd、Notification |

Gemini 的 agent 區間只表示主工作輪次，不會被畫成虛構 subagent。Grok 若載入 Claude 相容 hook，轉接器以 host 環境標記阻止同一事件被誤記成 Claude。

Gemini hook 的 `timeout` 採官方定義的毫秒單位；本專案設定為 `5000`（五秒），避免把它誤當作其他 Provider 使用的秒數。見 [Gemini CLI Hooks reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md)。

## 多任務與 App／CLI

hook 提供的 `session_id` 是工作分流主鍵；同 Provider 的多個 App／CLI session 會共用團隊樓層，但分成獨立專案桌。事件沒有可靠 session 或 parent 時，不猜測歸屬，最多進入 unassigned／unknown 區。

presence 掃描能分辨已知 App／CLI 表面，但不能讀出 App 內開了幾個任務。Codex App、Claude App 的多任務只有在各 session 真的送出結構化事件時才會分桌顯示。

## 移除

關閉程式後執行安裝目錄的 `Uninstall-AI-Office-Dollhouse.cmd`。移除器逐一過濾命令中含本專案 relay 的 hook 群組，保留其他 hook，變更前另存 `*.bak_ai_office_uninstall_<timestamp>`；之後移除 relay、捷徑與固定安裝目錄。它不會用舊備份覆蓋整份新設定。`%LOCALAPPDATA%\AIOfficeDollhouse` 的本機事件／視覺狀態會刻意保留，確認不再需要時才由使用者手動刪除。
