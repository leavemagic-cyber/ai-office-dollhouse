# Grok Stage 6 — Transparent Micro Overlay Review (Read-only)

你是此專案的**唯讀最終審查者**。這是 2026-08-10 Owner 對舊版視覺作出的明確修正；舊的「大型 2.5D 玩偶屋／固定 Provider 空樓層」審查結果只屬歷史，不得拿來否決或混淆這次的新方向。

## 權限與範圍

- 僅可**讀取**下列檔案與指定截圖；不得修改、建立、刪除或格式化任何檔案，不得安裝／解除安裝，不得啟動整合 hook，不得呼叫 subagent、不得上網、不得使用或寫入 cross-session memory。
- 不要讀取 `.env`、`auth.json`、金鑰、帳號／session 檔或任何不在下列清單的敏感檔。
- 可為核對行號而唯讀開啟指定原始碼與文件；不可自行擴張成另一份產品設計。

## Owner 已核准且必須守住的新視覺契約

1. 這不是不透明的大玩偶屋或塔。它是 Windows 左緣的**極小透明透視樓層切片**：只有薄透視樓板、原創積木感小人、極小家具／道具；沒有外牆、背景卡片、固定大廳、巨大人物或品牌化造型。
2. 預設約 164 CSS px 寬，實機約工作區寬度 7%；可用頂端細握把移動、右下角細握把縮放。高度僅隨目前有用樓板收合，不能用透明空白區攔截桌面操作。
3. **只顯示有用的樓層**：可靠 live session 人口、近期既有工作快照、20 秒內重要事件、Owner 請示，或已知活躍討論。已安裝、App 開啟、歷史 presence、閒置 Provider、空 Lobby 均不能留下門牌／空樓層。Owner 的治理語意永久保留，但閒置時不得佔一層。
4. 這是唯讀、低干擾的本機觀察器；無有用樓層時原生視窗要隱藏且不可搶焦點。有工作時自動顯示。
5. 畫風要是原創、概念通用的積木玩偶，不得取用或近似可識別的 LEGO／其他品牌人偶 trade dress、sprite、音效、字型、Logo、README 文案或外部美術資產。
6. 既有工作只可依已偵測事件呈現；不可用空的 Provider／App presence 虛構忙碌人員。完整動畫仍須維持輕量、可降載，不能拖累使用者主工作。

## 僅可審查的現行檔案

- `resources/js/floor-layout.js`
- `resources/js/main.js`
- `resources/js/renderer.js`
- `resources/js/native-bridge.js`
- `resources/index.html`
- `resources/styles.css`
- `neutralino.config.json`
- `tests/floor-layout.test.mjs`
- `AI_OFFICE_DOLLHOUSE_V2_OWNER_GOAL_PLAN.md`（只以最前面的 Owner 修正為優先準則）
- `AI_OFFICE_DOLLHOUSE_DESIGN_SPEC.md`（2026-08-10 Owner 修正優先）
- `docs/ARCHITECTURE.md`
- `docs/TESTING.md`
- `artifacts/desktop-final/transparent-overlay-printwindow-20260810-1227.png`
- `artifacts/desktop-final/transparent-overlay-printwindow-zoom-20260810-1227.png`

## 已執行證據（請分清已驗證與推論）

- `cmd /c npm test`：38/38 通過；新增 active-only 回歸測試覆蓋閒置 Provider／Lobby 排除與短暫重要事件。
- `cmd /c npm run check`：通過，檢查 117 個檔案／16 個 JavaScript 檔，runtime logging 為 false。
- `scripts/package-release.ps1`：通過，內含 `test:soak`，12,000 events／8 virtual hours。
- Release ZIP 與已安裝檔的 resources/exe SHA 已比對一致；已啟動的原生視窗標題為 `AI Office Float`。
- 實機當時只有一個有效的近期 Codex 工作快照；以 `floorSpecsForModel(..., { activeOnly: true })` 直接驗證回傳只含 `codex`，而非 Owner、其他 Provider 或 Lobby。
- 實機 PrintWindow 圖顯示原生視窗約 109 x 57 physical px（164 x 約86 CSS px 的 DPI 換算），截圖可看出 Canvas 有繪製像素且背景透明、底下桌面透出。

## 審查問題

請以現在檔案與截圖回答，必須引用具體 `file:line` 或截圖證據：

1. 新程式是否**實際**滿足「透明微型透視樓板」，而非只是 CSS 名稱改了但仍渲染舊玩偶屋／不透明框？
2. `activeOnly` 規則是否真的讓閒置 Owner／Provider／Lobby 不顯示？是否有路徑會靠 presence、installed、舊歷史資料或 UI 殼把空樓層留在畫面？
3. 自動隱藏／非搶焦點顯示、移動與縮放是否可用且不會造成明顯桌面互動風險？請特別審核透明視窗的空白可點擊區、最小／最大尺寸與 DPI 風險。
4. 小人、家具、樓板的比例與可讀性，依截圖是否達到「一眼能看出在工作、但不干擾」？指出任何仍像大面板、人物過大、立體感不足或不可發現控制的問題。
5. 真實性與資源政策是否仍守住：不虛構人員、不常駐空層、無有用工作時不耗畫面／動畫、可停繪／降載？
6. 請做一次具體的 IP／美術 clean-room 檢查：是否存在可識別品牌、外部 sprite／asset／字型／Logo 或高度近似的 trade dress 風險？若沒有，不要臆測泛稱的「積木感」就是侵權。
7. 如文件中仍有舊版「固定塔／空樓層」敘述，請分清它是文件殘留還是會改變實際行為，並判斷是否該修正，不能把舊敘述當作實作要求。

## 輸出格式（繁體中文，最多 12 點）

先輸出一行：`VERDICT: PASS`、`VERDICT: CONDITIONAL PASS` 或 `VERDICT: FAIL`。

接著依嚴重度列出：

- `MUST-FIX`：會違反 Owner 視覺契約、真實性、可用性、安全／IP 或造成明顯工作干擾的項目。
- `SHOULD-FIX`：不阻擋目前實機展示，但會顯著影響觀感或可靠性的具體改善。
- `NIT`：可選改善。

最後用一行直接回答：`只顯示有用工作樓層：是／否／有條件（原因）`。

不要提出外部美術資產、品牌化角色或擴大設定頁；不要改檔。若沒有 MUST-FIX，請明確寫「無 MUST-FIX」。
