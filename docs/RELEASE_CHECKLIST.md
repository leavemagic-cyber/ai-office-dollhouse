# 0.3.1 發行檢查表

日期：2026-08-12

CI 修補：`resources/js/neutralino.d.ts` 已固定使用 LF，避免 Windows runner 自動轉成 CRLF 後造成錯誤的雜湊失敗。

1. PASS　人偶只有頭部實心，軀幹與四肢維持開放線條
2. PASS　身分色只在腳下色條和平面圖圓盤出現
3. PASS　四個 Provider 身分色相對亮度比為 1.104
4. PASS　`facing = -1` 會鏡像整個人偶
5. PASS　站姿、走姿、坐姿與手肘角度由幾何測試覆蓋
6. PASS　樓層由 Owner、subagent session、共用辦公層與入口大廳組成
7. PASS　subagent 判定依 session 人數，不依賴 `isMain`
8. PASS　單層最多六人，更多人使用 `+N`，`figureScale` 固定為 1
9. PASS　`totalOccupants()` 依原始 session 人數計算
10. PASS　超過十二層的 cue 收斂到該 Provider 最後一層
11. PASS　工作樓層固定六張獨立桌，每桌有自己的低屏風
12. PASS　兩排桌位的投影 x 範圍分離
13. PASS　座位投影間距與家具碰撞由測試逐一驗證
14. PASS　工作樓層沒有 Owner 室或接待台
15. PASS　牆以外的家具都在樓板安全範圍內
16. PASS　動畫區穿透，標題列、縮放把手與視窗外維持可互動
17. FAIL→FIX　舊版把 JS 狀態設為 false 卻沒有原生確認，新 guard 只接受 OS 回傳並持續重試
18. PASS　隱藏與最小化前會清除穿透狀態
19. PASS　視窗移動後會讓快取矩形失效
20. PASS　發行包包含穿透腳本，專案檢查會阻止漏包
21. PASS　平面圖能繪製 sofa、meeting 與 wall

另外修正三個提示未涵蓋的問題：四人團隊曾只有三張工作桌、Claude hook 的 Windows 路徑曾被 Bash 吃掉反斜線、程式與捷徑曾使用 Neutralino 預設圖示。

最終驗證為 79/79 項測試通過，專案檢查涵蓋 63 個檔案與 22 個 JavaScript 檔，8 小時虛擬 soak 共處理 12,000 個事件，發行包內 28 個檔案均通過逐檔 SHA-256 與解壓複驗。
