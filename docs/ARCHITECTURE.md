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

樓層只向上擴建，不做平面擴張。每個樓層標題都可獨立收合／展開；這是純顯示設定，不改變事件或任務狀態。

## 真實性分層

- Tier A：官方／相容 hook 送出的結構化生命週期事件。可顯示 session、工作輪次、subagent、請示與結束。
- Tier D：套件、PATH 與受限程序 presence 掃描。只能顯示已安裝、已開啟或未知。
- synthetic：使用者按「播放示範」後在記憶體內建立；只用於展示動畫，UI 會明示不是 live。

程序結束不等於任務完成。若事件來源斷線，活躍 session 會降為 unknown；只有結構化結束事件可標成 completed。

## 元件

- `scripts/discover.ps1`：每 30 秒、視窗可見時掃描一次受限 presence 與系統壓力。
- `scripts/relay/AIOfficeHookRelay.exe`：短生命、fail-open 的本機 hook 轉接器。
- `resources/js/domain.js`：事件正規化、去重、session／agent 關聯與 TTL 清理。
- `resources/js/resource-manager.js`：顯示模式、資源壓力等級與動畫預算。
- `resources/js/renderer.js`：固定寬度、垂直擴建的原創 Canvas 玩偶屋。
- `resources/js/native-bridge.js`：只允許內建腳本名與白名單引數的原生橋接。

## 資源生命週期

- 完整動態 16 FPS、低動態 6 FPS、重要事件 4 FPS、勿擾 1 FPS；Canvas 像素倍率最高 1.25。
- 視窗隱藏時繪圖 0 FPS，presence 掃描暫停；事件檔仍可由外部 hook 低成本追加。
- 完成的 child agent 5 分鐘後釋放；完成且未釘選的 session 30 分鐘後釋放。
- 記憶體內事件上限 500，去重索引上限 2048。
- 事件檔單檔上限 2 MiB，只保留一個輪替檔。
- CPU、記憶體、電池或影格時間升高時，主線保護會逐級降為低動態或重要事件模式。
- 本程式、WebView 與偵測子程序啟動後設為 Windows `BelowNormal`；外部 AI 主程序完全不變。
