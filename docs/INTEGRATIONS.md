# Provider 整合

## 安裝原則

發行包安裝器會先備份既有設定並保留無關 hook，再以暫存檔原子合併允許的生命週期 hook。程式啟動時也會檢查缺少的整合，重複執行不會重複加入，Codex 要求的首次信任仍由使用者自己確認。

## 支援事件

| Provider | 設定位置 | 事件範圍 |
|---|---|---|
| Codex | `~/.codex/hooks.json` | SessionStart、UserPromptSubmit、Stop、SubagentStart/Stop、SessionEnd、PermissionRequest |
| Claude | `~/.claude/settings.json` | SessionStart、UserPromptSubmit、Stop、SubagentStart/Stop、SessionEnd、Notification |
| Gemini | `~/.gemini/settings.json` | SessionStart、BeforeAgent、AfterAgent、SessionEnd |
| Grok | `~/.grok/hooks/ai-office-dollhouse.json` | SessionStart、UserPromptSubmit、Stop、SubagentStart/Stop、SessionEnd、Notification |

Gemini 的 agent 區間只表示主工作輪次，不會被畫成虛構 subagent。Grok 若載入 Claude 相容 hook，轉接器以 host 環境標記阻止同一事件被誤記成 Claude。

Claude Code 在 Windows 會透過 Git Bash 執行 hook，因此安裝器會把 relay 寫成帶引號的 `/c/...` 路徑。這個格式由真正的 Git Bash 子程序測試覆蓋，避免 Windows 反斜線被 shell 吃掉。

Gemini hook 的 `timeout` 採官方定義的毫秒單位；本專案設定為 `5000`（五秒），避免把它誤當作其他 Provider 使用的秒數。見 [Gemini CLI Hooks reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md)。

## 多任務與 App／CLI

hook 提供的 `session_id` 是工作分流主鍵。每個 session 都進入自己的 Provider 隔離樓層；事件缺少可靠 session 或 parent 時不猜測歸屬，也不建立空白共用辦公層。

安裝成功只代表設定檔已寫入。畫面只有最近十分鐘實際收到 Tier-A 結構化事件才標成 `observed`；更早的證據標成 `observed_historical`，Codex 尚未信任 hook 時維持 `installed_unverified`，不會把 App/CLI presence 或快照冒充正在執行。

presence 掃描能分辨已知 App／CLI 表面，但不能讀出 App 內開了幾個任務。Codex App、Claude App 的多任務只有在各 session 真的送出結構化事件時才會分桌顯示。

## 移除

關閉程式後執行安裝目錄的 `Uninstall-AI-Office-Dollhouse.cmd`。移除器只過濾含本專案 relay 的 hook 群組，變更前另存 `*.bak_ai_office_uninstall_<timestamp>`，接著移除 relay、捷徑與固定安裝目錄。它不會用舊備份覆蓋新設定，`%LOCALAPPDATA%\AIOfficeDollhouse` 的本機事件與視覺狀態也會保留。
