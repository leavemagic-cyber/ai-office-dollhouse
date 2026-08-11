# AI Office Dollhouse — 設計與執行總表 (V5, 2026-08-11)

> 這份是**唯一的現行總表**。先前散在多份文件與對話裡的決議、Codex 諮詢結果、Owner 修正，
> 全部收攏在此。接手者只要讀這一份，就能知道「已定案什麼、已做到哪、下一步做什麼」。
>
> 相關檔案：
> - 畫風與動畫規格：`AI_OFFICE_DOLLHOUSE_V3_SKETCH_OVERLAY_STYLE_DRAFT_20260811.md`
> - Codex 家具簡化規格：`artifacts/v4-sketch/CODEX_FURNITURE_SIMPLIFICATION_SPEC_20260811.md`
> - Codex 空間規劃規格：`artifacts/v4-sketch/CODEX_SPACE_PLANNING_SPEC_20260811.md`
> - Codex 座位與多樓層規格：`artifacts/v4-sketch/CODEX_SEATING_AND_MULTIFLOOR_SPEC_20260811.md`
> - Codex 人偶造形規格：`artifacts/v4-sketch/CODEX_FIGURE_DESIGN_SPEC_20260811.md`
> - 視覺證據：`artifacts/v4-sketch/*.png`

---

## A. 產品定義（Owner 定案，最高優先）

1. **桌面常駐微型透視樓層**：貼桌面一角、透明、唯讀觀察器，顯示真實 AI CLI 工作。
2. **畫風**：建築鉛筆線稿軸測（2:1 dimetric）＋灰階淺色紙板；深淺桌布自動切換墨稿／白稿。
3. **Owner 是唯一常駐人員**（2026-08-11 Owner 明示，推翻 Codex 建議）：
   永遠在主管室座位上；**AI 完工要走去向 Owner 報告**（對應 SPEC §7 招牌動畫 J）。
4. **樓層語意**（2026-08-11 Owner 明示）：**開 subagent 才產生自己的樓層**。
   例：Claude 同時跑多個專案 → 每個帶 subagent 的專案各佔一層。
   單一工作、無 subagent → 併入單層辦公室，不另開樓層。
5. **單層「放大」的正確含義**（Owner 澄清）：是**增加可擺人的空間／席位**，
   不是把整個畫面等比放大。整體放大的實作已移除。
6. **滑鼠必須能穿過動畫**：overlay 不得干擾實際工作；只有標題列、按鈕、縮放把手可接收事件。
7. **IP 硬性禁令**（不可放寬）：無品牌 Logo／吉祥物／官方色；無 LEGO 凸粒、C 型手、圓柱頭、
   經典黃人偶、可辨識 minifigure 輪廓；不仿既有遊戲 sprite/tile；零外部素材（全程式繪製）。

---

## B. 已實作並通過驗收

| 項目 | 狀態 | 證據 |
|---|---|---|
| 線稿繪製核心 `resources/js/sketch.js`（純函式可測） | ✅ | 11 條單元測試 |
| `renderer.js` 保留 `ROOM_META`＋`RoomRenderer` 六方法契約，新增 `setPhase`/`setTheme`/`setProjection` | ✅ | 無測試 import renderer，契約未破 |
| 灰階（淺灰紙板＋石墨線，深淺桌布自動反色，桌布亮度探針 `scripts/desktop-luminance.ps1`） | ✅ | 實機截圖 |
| 樓層插入／畫出／擦除動畫（藍圖畫出 0.8s、滑入 0.4s、進場 0.3s） | ✅ | `floor-entering-frames-20260811.png` |
| 辦公室空間規劃（主管室、會議室、接待、主走道、工位島、支援帶） | ✅ | `office-space-plan-20260811.png` |
| 家具依 Codex 慣例簡化（桌／椅／螢幕／櫃／白板／OA 屏風） | ✅ | `office-conventional-simplified-20260811.png` |
| 椅子分情況：坐著不畫椅、站著保留、空位畫椅 | ✅ | 渲染時偵測座位佔用 |
| 單層／分層模式＋自動切換＋頂欄手動切換鈕 | ✅ | 實機截圖（超過容量自動分層） |
| 右下角錨定、樓層增加往上長 | ✅ | 實機量測 |
| 頂欄 icon（內嵌 SVG，零外部素材） | ✅ | 實機截圖 |
| 滑鼠穿透（樓板／畫布 `pointer-events: none`） | ✅ 已改，待實機確認 | — |
| 全方位縮放把手（八向） | ⚠️ 已改「透明像素收不到事件」的問題，**待 Owner 實測確認** | — |
| **D1 人偶重畫**（實心頭＋圓端單線骨架、身分改腳下色條） | ✅ 2026-08-11 | `figure-before/after-20260811.png`、`CODEX_FIGURE_REVIEW_20260811.md` |
| 回歸測試 70/70、`npm run check` 通過 | ✅ | 新增 3 條人偶幾何測試 |

