# 測試與效能

## 自動驗證

- `npm test`：domain 關聯、同 Provider 多 session、subagent parent、A–J 佇列、垂直 annex、極端人口聚合、壓力 cooldown、事件去重、錯誤降級、TTL、presence 真實性、Owner 請示持續性、有界 NDJSON／輪替、單一實例鎖、取消的中性終態、兩種 relay 隱私、hook 陣列與安裝／移除路徑保護。
- `npm run check`：JavaScript 語法、零音效資產／runtime、PowerShell 5.1 ASCII、安全設定與編譯 relay 存在性。
- `npm run test:soak`：12,000 個事件、8 小時虛擬時間；驗證事件、去重、agent 與 session 都維持有界並可釋放。
- `npm run build`：產生 Neutralino release bundle。

## v0.2.0 自動化基準（2026-08-10，本機）

- 56 項測試全數通過，包含 14 人單層／15 人 annex 邊界、歷史 presence 不製造空樓層、active-only 微型浮層不保留閒置 Provider／Lobby、手動最小化不會被自動顯示強制復原、Owner 請示不會 stale 消失、同 metadata 的大型事件檔輪替、短尾段後的正常 append、有界事件讀取、完整共享模型替換、單一實例恢復、取消子 agent 的中性狀態，以及安裝／解除安裝拒絕任意路徑。
- 8 小時虛擬 soak：12,000 事件在 15 秒門檻內完成；結束清理後 0 pod、0 agent，事件環形上限 500、去重索引上限 2048。
- presence 掃描單次約 2.3 秒 wall time，每 30 秒最多一次，視窗隱藏時停止。
- 編譯 relay 冷啟動測試約 0.13–0.20 秒；PowerShell fallback 約 0.45 秒。正常安裝優先使用編譯 relay。
- 2026-08-10 實機重新安裝後：透明浮層在真實桌面可見且不在前景；當時只依兩個近期 Codex 工作顯示 `Codex 1/2`（14 人）與 `Codex 2/2`（2 人），沒有 Owner、Claude、Gemini、Grok 或 Lobby 空樓層。原生視窗實測為 164×157 px。

數值與作業系統、磁碟快取及防毒軟體有關；這些是本機快照，不是所有裝置的保證值。
