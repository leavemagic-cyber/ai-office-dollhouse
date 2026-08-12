# Changelog

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