---

## C. Codex 裁決 vs Owner 修正（衝突處以 Owner 為準）

| 議題 | Codex 建議 | 本專案採用 |
|---|---|---|
| 主管室 | 不設固定主管室，改共享專注室 | **保留主管室**（Owner 常駐，AI 要來報告）— Owner 推翻 |
| 接待席 | 不設常駐接待人偶 | 採用 Codex：接待台平時空著 |
| 分區 | 以 session／專案為主、provider 為次 | 採用 Codex |
| 入座順序 | 同 session 連續填滿一島再開下一島 | 採用 Codex |
| 容量計算 | 只算正式工位（會議椅／接待椅不算） | 採用 Codex |
| 多樓層 | 每層不得複製主管室與接待；入口層才有接待與正式會議室 | 採用 Codex，並結合 Owner 的「subagent 才開樓層」語意 |
| 人偶造形 | 移除封閉灰軀幹與胸口色點；先修比例再修線寬 | 採用 Codex（2026-08-11 已實作） |
| 坐姿遠側手臂 | 要求遠手改 (-0.6,-4.45) 以免跨過脊椎 | **不採用**：實圖顯示該座標會讓肘撞上椅背。改為四分之三視角**不畫遠臂** |
| 椅背位置 | 第一輪要求移到 -1.25 | **不採用**（會穿過軀幹），Codex 第二輪已同意撤回 |

---

## D. 待辦（依建議執行順序）

### D1. 人偶重畫 — ✅ 完成（2026-08-11，經 Codex 兩輪審查）
成果：`resources/js/sketch.js` 的 `FIGURE` 常數 ＋ `reach()`（由手的位置反解肘）＋ 重寫的
`drawFigure()`。逐項對照：
1. ✅ 比例：全高 13.3＝頭徑 2.5＋頸隙 .95＋肩至髖 3.6＋髖至地 6.25；肩寬 3.6、髖寬 1.24。
2. ✅ 移除封閉灰軀幹與胸口色點；全身只有**頭**是實心。
3. ✅ 線寬收斂成三類（脊椎 .95／四肢 .8／道具 .5），圓端圓接。
   **未做像素對齊**——畫布是 2-4 倍超取樣＋非整數 CSS 縮放，硬對齊會讓移動中的人偶抖動；
   Codex 審查同意此偏離。
4. ✅ 角度：站/走膝 163-177、坐膝 92-108、休息肘 156-158、操作肘 80-105（測試釘住）。
5. ✅ 椅背離人體 .9px；坐姿改成畫「座墊＋椅背」側視符號。
   桌邊重疊取決於座位/桌的相對位置，非人偶本身可保證，未做全面掃描。
6. ✅ 左右手臂角度刻意不對稱；未加腳端細節（13px 下會變雜訊）。
7. ✅ 身分標示改為**腳下 3.0 x 0.7 圓端色條**（規格 §3 首選）；平面圖模式改成整個圓盤上色。
   四家身分色重新取值，相對亮度差由 1.97 倍收斂到 1.10 倍。
8. ✅ 順手修掉兩個既有 bug：`facing < 0` 的雙重翻轉（坐姿會背對桌子）、
   `poseFor` 覆蓋掉行走朝向且只看 `Δgx`（斜向移動會倒著走）。
