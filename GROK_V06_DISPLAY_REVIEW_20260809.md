# Grok v0.6 顯示模型反方審查紀錄

日期：2026-08-09
範圍：Provider 團隊樓層、多 session 多任務、自動偵測、身份與狀態真實性、零音效
模式：自包含 prompt、單輪、無工具、無網路、無 subagent、唯讀

## 結論

`DISPLAY_MODEL_APPROVE_WITH_GUARDS`

Grok 認為以下方向可成立：

- 同 Provider 共用團隊樓層，每個 top-level session 各自一張 SessionPod／專案桌。
- App／CLI 是桌牌來源，不是樓層、員工或任務數。
- 多任務共樓不共桌；subagent 只依可靠 parent 關係歸桌。
- 啟動可主動 discovery 與重連，但 presence 不得上推成 running／completed。
- Workstream／work_id 是可選整理標籤，不決定身份或樓層。
- 跨 Provider 協作進公共會議室，會後回原樓。
- V1 完全無 AudioContext、音訊素材、混音 timer 或背景聲道。

## 三題 verdict

1. App／CLI 偵測：分層方向正確。套件／executable 只證明 installed；主程序只證明 app_open；只有 hooks、JSONL、stream-json、ACP／app-server 等結構化事件才能建立 session、agent 與工作狀態。歷史 index／state database 只能補標題或 parent，不能證明 active。
2. 「命理＋辦公室動畫」：若是兩個 Codex top-level session，應在同一 Codex 樓形成兩張專案桌，各自只帶自己的 agent 子樹；候選範例可作 canonical。
3. App 內多 session：一個 top-level session 一桌，同 Provider 共樓不共桌；App／CLI 寫在桌牌；Electron helper 永遠不換算人口。

## MUST-FIX 與處理結果

1. 六個身份單位必須是封閉集合；附屬樓、會議室、未歸屬槽與委派區間只屬 layout／decoration。已補入 v0.6。
2. Gemini 或任何缺少穩定 agent ID／parent lifecycle 的委派，不得捏造常駐 AgentInstance 或計入容量。已補入 v0.6。
3. installed／app_open／running／waiting_owner／completed／unknown 的證據門檻不可上推。原規格已有，並再補強 presence-only 禁具體工作動畫。
4. SessionPod 不得因 Provider、cwd、標題、程序、時間或相同 work_id 自動合併。原規格已有，並補明相同 work_id 也只能建立標籤／協作關係。
5. Claude Chat／Cowork 及其他 presence-only surface 不得播放具體工作動畫。原規格已有，並提升為一般規則。

## Phase -1 建議

- 建立各 surface 的 observation matrix。
- 覆蓋 discovery、hook 缺失、授權、版本不相容、事件遺失、重連、重複事件、來源無法區分等 failure modes。
- 定義 trusted main process，排除 helper／crashpad／GPU process。
- 缺少可靠 parent 的事件進「未歸屬」視覺槽，不就近塞桌。
- Synthetic replay 驗證同樓多桌、parent-child、無 work_id、失聯 unknown、程序退出不等於完成、Gemini 委派不算人口。

## 最小畫面樹

```text
Owner 辦公室
└─ Codex 團隊樓層
   ├─ 專案桌 A：命理（Codex App，session A）
   │  └─ 僅 session A 的可靠 agent 子樹
   └─ 專案桌 B：辦公室動畫（Codex App，session B）
      └─ 僅 session B 的可靠 agent 子樹
```

審查並未授權 coding。Grok 建議五條護欄寫入顯示契約後，再由 Owner 決定是否完成顯示模型核准；Phase -1 failure-mode 產物完成前仍不得開始 collector／adapter／renderer／動畫實作。
