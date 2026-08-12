# 架構與顯示真實性

## 資料模型

```text
Owner
├─ 每一個真實 session → Provider 隔離的獨立樓層
└─ 跨 Provider 討論 → 入口大廳
```

Owner 是永久、獨立且最大的頂層決策室，不會因沒有請示而消失，也不會合併到工作樓層。每一個有可靠生命週期證據的 session 各自擁有 Provider 隔離樓層，任何單一樓層都不混放無關 Provider。

工作樓層固定有六張獨立桌，每桌包含自己的低屏風和螢幕。單層最多顯示六人，更多人以精確 `+N` 數量摘要呈現，人偶維持原尺寸。每個 Provider 最多同時繪製十二個 session 樓層，超出的 session 與 cue 收斂到該 Provider 最後一層，不會被錯放到共用辦公層。

## 事件來源

- Tier A 是相容 hook 送出的結構化生命週期事件，可用來顯示 session、工作輪次、subagent、請示與結束
- Tier D 是套件、PATH 與受限程序 presence，只能說明工具已安裝、已開啟或狀態未知

Presence 不會生成人員，程序結束也不代表任務完成。來源中斷時，仍在畫面上的工作會降為 unknown 並停止動畫；unknown 最長保留十分鐘，過期重播不會重新開樓層，只有明確事件才能標示完成或取消。

## 顯示流程

`floorSpecsForModel(..., { activeOnly: true })` 永遠保留 Owner 頂層，只在有可靠人口或活躍討論時加入工作樓層；不會為對不上 session 的事件開出空白共用辦公層。

Canvas 提供 2:1 軸測與平面圖兩種投影。人物、家具和 cue 共用深度排序，樓層切換使用本機時間軸，不需要模型生成動畫。

Windows 上的滑鼠穿透由 `WS_EX_TRANSPARENT` 控制。狀態機只接受原生層回傳的確認結果，失敗不會被記成已恢復，隱藏、最小化、游標讀取失敗與視窗移動都會觸發清除或重新量測。

## 主要元件

- `scripts/relay/AIOfficeHookRelay.exe` 是短生命、fail-open 的本機事件轉接器
- `resources/js/discovery.js` 以有界切片讀取 NDJSON，並處理部分行、輪替與截斷
- `resources/js/domain.js` 負責事件正規化、去重、session 關聯和 TTL 清理
- `resources/js/floor-layout.js` 決定樓層語意、人口上限與 cue 目的地
- `resources/js/sketch.js` 定義辦公室、人偶和兩種投影的原創繪圖語言
- `resources/js/renderer.js` 組合場景、座位、動畫和數量摘要
- `resources/js/click-through.js` 保存原生確認過的穿透狀態
- `resources/js/native-bridge.js` 只允許固定腳本名和白名單參數

## 資源邊界

- 完整模式 30 FPS，低動態 12 FPS，只顯示重要事件 8 FPS，勿擾 2 FPS
- 隱藏、收合或離開可視範圍的 Canvas 停止繪圖
- 記憶體事件上限 500，去重索引上限 2048
- 每個 pod 最多保留 32 個具名 agent，Provider 最多保留 64 個詳細 session
- 事件檔到 2 MiB 時輪替，只保留目前檔與一個歸檔檔
- CPU、記憶體、電池或影格時間升高時立即降載，壓力解除後逐級恢復
