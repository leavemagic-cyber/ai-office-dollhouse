# Provider 整合

## 安裝原則

發行包安裝器會先備份既有設定並保留無關 hook，再以暫存檔原子合併允許的生命週期 hook。程式啟動時也會檢查缺少的整合，重複執行不會重複加入。Codex Desktop 不會由安裝器或啟動流程自動加入 hook；它以唯讀 session 記錄觀察器運作，不要求、接受或繞過 hook 信任。

## 支援事件

| Provider | 設定位置 | 事件範圍 |
|---|---|---|
| Codex | `~/.codex/sessions`（唯讀預設）；`~/.codex/hooks.json` 僅供使用者自行信任時選用 | 唯讀 session 的 task／turn／請示／協作請求／patch 結構事件；已信任 hook 才有 SessionStart、SubagentStart/Stop 等 |
| Claude | `~/.claude/settings.json` | SessionStart、UserPromptSubmit、Stop、SubagentStart/Stop、SessionEnd、Notification |
| Gemini | `~/.gemini/settings.json` | SessionStart、BeforeAgent、AfterAgent、SessionEnd |
| Grok | `~/.grok/hooks/ai-office-dollhouse.json` | SessionStart、UserPromptSubmit、Stop、SubagentStart/Stop、SessionEnd、Notification |

Gemini 的 agent 區間只表示主工作輪次，不會被畫成虛構 subagent。Grok 若載入 Claude 相容 hook，轉接器以 host 環境標記阻止同一事件被誤記成 Claude。

Claude Code 在 Windows 會透過 Git Bash 執行 hook，因此安裝器會把 relay 寫成帶引號的 `/c/...` 路徑。這個格式由真正的 Git Bash 子程序測試覆蓋，避免 Windows 反斜線被 shell 吃掉。

Gemini hook 的 `timeout` 採官方定義的毫秒單位；本專案設定為 `5000`（五秒），避免把它誤當作其他 Provider 使用的秒數。見 [Gemini CLI Hooks reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md)。

## 多任務與 App／CLI

hook 提供的 `session_id` 是工作分流主鍵。每個 session 都進入自己的 Provider 隔離樓層；事件缺少可靠 session 或 parent 時不猜測歸屬，也不建立空白共用辦公層。

安裝成功只代表設定檔已寫入。畫面只有最近十分鐘實際收到 Tier-A 結構化事件才標成 `observed`；更早的證據標成 `observed_historical`。Codex Desktop 的本機 session 記錄一律標為 Tier-B、`local_session_record`，不會冒充 hook Tier-A，也不會把 App/CLI presence 或快照冒充正在執行。

presence 掃描能分辨已知 App／CLI 表面，但不能讀出 App 內開了幾個任務。Codex App、Claude App 的多任務只有在各 session 真的送出結構化事件時才會分桌顯示。

## 特殊動畫的跨 Provider 證據契約

choreography 不會以 provider 名稱決定是否播放。每一筆會改變特殊動畫或重要狀態的事件，都必須攜帶不含內容的 `sourceEvidence`；它描述「實際觀察到的結構事實」，不是提示詞、回覆、工具 input/output 或 session ID。`hook:*` 來自該 provider 真正送出的生命週期 hook，`session:*` 來自 Codex 的唯讀 session 記錄。兩條路徑都進入同一個 event contract。

| 畫面 | 可以立刻由真實結構事件觸發 | 不能推測的條件 |
|---|---|---|
| A 入駐 | 已確認 subagent start 的 hook；或 Codex 的 `task_started` | 一般工具呼叫不等於新 agent |
| D 失敗 | 已確認 subagent failed 的 hook；或 Codex 的 task interrupted | task 結束、取消與個別 agent 失敗不可混為一談 |
| G Owner 請示 | hook 的 permission/elicitation；或 Codex 明確 `request_user_input` | 普通 user message 不等於請示 |
| I 多人交件 | 同 provider 兩筆以上已確認 subagent finished | turn 完成不等於 subagent 交件 |
| J 交件 | hook 的 explicit task completed；或 Codex 明確 `task_complete` | Stop、session close、patch end 都不等於交件 |
| B 交接、C 討論、E 退修、F 審查通過、H 授權 | 保留給未來能產生 `orchestration:*` 直接紀錄的真實協作來源 | 委派請求、單向訊息、工具名稱、時間相鄰或文字內容都不得推論為這些關係 |

目前 Codex 的 `collaboration.followup_task`／`send_message` 只會播放較小的「委派請求」／「協作訊息」物件動作；它們不是已完成交接或多人討論。這個限制同樣適用所有 provider。沒有列入契約的來源會被 state 層拒絕，因此不會把外部寫入或測試資料偽裝成真實的大動畫。

## 移除

關閉程式後執行安裝目錄的 `Uninstall-AI-Office-Dollhouse.cmd`。移除器只過濾含本專案 relay 的 hook 群組，變更前另存 `*.bak_ai_office_uninstall_<timestamp>`，接著移除 relay、捷徑與固定安裝目錄。它不會用舊備份覆蓋新設定，`%LOCALAPPDATA%\AIOfficeDollhouse` 的本機事件與視覺狀態也會保留。
