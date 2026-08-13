# 測試與效能

## 自動驗證

- `npm.cmd test` 驗證事件真實性、樓層語意、座位幾何、人偶姿勢、滑鼠穿透、hook 安裝、隱私與生命週期清理
- `npm.cmd run check` 驗證 JavaScript 語法、Neutralino 安全設定、Windows 圖示、PowerShell 5.1 相容性與發行包腳本完整性
- `npm.cmd run test:soak` 執行 12,000 個事件與 8 小時虛擬時間，確認集合維持有界並能釋放
- `npm.cmd run package:win` 會重跑測試、檢查、soak、固定版本 runtime 準備與 ZIP 必要檔案驗證；雜湊清單只作資訊輸出

## 發行基準

最新的實跑結果記錄在 [發行檢查表](RELEASE_CHECKLIST.md)。數值會受作業系統、磁碟快取與防毒軟體影響，因此效能結果只代表當次驗證，不是所有裝置的保證值。
