# AI 玩偶辦公室

一個 Windows 筆電友善的唯讀桌面玩偶樓，把 Codex、Claude、Gemini、Grok 的本機工作生命週期畫成原創 2.5D 辦公室動畫。程式本身不呼叫任何模型、不消耗額外 token、沒有音效引擎，也不控制外部 AI 程序。

## 特色

- 使用者是永久 Owner；可見的 AI 經理與部屬只由真實結構化事件產生。
- 只有一個靠左、約 7% 工作區寬度的透明微型浮層；只有可靠 live／近期工作／重要事件才出現，閒置 Provider、Owner、Lobby 與空門牌不顯示。
- 同一 Provider 共用團隊樓板，每個真實 session 保有自己的專案桌；人多時才插入垂直分隊。每片可見樓板都有輕量工作動畫，沒有工作時整個視窗隱藏。
- 啟動即偵測已安裝／已開啟的 App 與 CLI，但 presence 不會被冒充成「工作中」。
- 完整動態、低動態、勿擾、只顯示重要事件四種模式，以及 CPU／記憶體／電池自動降載。
- 收合、畫面外或隱藏時停止該樓 Canvas；舊 agent、session、演出與事件會依容量／TTL 自動清理。
- 所有圖像由 Canvas 程式即時繪製；不含第三方 sprite、品牌 Logo、音效或字型。

## 直接執行

下載 Windows 發行包並解壓縮，雙擊 `Install-AI-Office-Dollhouse.cmd`。安裝器會建立桌面與開始功能表捷徑、備份並合併允許的本機生命週期 hook，然後啟動程式。之後只需點「AI 玩偶辦公室」。

第一次啟動也會自動檢查缺少的整合，不需要 Provider 設定頁。發行包另包含受版本／雜湊記錄的本機快照工具；若該工具無法使用，程式會只顯示可靠 live 事件，不會阻止浮層啟動或把舊資料冒充成 live。Codex 若顯示 hook 信任提示，仍需在 Codex 內完成一次信任；這是外部工具的安全邊界，玩偶辦公室不會繞過。

若某個 Provider 沒有可用 hook，它不會佔用任何可見樓板；程式只會在本機保留受限的「已安裝／已開啟」狀態，絕不猜測任務、上下級或完成狀態。App／CLI presence 本身永遠不會生成人員。

解除安裝請先關閉程式，再從安裝目錄執行 `Uninstall-AI-Office-Dollhouse.cmd`；它只移除本專案的 hook 群組、relay、捷徑與程式目錄，保留其他 hook，並先備份有變更的設定。為避免安裝器刪除使用中的本機事件資料，`%LOCALAPPDATA%\AIOfficeDollhouse` 會保留；確認不再需要歷史視覺狀態後可自行刪除該資料夾。

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
- [V2 Owner Goal 實作方案](AI_OFFICE_DOLLHOUSE_V2_OWNER_GOAL_PLAN.md)
- [偵測與顯示證據](DETECTION_AND_DISPLAY_EVIDENCE_20260809.md)
- [Grok 顯示模型審查](GROK_V06_DISPLAY_REVIEW_20260809.md)

## 授權與品牌

原始碼採 MIT License。Codex、Claude、Gemini、Grok 等名稱只用來描述可選相容介面；本專案不隸屬、未獲其廠商背書，也不包含其 Logo 或素材。發表衍生版本時，請勿加入未獲授權的 sprite、音效、字型、Logo、截圖或複製其他專案文案。
