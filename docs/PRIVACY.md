# 隱私與安全邊界

## 會讀取

- 已知 AI App 套件是否安裝。
- 已知 CLI 是否能由 PATH 找到。
- 受限程序名稱、父子關係與可執行檔位置，用於判斷 App／CLI presence。
- hook stdin 內少量生命週期欄位，轉成允許清單事件後立即結束。
- Codex Desktop 當日與前一日、近期修改 session JSONL 的有界尾端／增量位元組；只取 turn 與工具生命週期結構，不取 prompt、回覆、工具 input 或 output。
- CPU、實體記憶體與電池概況，用於自動降載。

## 不會保存

- prompt、模型回覆或對話內容。
- transcript 內容或完整 transcript 路徑。
- 完整命令列、帳號、token、API key、環境祕密。
- 完整工作目錄；只留下最後一段安全化名稱。
- 原始 session／agent ID；兩者在落盤前以 SHA-256 截短雜湊。

## 外部影響

- 程式不呼叫 LLM API，不傳送網路請求，不控制或調整任何 AI 程序優先權。
- 只把自己的 Neutralino／WebView／偵測程序設為 `BelowNormal`，讓主線工作優先。
- 安裝器與第一次啟動只自動合併 Claude、Gemini、Grok 的允許生命週期 hook。Codex Desktop 一律使用唯讀本機 session 記錄觀察器；它不寫入 Codex hook 設定、不要求或接受 hook 信任，也不使用任何信任繞過。
- hook 一律 fail-open：任何解析、寫檔或鎖定錯誤都輸出空 JSON 並以成功碼離開，不阻塞主線 AI。
- 安裝器只合併本專案 hook；既有設定會先備份。

若發現安全問題，請依 [SECURITY.md](../SECURITY.md) 私下回報，不要在公開 issue 放入真實 prompt、路徑、設定檔或事件檔。
