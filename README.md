# AI 玩偶辦公室

一個 Windows 筆電友善的唯讀桌面玩偶屋，把 Codex、Claude、Gemini、Grok 的本機工作生命週期畫成辦公室動畫。程式本身不呼叫任何模型、不消耗額外 token、沒有音效引擎，也不控制外部 AI 程序。

![狀態](https://img.shields.io/badge/status-v0.1.0-56b6c2) ![授權](https://img.shields.io/badge/license-MIT-9fc66d) ![平台](https://img.shields.io/badge/platform-Windows-8aa8ff)

## 特色

- 使用者是永久 Owner；可見的 AI 經理與部屬只由真實結構化事件產生。
- 同一 Provider 共用團隊樓層，每個 session 保有自己的專案桌；人多時向上擴建。
- 每層都保留工作動畫；點樓層標題即可個別收合或展開，選擇會留存。
- 啟動即偵測已安裝／已開啟的 App 與 CLI，但 presence 不會被冒充成「工作中」。
- 完整動態、低動態、勿擾、只顯示重要事件四種模式，以及 CPU／記憶體／電池自動降載。
- 隱藏視窗時停止繪圖與背景 presence 掃描；舊 agent、session 與事件會按 TTL 自動清理。
- 所有圖像由 Canvas 程式即時繪製；不含第三方 sprite、品牌 Logo、音效或字型。

## 直接執行

下載 Windows 發行包、解壓縮後雙擊 `AI-Office-Dollhouse.exe`。第一次開啟會自動完成 presence 掃描。

若要看準確的 session／subagent 動畫，在右側 Provider 卡片按「啟用精準偵測」。程式會先顯示確認對話框；同意後才會備份並合併該 Provider 的 hook 設定。Codex 另需在 `/hooks` 完成一次信任。

未啟用 hook 時，大廳只顯示「已安裝／已開啟」，不會猜測任務、上下級或完成狀態。「播放示範」產生的資料會明確標示為 synthetic，不代表 live 狀態。

## 從原始碼執行

需求：Windows 10/11、WebView2 Runtime、Node.js 22 以上。

```powershell
npm install
npm run start
```

驗證與封裝：

```powershell
npm test
npm run check
npm run test:soak
npm run package:win
```

## 資料與隱私

- 事件檔：`%LOCALAPPDATA%\AIOfficeDollhouse\events.ndjson`
- 整合轉接器：`%LOCALAPPDATA%\AIOfficeDollhouse\integration\AIOfficeHookRelay.exe`
- 設定備份：原設定旁的 `*.bak_ai_office_<timestamp>`
- 只保留雜湊 session／agent ID、Provider、事件型別、工具名稱、工作目錄最後一段等允許欄位。
- 不保存 prompt、模型回覆、transcript 路徑、完整工作路徑、命令列或帳號資料。
- 事件檔到 2 MiB 時輪替，最多保留目前檔與一個歸檔檔。

完整邊界見 [隱私說明](docs/PRIVACY.md) 與 [整合說明](docs/INTEGRATIONS.md)。

## 設計文件

- [架構與顯示真實性](docs/ARCHITECTURE.md)
- [測試與效能](docs/TESTING.md)
- [完整設計規格](AI_OFFICE_DOLLHOUSE_DESIGN_SPEC.md)
- [偵測與顯示證據](DETECTION_AND_DISPLAY_EVIDENCE_20260809.md)
- [Grok 顯示模型審查](GROK_V06_DISPLAY_REVIEW_20260809.md)

## 授權與品牌

原始碼採 MIT License。Codex、Claude、Gemini、Grok 等名稱只用來描述可選相容介面；本專案不隸屬、未獲其廠商背書，也不包含其 Logo 或素材。發表衍生版本時，請勿加入未獲授權的 sprite、音效、字型、Logo、截圖或複製其他專案文案。
