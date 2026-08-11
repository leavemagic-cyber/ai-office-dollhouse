你是 AI 玩偶辦公室 Stage 4 的最終唯讀證據審查者。不要呼叫工具；只依下列已執行、具體行號與產物證據，判定「筆電資源保護、自動釋放、一鍵整合／安裝、release readiness」。Stage 1–3 已 PASS，不得要求降低 2.5D 美術、改多視窗或加入設定頁。Stage 5 的逐樓美學/IP 與真實 Windows 桌面驗收尚未進行，不在本次判定。

Owner SSOT：`AI_OFFICE_DOLLHOUSE_V2_OWNER_GOAL_PLAN.md` 第 4、7.4、8、9、10、11 節。

證據：
- `resource-manager.js:3-9` 單一政策來源：完整 30 FPS、低動態 12、重要 8、勿擾 2；`resource-manager.js:17-31` 追蹤 CPU/RAM/電池、frame times、visibility、20 秒 recovery cooldown。
- `resource-manager.js:43-87` 壓力升級立即切 yellow/orange/red；解除後每個 cooldown 只退一級，避免抖動；red 強制 important，yellow/orange 強制 low，Owner 主動選的 DND/important 不被升級。
- `resource-manager.js:89-112` hidden=0 FPS，frame interval 與每樓 moving budget 由同一 effectiveMode 產生；`renderer.js` RoomRenderer tick 使用 model.frameIntervalMs，draw 前後回報實際 frame duration，important/DND 將一般 actor/furniture time 凍結但保留 signature cue。
- `main.js:174-179` 啟動即呼叫 `lowerOwnPriority()`；`set-low-priority.ps1:8-36` 只接受本程式 Neutralino/發行 exe 的 PID，遍歷自己的子程序樹並設 `BelowNormal`，不碰 Codex/Claude/Gemini/Grok。
- `domain.js:3-10` 有界策略：每 Provider 64 個詳細 SessionPod、每 pod 32 個詳細 agent、unassigned/delegation 各 128；超過詳細 agent 容量改用精確 overflowAgentCount，不把人宣稱完成。
- `domain.js:227-252,323-350` 超額 session 不建立無限物件並留下 capacity diagnostic；超額真實 spawn 只增加有界 scalar；明確 finish 會遞減；`domain.js:530-579` finished child/pod 有 TTL、unassigned/delegation LRU cap、eventLog 500、seen 2048。
- `floor-layout.js:1-30` 真實 logical annexCount 保留，但每 Provider 最多建立 12 個 Canvas；最後門牌保留 `12/N+`。`renderer.js` 以最多 84 個 `L/L+` 代表與 `+N LIVE` 真實總數牌呈現超額，不固定外部 subagent 為 3/5 人。
- `choreography.js:47-95` 全域演出 queue 24、seen retention 45 秒、active 完成即解除；`main.js:268-288` annex 移除會 stop/unobserve/remove/delete；IntersectionObserver、collapsed、document.hidden 都 stop rAF。
- `scripts/relay/AIOfficeHookRelay.cs:123-126` hook input 有 1 MiB 上限；`:179-183` 事件檔超過 2 MiB 只保留 current + events.1；PowerShell fallback 同樣在 `hook-relay.ps1:43,144-148` 限制與輪替。
- 第一版零音效；自動檢查結果 `audioAssets=0`，runtime logging=false；Canvas/演出不呼叫 LLM 或網路。
- `main.js` 的 `ensureIntegrationCoverage()` 啟動即 status，僅對缺少 Provider 執行 install；安裝腳本先備份、保留其他 hook、原子替換、冪等。Codex 自身的首次信任不被繞過。
- `install-integrations.ps1:116-141,172-224` uninstall 只過濾命令包含本專案 relay 的 hook 群組，先另存 uninstall backup，再刪專案 relay；測試確認 existing-safe-hook 完整保留。
- `install-app.ps1` 從 release package 安裝到固定 `%LOCALAPPDATA%\Programs\AI Office Dollhouse`，拒絕覆寫正在執行的精確 exe；建立桌面＋開始功能表捷徑、自動安裝四 Provider hook。`uninstall-app.ps1` 只接受該固定安裝路徑並先拒絕正在執行的精確 exe。
- `package-release.ps1:15-74` 封裝前依序 build relay、test、check、12,000-event soak、Neutralino release；包內含 cmd/ps1 安裝與移除、README/LICENSE/notices/privacy/security、scripts/docs，最後建立逐檔 SHA256SUMS 與 ZIP SHA-256。
- 實際執行 `npm.cmd run package:win` PASS：32/32 tests；68 files/16 JS check PASS；8 虛擬小時 12,000 events PASS、清理後 pod=0 agent=0、event=500；Neutralino build PASS。
- release 產物：`release/AI-Office-Dollhouse-v0.2.0-win-x64.zip`，1,273,718 bytes，SHA-256 `107184385bf4cd931fb6d51f9704e219924dcd1844dce7b2f34ca018f9a4cd48`；解壓包 27 個逐檔 SHA-256 全部重算一致；安裝 PowerShell parser 無錯誤。
- `git diff --check` 無 whitespace error，只有兩個既有 Windows LF→CRLF 提示。

請只輸出繁體中文：
1. `VERDICT: PASS` 或 `VERDICT: CHANGE`
2. 最多 7 個 findings；沒有能由上述證據指出的具體反例不得判 CHANGE
3. 核對表：正常美學保留、壓力降載/cooldown、低優先權、有界記憶體/檔案、隱藏釋放、自動整合、一鍵安裝/可逆移除、release 完整性

