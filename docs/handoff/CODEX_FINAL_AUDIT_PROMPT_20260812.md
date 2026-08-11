# 最終審查：AI Office Dollhouse（2026-08-12 版）

你是獨立審查者。workdir 是專案根目錄。**自己讀檔與實跑，不要採信本文件的任何敘述**——
本文件列出的每一條都是「待驗證的宣稱」，你的工作是找出哪一條不成立。

## 一、先跑這三件事，回報實際結果

```
npm test
node scripts/check-project.mjs
git log --oneline -4
```

宣稱：`npm test` 77/77 全過、`check-project` 綠。若不符，直接列出失敗項。

## 二、待驗證的宣稱（逐條標 PASS / FAIL，FAIL 要給 file:line）

### A. 人偶（`resources/js/sketch.js` 的 `drawFigure` / `FIGURE` / `reach`）
1. 全身只有頭是實心，沒有封閉軀幹、沒有胸口色點。
2. 身分色只出現在腳下色條與平面圖模式的圓盤，絕不進入人體輪廓。
3. 四家 provider 的身分色相對亮度差 <= 1.15 倍。
4. `facing = -1` 時整個人偶鏡像，坐姿不會背對桌子。
5. 站/走膝角 163-177 度、坐膝 92-108 度、肘 80-172 度。

### B. 樓層語意（`resources/js/floor-layout.js`）
6. 樓層＝Owner ＋ 每個「帶 subagent 的 session」各一層 ＋ 共用辦公層 ＋ 入口大廳。
7. 判定「有沒有 subagent」用 session 人數 > 1，不依賴上游不一定會設的 `isMain`。
8. 一層最多顯示 6 人（`FLOOR_WORKSTATIONS`），超過走 `+N`，且**不縮小人偶**
   （`renderer.js` 的 `figureScale` 應恆為 1）。
9. `totalOccupants()` 依原始人數計算，不是依已被 slice 的佔位者
   （否則 10 人會回報 7，誤選單層並靜默漏人）。
10. 超過 12 層上限的 team，其 cue 落在該 provider 最後一層，不會誤落共用辦公層。

### C. 辦公室平面（`sketch.js` 的 `officeLayout` / `openPlanOffice`）
11. 開放式**獨立桌**，一人一桌共 6 張；每張桌自帶屏風（`partition: true`），
    不是一排共用一片。
12. 兩排工位的投影位置不重疊：`bank(1.9,5.0)` 與 `bank(7.0,3.95)`。
    請自己算 `screenX = 68 + (gx-gy)*6.55`、`screenY = 4 + (gx+gy)*3.275`，
    確認兩排的螢幕 x 範圍確實分開。
13. 任兩座位投影後 `|ΔscreenX| >= 6` 或 `|ΔscreenY| >= 5`；座位不落在
    desk/cabinet/lockers/meeting/sofa 的地面 AABB 內。
14. 工作樓層**沒有**主管室、沒有接待台（那兩者只在單層檢視與入口層）。
15. 家具（wall 除外）全部 `gx < 9.5 && gy < 9.5`。

### D. 滑鼠穿透（`scripts/set-click-through.ps1`、`resources/js/click-through.js`、`main.js`）
16. 游標在動畫上 → 視窗加上 `WS_EX_TRANSPARENT`；在標題列／縮放把手／視窗外 → 移除。
17. 原生呼叫連續失敗兩次會強制切回可互動（避免永久卡在穿透、連標題列都點不到）。
18. hide／minimize 之前會先清除穿透狀態。
19. 拖曳視窗之後會讓快取的螢幕矩形失效。
20. `set-click-through.ps1` 有被 `package-release.ps1` 複製進發行包，
    且 `check-project.mjs` 有一條不變式會擋住這類遺漏。

### E. 平面圖模式（`drawPlanItem`）
21. `sofa` / `meeting` / `wall` 都有對應 branch，不會整片消失。

## 三、我知道自己偏離規格的地方（請裁決可否接受，不要當成 bug 重複回報）

- 人偶全高 13.3px 而非規格的 13.0（頸隙加大到 0.95，否則實心頭與肩線黏成一坨）。
- 走路步幅 20 度而非 22-30（2:1 軸測是壓扁視角，26 度看起來像劈腿）。
- 不做像素中心對齊（畫布 2-4 倍超取樣＋非整數 CSS 縮放＋人偶連續移動）。
- 坐姿只畫近側手臂（遠臂無論放哪都會跨脊椎或撞椅背，兩種都試過）。
- 每桌屏風高 1.42 storey 純外框（高且填色的版本實測會吃掉人偶）。

## 四、我最想知道的

22. 上面哪一條宣稱**現在就是假的**？
23. 有沒有哪個失效情境會讓 overlay 永久卡住、或讓 Owner 點不到任何東西？
24. 有沒有哪個地方是「測試會過但實際會壞」的？

輸出：繁體中文，逐條 PASS/FAIL，FAIL 給 file:line 與可執行修法。總長 <= 40 行。
