# 測試與效能

## 自動驗證

- `npm test`：domain 關聯、同 Provider 多 session、subagent parent、事件去重、錯誤降級、TTL、presence 真實性、兩種 relay 隱私與安裝器備份／冪等。
- `npm run check`：JavaScript 語法、零音效資產／runtime、PowerShell 5.1 ASCII、安全設定與編譯 relay 存在性。
- `npm run test:soak`：12,000 個事件、8 小時虛擬時間；驗證事件、去重、agent 與 session 都維持有界並可釋放。
- `npm run build`：產生 Neutralino release bundle。

## v0.1.0 基準（2026-08-09，本機）

- 15 項測試全數通過。
- 8 小時虛擬 soak：12,000 事件約 2.8 秒；結束清理後 0 pod、0 agent，事件環形上限 500。
- presence 掃描單次約 2.3 秒 wall time，每 30 秒最多一次，視窗隱藏時停止。
- 編譯 relay 冷啟動測試約 0.13–0.20 秒；PowerShell fallback 約 0.45 秒。正常安裝優先使用編譯 relay。
- 發行版可見、完整動態閒置量測：程序樹約 201 MiB private memory（working set 約 399 MiB）；約單一核心 8.75%，在本機 12 logical processors 約為整機 0.73%。7 個程序全為 `BelowNormal`。

數值與作業系統、磁碟快取及防毒軟體有關；這些是本機快照，不是所有裝置的保證值。
