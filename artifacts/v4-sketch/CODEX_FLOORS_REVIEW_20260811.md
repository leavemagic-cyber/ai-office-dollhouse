# Codex 審查記錄 — D2-D6（樓層語意／機能分層／座位／完工動線／席位），2026-08-11

規格依據：`CODEX_SEATING_AND_MULTIFLOOR_SPEC_20260811.md` ＋ Owner 的兩項推翻
（保留固定主管室、開 subagent 才有自己樓層）。證據圖：`floors-after-20260811.png`、`cue-j-report.png`。

## Codex 抓到、我核對屬實並已修的 5 個真 bug

1. **單層模式所有招牌動畫失效**（最嚴重，且是既有缺陷、非本輪引入）：
   `cueAppearsOnFloor` 沒處理 `room === 'all'`，而 13 人以下預設就是單層模式 →
   Owner 平常根本看不到任何 cue。已加 `if (room === 'all') return true;`。
2. **第 13 個 team 的 cue 會誤落共用辦公層**，產生「無單獨工作」的空樓層。
   `floorForSession` 改成先在**全部** team 中找，超過 12 層上限者歸到最後一層。
3. **溢位 +N 算錯**：`population - 14` 沒有夾 0，2 人的樓層會算成 -12，把「被省略的整個團隊」
   抵銷掉。改成 `max(0, population - 12) + 被省略團隊人數`。
4. **每層容量與實際工位不符**：一層只有 12 個正式工位，卻用 `PEOPLE_PER_ANNEX = 14` 取人，
   第 13、14 人會被 `assignSeats` 塞進專注亭／huddle 椅。新增 `FLOOR_WORKSTATIONS = 12`，
   超過的人一律進 +N。
5. **`agents:[{}]`（上游沒設 isMain）會被畫成兩個人**：`occupantsForSession` 另造了一個 main。
   改成「沒有任何 agent 標 isMain 時，第一個 agent 就是 main」，與 `sessionPopulation` 一致。

另修：HQ 平面的接待席與 huddle 桌互相重疊（座位落在桌子裡）、工作樓層的置物櫃穿過專注亭牆、
完工報告路線會穿過等候椅、離場路線起點在桌子裡、同一 provider 的多個樓層 footer 會顯示同一個事件。

## 我不採納的兩點（附理由）

- **live 與 snapshot 用 sessionKey 去重**：目前「有 live pod 就整批捨棄 snapshot」是既有
  renderer 的優先序，我只是沿用。改成混合會有同一 session 被畫兩次的風險，且 snapshot 本來就
  只是「沒有 live 事件時的替代顯示」。維持現狀，列為已知限制。
- **測試「過度釘死樓層順序與中文層名」**：層名帶專案標籤、樓層順序（Owner → 各團隊 → 共用 → 大廳）
  就是 Owner 這次指定的產品行為，釘住是刻意的。

## 補上的測試

- 第 13 層溢位：cue 歸最後一層、不建立空的共用辦公層。
- 單層模式（`room = all`）必須播 J 與 owner_request。
- 家具 AABB 檢查擴大到 `meeting` 與 `lockers`，並納入單層平面 —— 這正是接待／huddle 重疊被漏掉的原因。

驗收：`npm test` 72/72、`node scripts/check-project.mjs` 綠。
Codex 在唯讀沙箱下無法產生 relay 暫存檔，只實跑了指定三套測試 30/30，其餘由本地全套補足。
