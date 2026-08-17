# Changelog

## 0.3.8 - 2026-08-17

- Codex Desktop 在不接受或繞過 hook 信任時，可唯讀觀察近期 session 記錄；只保存雜湊識別與結構動作，不讀寫提示詞、回覆或工具內容。
- 已存在的 session 初次只呈現最後狀態，後續增量才依序動畫；大型 JSONL 維持 bounded tail／offset 讀取。
- 真實 live 人偶不再因沒有新指令而靜止：工作、等待、閒置、討論與休息會在原座位播放本地日常動作；特殊 A–J 動作結束後回到日常節奏。
- 封裝不再清除既有 release ZIP、archive 或視覺測試材料；安裝器可明確跳過其他 provider 的 integration 寫入，供唯讀 Codex 驗證使用。

## 0.3.5 - 2026-08-17

- 依專案人數動態配置第一層與獨立執行層，保留固定 Owner、四方會談室、執行層主管位與休息區。
- 改為低干擾灰階線稿，只以胸口小色點辨識人物；畫面不再顯示專案、樓層或角色說明文字。
- 完成人員、會談、休息與交件動線，並修正桌面捷徑喚回及動畫區原生滑鼠穿透。

## 0.3.4 - 2026-08-13

- Prevent external readers from ever observing a partial shared-model JSON file by publishing only after the prior destination has been removed.

## 0.3.3 - 2026-08-13

- 依四方設計討論收斂動作語意：一般執行固定在自己的桌前工作；回合完成後才依全域節拍播放發呆、喝水、看文件與有植物時澆花；A–J 結構事件動畫全部保留
- 修正近期快照冒充 live 人偶、交卷回桌搶位、道具鏡射、Important／DND 中途續播，以及 Owner 桌椅／螢幕對位
- 新增 512 KiB `live-events.ndjson` 即時 inbox；完整事件 ledger 繼續獨立保留，長任務跨重啟也能即時重建 running 並在 stop 後退場
- 修正 Grok SessionStart 逾時與 session end 重複 completion；官方五秒 timeout、`end_turn` only 與 terminal 防線已由真實 Grok 任務驗證
- 共享模型改用原生 `.next` 完整寫入後替換；真實 Claude 任務、413 次高頻讀取與 113 項測試均無半份 JSON
- 取消 SHA／雜湊值作為封裝核准門檻；雜湊清單與 ZIP SHA 僅保留為資訊性產物

## 0.3.2 - 2026-08-13

- 修正 Tier-D presence 去重造成的過期狀態，快照不再冒充執行中；轉接器斷線時主工作與 subagent 一律以最長十分鐘的 unknown 狀態凍結，過期重播不再永久堆積樓層
- Owner 改為永久、獨立、最大且不透明的頂層，加入咖啡、文件與休息待機動作
- 重作 G 請示、H 授權與 J 交件流程；只有明確 `task_completed` 才觸發交件
- 每個 session 使用 Provider 隔離樓層，不再混合無關 Provider
- 修正右上縮放熱區遮住關閉 X，鎖檔清理失敗不再阻止退出，並加快頂列原生互動切換避免快速點擊被透明狀態吃掉
- Codex hook 改安裝至 `~/.codex/hooks/hooks.json`，並區分已安裝與已觀測事件

## 0.3.1 - 2026-08-12

- Keep Neutralino TypeScript declarations on LF in every Windows checkout so the pinned SHA-256 verification remains reproducible in GitHub Actions

## 0.3.0 - 2026-08-12

- 重畫原創線稿人偶與 2.5D 辦公室，加入平面圖模式
- 改成 subagent session 分層，單獨工作集中到共用辦公層
- 每層固定六張獨立桌，每桌有自己的低屏風，人物維持原尺寸
- 加入 Windows 原生滑鼠穿透，並修正失敗時的假恢復風險
- 修正 Claude Code 在 Windows 經 Git Bash 執行 hook 時的路徑格式
- 加入原創應用程式圖示、執行檔圖示與捷徑圖示
- 移除被目前版本取代的階段性程式、審查檔與中間視覺產物