> 已知偏離與爭點的完整記錄見 `artifacts/v4-sketch/CODEX_FIGURE_REVIEW_20260811.md`。
> 視覺驗證用的實驗台在 `.visual-test/`（gitignore，`node .visual-test/serve.mjs` 後開瀏覽器）。

### D2. 樓層語意改成「subagent 才開樓層」 — ✅ 完成（2026-08-11）
- `floor-layout.js` 重寫：`sessionsForProvider` / `sessionHasSubagents`（判定＝該 session 人數 > 1，
  不倚賴上游不一定會設的 `isMain` 旗標）/ `teamSessions` / `sharedFloorSessions` / `floorForSession`。
- 樓層清單＝Owner ＋ 每個帶 subagent 的 session 一層（層名帶專案標籤）＋ **共用辦公層**（`shared`）
  ＋ 入口大廳。沒有 subagent 的單獨工作全部併入共用辦公層，不再各自佔一層。
- cue 落點跟著改：`cueAppearsOnFloor` 用 `floorForEvent` 判斷該 session 站在哪一層；
  session 已結束或本來就沒開 subagent 的事件，落在共用辦公層。
- `renderer.js` 不再用「每 14 人切一刀」取人，改成「這層＝這個 session」。
- 8 條既有測試依新語意改寫（不是刪除），另加 cue 落點測試。

### D3. 多樓層機能分層（Codex §7） — ✅ 完成
- `openPlanOffice` 分成兩種平面：`headquarters`（單層檢視＝整間公司，保留 Owner 室、接待、huddle）
  與 `work`（大樓的一層樓：3 個工位島＋huddle＋專注亭＋支援帶，**沒有主管室、沒有接待**）。
- 入口層（lobby）拿回正式會議室與訪客等候，全棟只此一處。
- 測試改成釘住「工作樓層不得有 manager／reception，且必須有 focus 亭」。

### D4. 座位政策（Codex §1/§4/§5） — ✅ 完成
- 同一 session 的人依序填滿一島才開下一島（`podIndex = floor(order / 4)`）。
- 接待席改 role `reception`，一般工作者不會被排進去；只有 `hosting` 的人才會出現在接待台
  （目前的觸發條件：Owner 有待批准事項時，大廳的第一位在場者接待）。

### D8. 一層上限 6 人（Owner 2026-08-12 裁決，取代 D6 的「增加席位」方向）
- `FLOOR_WORKSTATIONS = 6`、`SINGLE_FLOOR_CAPACITY = 7`（Owner ＋ 6）。
- 工位島 3 → **2 島 8 席**；超過 6 人一律走 `+N` 摘要。
- 連帶解掉 Codex 抓到的「用縮小人偶換席位」：`figureScale` 只在 >6 人時觸發，現在觸發不到。
- 空出來的面積改放非工位機能：休憩區（地毯＋沙發＋矮几）、飲水機、書櫃、入口門洞。
  設計依據與兩位顧問的分歧裁決見 `docs/handoff/DISCUSS_OFFICE_LAYOUT_20260812.md` Round 2。
- 新增家具 `sofa`、`cooler`；`meeting` 加 `low` 旗標當矮几；`mat` 加 `rug` 旗標（家具下不畫內框）。

### D9. 滑鼠穿透（產品規則 6） — ✅ 完成並實機證實
- 問題：CSS `pointer-events: none` 只擋網頁層，OS 視窗照樣吃掉點擊；Owner 實測連完全透明處
  也點不到。Neutralino 11.7 沒有 click-through API。
- 解法：`scripts/set-click-through.ps1` 用 `WS_EX_TRANSPARENT` 把視窗移出命中測試並回報實體
  座標；`resources/js/click-through.js` 是純函式判定（含由視窗實測寬度反推的 DPI 縮放）；
  `main.js` 每 140ms 用 `computer.getMousePosition` 輪詢，狀態改變時才呼叫一次 PowerShell。
- 實機量測（2026-08-12）：游標在動畫上 → `clickThrough=true`；標題列 / 縮放把手 / 視窗外
  → `false`。四種情況全部符合設計。
- 已知現象：關掉視窗後行程可能仍在並持有 `instance.lock`，此時下次啟動會被單一實例守衛
  擋掉並乾淨退出（exit 0）。本輪觀察到一次，尚未查根因。

