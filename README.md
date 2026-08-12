# AI Office Dollhouse

AI 玩偶辦公室是 Windows 桌面的唯讀懸浮視窗，它把本機 Codex、Claude、Gemini 與 Grok 的生命週期事件畫成一座原創 2.5D 辦公室，不呼叫任何模型，也不保存 prompt 或回覆內容。

![AI Office Dollhouse office floor](docs/images/overview.png)

## 它會顯示什麼

- 永久的 Owner 語意，以及真正需要決定時才出現的 Owner 樓層
- 每個帶 subagent 的 session 各自一層，沒有 subagent 的工作則進入共用辦公層
- 工作中、等待、討論、完成與取消等結構化事件，單純開著 App 不會被畫成工作中
- 每層最多六人，超出的真實人數以 `+N` 顯示，人偶不會為了塞進樓板而縮小
- 完整動態、低動態、勿擾與只顯示重要事件四種模式
- 透明置頂浮層、滑鼠穿透、DPI 感知與筆電資源壓力降載

這不是 agent 啟動器，也不會替你分派任務。它只觀察本機已存在的工作，適合想在桌面角落看狀態，又不想再開一個大型控制台的人。

## 安裝

需求是 Windows 10 或 11、Microsoft Edge WebView2 Runtime，以及已安裝的相容 AI 工具。

1. 從 GitHub Releases 下載最新的 `AI-Office-Dollhouse-*-win-x64.zip`
2. 完整解壓縮後執行 `Install-AI-Office-Dollhouse.cmd`
3. 之後從桌面或開始功能表開啟「AI 玩偶辦公室」

安裝器會把程式放到 `%LOCALAPPDATA%\Programs\AI Office Dollhouse`，建立帶有專案圖示的捷徑，接著備份並合併本專案所需的生命週期 hook。它不會覆蓋其他工具的 hook，Codex 顯示的首次信任提示仍要由使用者自己確認。

解除安裝前先關閉程式，再執行安裝目錄中的 `Uninstall-AI-Office-Dollhouse.cmd`。解除安裝會移除本專案 hook、relay、捷徑與程式目錄，本機事件資料會保留在 `%LOCALAPPDATA%\AIOfficeDollhouse`，避免更新或移除時誤刪使用中的紀錄。

## 從原始碼執行

需求是 Node.js 22 以上。

```powershell
npm.cmd ci
npm.cmd run start
```

完整驗證與 Windows 封裝：

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run test:soak
npm.cmd run package:win
```

## 隱私邊界

程式只保存雜湊後的 session 與 agent ID、Provider、事件型別、工具名稱及工作目錄最後一段。完整路徑、命令列、帳號、token、API key、prompt、模型回覆與 transcript 內容都不會落盤。

事件與設定留在本機，程式沒有模型 API 呼叫，也不會控制外部 AI 程序。詳細內容見 [隱私說明](docs/PRIVACY.md) 與 [Provider 整合](docs/INTEGRATIONS.md)。

## 專案定位

[Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) 與 [Claude Office](https://github.com/paulrobello/claude-office) 提供更完整的辦公室模擬和操作介面，本專案選擇另一條路，只做小型、唯讀、Windows 桌面常駐的觀察器。程式碼、圖像、圖示與文字均為獨立製作，沒有沿用這些專案的 sprite、版面或 README 文案。

## 文件

- [架構與顯示真實性](docs/ARCHITECTURE.md)
- [測試與效能](docs/TESTING.md)
- [Provider 整合](docs/INTEGRATIONS.md)
- [發行檢查表](docs/RELEASE_CHECKLIST.md)
- [安全政策](SECURITY.md)

## 授權與名稱

原始碼採 MIT License。Codex、Claude、Gemini 與 Grok 等名稱只用來描述相容介面，本專案不隸屬這些產品的提供者，也未獲其背書，並且不包含其 Logo、角色或其他品牌素材。
