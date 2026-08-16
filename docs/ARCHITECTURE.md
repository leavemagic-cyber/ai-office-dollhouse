# 架構與顯示真實性

## 資料模型

```text
第一層
├─ Owner
├─ 最多三個 1–2 人小專案
└─ 永久四席會談室

獨立執行層（逐專案向上增加）
├─ 一位執行時主管
├─ 最多六位工作人員
└─ 最多三位已完成工作人員留在同層休息區
```

第一層永久存在。Owner 坐前左且避開入口；小專案依序使用後左、前右、後右，空位不畫桌椅。沒有小專案時 Owner 使用較大的辦公配置。會談室固定在右側，未使用時以淡線呈現。

專案一達三人，或成為同時存在的第四個專案，就取得自己的執行層且在結束前不搬回第一層。執行層每層只放一個專案；主管位在 S3 後方偏左，六個工作位採兩列三排並向前配置。真實人數再大也不顯示 `+N`，只呈現一位主管、六位仍在工作的代表與最多三位已完成代表在右側休息。

主 AI 永遠是 APP；主管是執行時角色，Codex、Claude、Grok 或 Gemini CLI 都可能擔任。二、三、四方會談只使用事件明列的參與者與主席，與當下執行專案無關；Owner 留在辦公位等待結果。

## 事件來源

- Tier A 是相容 hook 送出的結構化生命週期事件，可用來顯示 session、工作輪次、subagent、請示與結束
- Tier D 是套件、PATH 與受限程序 presence，只能說明工具已安裝、已開啟或狀態未知

Presence 不會生成人員，程序結束也不代表任務完成。來源中斷時，仍在畫面上的工作會降為 unknown 並停止動畫；unknown 最長保留十分鐘，過期重播不會重新開樓層，只有明確事件才能標示完成或取消。

## 顯示流程

`floorSpecsForModel(..., { activeOnly: true })` 永遠保留第一層，只為已升層或超出第一層容量的真實專案建立獨立執行層；對不上 session 的事件不會憑空開樓層。

Canvas 使用 2:1 軸測小尺寸堆疊。人物、家具和 cue 共用深度排序，樓層切換使用本機時間軸，不需要模型生成動畫。畫面只保留灰階建築線稿和人物胸口小色點，不繪製專案、角色、樓層、數量或說明文字。

Windows 上的滑鼠穿透由低優先序 `AIOfficeClickThrough.exe` 守衛 `WS_EX_TRANSPARENT`。守衛每 40ms 直接讀取同一 DPI 座標系的游標與視窗位置；動畫區穿透，頂端控制列和縮放邊緣保持可操作，視窗隱藏、最小化或主程式結束時自動清除旗標並退出。

## 主要元件

- `scripts/relay/AIOfficeHookRelay.exe` 是短生命、fail-open 的本機事件轉接器
- `scripts/click-through/AIOfficeClickThrough.exe` 是跟隨主程式生命週期的低優先序滑鼠穿透守衛
- `resources/js/discovery.js` 以有界切片讀取 NDJSON，並處理部分行、輪替與截斷
- `resources/js/domain.js` 負責事件正規化、去重、session 關聯和 TTL 清理
- `resources/js/floor-layout.js` 決定樓層語意、人口上限與 cue 目的地
- `resources/js/sketch.js` 定義辦公室、人偶和兩種投影的原創繪圖語言
- `resources/js/renderer.js` 組合場景、座位、動畫和數量摘要
- `resources/js/native-bridge.js` 只允許固定腳本名和白名單參數

## 資源邊界

- 完整模式 30 FPS，低動態 12 FPS，只顯示重要事件 8 FPS，勿擾 2 FPS
- 隱藏、收合或離開可視範圍的 Canvas 停止繪圖
- 記憶體事件上限 500，去重索引上限 2048
- 每個 pod 最多保留 32 個具名 agent，Provider 最多保留 64 個詳細 session
- 事件檔到 2 MiB 時輪替，只保留目前檔與一個歸檔檔
- CPU、記憶體、電池或影格時間升高時立即降載，壓力解除後逐級恢復
