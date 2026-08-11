# 架構與顯示真實性

## 核心模型

```text
Owner（永久最終權限）
  └─ Provider Team（Codex／Claude／Gemini／Grok）
       └─ Session Pod（每個頂層工作階段一張專案桌）
            ├─ Main agent（有部屬時動態顯示為 manager）
            └─ Child agents（依 parent/session 歸屬）
```

Provider 是否出現、誰是當次主管、部屬數量都不是固定名冊。沒有 Grok、Gemini 或 Claude 事件時，就不會憑空產生玩偶；同一 Provider 有多個 session 時，則在同一團隊樓內顯示多張專案桌。

樓層只做垂直擴建，不做平面擴張。人物、家具與道具採拉遠的小比例設計，單層最多十四個可見席位；八人以上以前後兩排呈現，十五人才在相同 Provider 下方加入 `1/N、2/N` 分隊。為避免極端輸入拖垮筆電，最多同時建立十二個 Canvas 分隊樓層，超出部分以 `L+` 聚合玩偶及 `+N LIVE` 真實數量牌表示，不把實際 session 限制成三人或五人。

## 微型透明浮層（Owner 修正，2026-08-10）

- 原生視窗使用 Neutralino 透明模式；Canvas 只繪製一片透視樓板、小型原創積木角色與工作道具，沒有不透明外牆、背景卡片或空白固定樓層。
- `floorSpecsForModel(..., { activeOnly: true })` 是顯示用篩選：只保留有可靠 live population、近期既有工作快照、20 秒內的重要事件、Owner 請示或活躍討論的樓層。presence／installed／歷史快照本身不會留下可見樓層。
- Owner 的治理位置永久存在於資料語意，但只有需要 Owner 時才佔可見樓板；沒有任何有效樓層時，原生視窗會隱藏且不取得焦點。
- 預設寬度為 164 CSS px（由 Windows DPI 換算到實機），由右下角細握把縮放；頂端細握把可拖曳位置。高度依目前可見樓板數自動收合，避免透明區域攔截過多桌面操作。
- 原生視窗以 `hidden: true` 啟動，只有有效樓板已繪製後才 `show()`；`useLogicalPixels: true` 讓 Windows DPI 下的原生尺寸與 CSS 尺寸一致。
- 微型浮層預設置頂以免被主工作視窗遮住，但不呼叫 `focus()`，程序也維持低優先。使用者手動最小化後不會被新事件自動復原。
- 每個 Windows 使用者只有一個浮層實例：本機資料目錄中的 PID／隨機 token 心跳鎖會阻止第二個視窗；只有 Windows 已確認原擁有程序不存在時才會回收舊鎖。
- Neutralino 6.9 沒有 Windows native click-through API，故不以 CSS `pointer-events` 假稱會把點擊交給底下程式；以窄小範圍與 active-only 隱藏降低干擾。

## 真實性分層

- Tier A：官方／相容 hook 送出的結構化生命週期事件。可顯示 session、工作輪次、subagent、請示與結束。
- Tier D：套件、PATH 與受限程序 presence 掃描。只能顯示已安裝、已開啟或未知。

程序結束不等於任務完成。若事件來源斷線，活躍 session 會降為 unknown；只有結構化結束事件可標成 completed。唯一例外是未解決的 `owner_input_required`：它會持續顯示並維持 Owner 請示，直到收到 `owner_input_received`、`task_completed` 或 `session_stopped` 等明確解除事件。歷史 Tier A 表面狀態不會維持空 annex；只有 60 秒內重新偵測且仍開啟的 Tier D presence 可以暫時凍結 unknown 人員。

## 元件

- `scripts/discover.ps1`：每 30 秒、視窗可見時掃描一次受限 presence 與系統壓力。
- `resources/js/discovery.js`：以 64 KiB 有界切片讀取本機 NDJSON 事件檔；支援部分行、輪替／截斷與 2 MiB 尾端保護，不把畸形內容送到畫面或診斷文字。
- `scripts/relay/AIOfficeHookRelay.exe`：短生命、fail-open 的本機 hook 轉接器。
- `resources/js/domain.js`：事件正規化、去重、session／agent 關聯與 TTL 清理。
- `resources/js/resource-manager.js`：顯示模式、資源壓力等級與動畫預算。
- `resources/js/renderer.js`：透明 Canvas 的原創透視樓板、微型積木角色與本機動畫。
- `resources/js/native-bridge.js`：只允許內建腳本名與白名單引數的原生橋接。
- `office-state-v2.json`：只作本機可選的共享模型；寫入先完成暫存檔，再由同一寫入佇列替換，讀者最多看到暫時不存在，不會讀到半份 JSON。

## 資源生命週期

- 正常完整模式 30 FPS、低動態 12 FPS、重要事件 8 FPS、勿擾 2 FPS；Canvas 固定 2× 內部繪圖比例，不以非等比縮放省成本。
- 視窗隱藏時繪圖 0 FPS，presence 掃描暫停；事件檔仍可由外部 hook 低成本追加。
- 完成的 child agent 5 分鐘後釋放；完成且未釘選的 session 30 分鐘後釋放。
- 記憶體內事件上限 500，去重索引上限 2048。
- 事件檔單檔上限 2 MiB，只保留一個輪替檔。
- 收件匣不會在 900 ms 輪詢中反覆整檔讀取；過大檔案只取受限尾段，單行與診斷資料也有上限。
- CPU、記憶體、電池或影格時間升高時，主線保護會立即降載；壓力解除後每 20 秒只恢復一級，避免模式抖動或瞬間搶回資源。
- 本程式、WebView 與偵測子程序啟動後設為 Windows `BelowNormal`；外部 AI 主程序完全不變。
- 每個 pod 最多保留 32 個具名詳細 agent 物件，更多真實 spawn 以數量精確的聚合 agent 表示；Provider 最多保留 64 個詳細 SessionPod。這是顯示器的有界記憶體策略，不會改動外部 AI 或宣稱被省略工作已完成。