### D5. 完工報告動線（Owner 定義） — ✅ 完成
- 招牌動畫 J（`task_completed` / `session_stopped`）現在畫成真的動線：
  - **Owner 樓層**：`drawOwnerReport` — 人偶抱著交付物從走道進來 → 站到 Owner 桌前報告
    （交付物出現在桌上）→ 走回去。人偶帶該 provider 的身分色條，Owner 看得出是誰來報告。
  - **來源樓層**：`drawDeliveryRun` — 完工者抱著東西走向電梯離場（電梯車廂同時上行）。
- 證據圖：`artifacts/v4-sketch/cue-j-report.png`（p=0.15／0.5／0.85 與來源樓層兩格）。

### D6. 單層增加席位（Owner 澄清的「1.5 倍」） — ✅ 完成
- 不放大畫面，改在同一畫布擴充席位：工作樓層由 2 島 → **3 島（8 → 12 個正式工位）**；
  單層檢視縮小 Owner 室、把大會議室換成 huddle，也放進第 3 島。

### D7. 收尾
- 更新 V3 畫風規格 §6.5／新增 §6.6 偏差清單 — ✅
- `npm test` 72/72、`node scripts/check-project.mjs` 全綠 — ✅
- Codex cross-review — ✅ D1 兩輪（`CODEX_FIGURE_REVIEW_20260811.md`）、D2-D6 一輪
  （`CODEX_FLOORS_REVIEW_20260811.md`，抓到 5 個真 bug，含「單層模式所有招牌動畫失效」的既有缺陷，全部已修）
- ✅ **實機確認**（`npx neu run`，2026-08-11 深夜，DPI-aware CopyFromScreen 擷取）：
  - 無工作時視窗隱藏；注入事件後自動出現。
  - 10 人 → 單層檢視（`native-floors-20260811.png`）；追加 subagent 至 16 人 → **自動分層**，
    視窗高度由 238px 長到 663px（`native-stacked-20260811.png`）。
  - 分層結果＝`titan 期貨` 團隊層 ＋ `小動畫專案` 團隊層 ＋ 共用辦公層，**名牌印專案標籤**
    （這次一併補上，原本印的是 provider 名）。
  - 視窗全透明，桌面內容透出；深色桌布正確走白稿。
  - 測試用事件檔動前已備份、事後還原（332840 bytes 完全一致），
    被污染的 `office-state-v2.json` 也讓 App 用真實事件重寫乾淨，Owner 系統未留假資料。
- ✅ **Owner 實測（2026-08-12）**：八向縮放、拖曳、頂欄按鈕、單層/分層切換全部正常；
  **滑鼠穿透當時不通** → 已依 D9 修好並實機量測證實。
- ⚠️ **家具與配置兩度被 Owner 退回**，第二輪與 Codex 正式辯論後重做（見 D8 與討論文件）。

---

## E. 技術現況備忘（接手必讀）

- **檔案編碼**：`main.js` 等含中文的原始碼，**一律用 Node 讀寫**。PowerShell 5.1 的
  `Get-Content -Raw` 會以 cp950 解碼 UTF-8 造成不可逆亂碼（本 session 已發生過一次並修復）。
- **Neutralino 單位陷阱**：`window.setSize` 用**邏輯像素**、`window.move` 用**實體像素**、
  config 的 `maxWidth/maxHeight` 依**實體像素**夾住。螢幕尺寸請用
  `scripts/screen-metrics.ps1`（同時回報邏輯／實體與 scale）。
- **透明視窗**：完全透明的像素收不到滑鼠事件（會穿透）。需要可點的元件必須有非零底色。
- **實機驗證流程**：`npx neu run` → 注入事件到
  `%LOCALAPPDATA%\AIOfficeDollhouse\events.ndjson` → 用 DPI-aware `CopyFromScreen` 擷取
  （`PrintWindow` 會因 DPI 不感知而誤裁）。**動前備份該檔，事後還原。**
- **不可動**：`floor-layout.js` 的樓層／人數語意被 8 條測試綁死；`ROOM_META` 與
  `RoomRenderer` 六方法是 `main.js` 的契約。
