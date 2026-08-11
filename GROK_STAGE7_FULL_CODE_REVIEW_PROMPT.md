# Grok Stage 7 — Full Project Code Review (Read-only)

你是 AI 玩偶辦公室的**全程式碼唯讀審查者**。請實際逐一閱讀本提示列出的所有本專案自寫可執行碼，做一次完整、保守、證據導向的 code review。

## 嚴格權限

- 僅可讀取下列檔案與為確認其存在而執行的唯讀列檔／搜尋；不得修改、建立、刪除、格式化、安裝、解除安裝、啟動應用、執行 build/test/soak、改 hooks、讀取帳號、token、`.env`、`auth.json`、實際事件檔、shared model、session、prompt 或 transcript。
- 不得使用網路、subagent 或 cross-session memory。
- 不得把任何發現直接修掉；只回報。
- 不得擴張到 `node_modules/`、`release/`、`dist/`、`artifacts/`、二進位檔或生成 ZIP。`resources/js/neutralino.js` 是 Neutralino 6.9 的壓縮第三方 client；只可確認本專案沒有修改／誤用它，不審核上游 minified 原始碼。

## 必讀的本專案程式碼

### Runtime UI / domain

- `resources/index.html`
- `resources/styles.css`
- `resources/js/choreography.js`
- `resources/js/discovery.js`
- `resources/js/domain.js`
- `resources/js/floor-layout.js`
- `resources/js/main.js`
- `resources/js/native-bridge.js`
- `resources/js/renderer.js`
- `resources/js/resource-manager.js`
- `resources/js/neutralino.d.ts`（API 型別與實際使用的對照；不是上游安全審計）

### Runtime/build configuration

- `neutralino.config.json`
- `package.json`

### Local discovery, relay, lifecycle, installer and packaging code

- `scripts/build-relay.ps1`
- `scripts/check-project.mjs`
- `scripts/discover.ps1`
- `scripts/hook-relay.ps1`
- `scripts/Install-AI-Office-Dollhouse.cmd`
- `scripts/install-app.ps1`
- `scripts/install-integrations.ps1`
- `scripts/package-release.ps1`
- `scripts/relay/AIOfficeHookRelay.cs`
- `scripts/set-low-priority.ps1`
- `scripts/snapshot-work.mjs`
- `scripts/soak-test.mjs`
- `scripts/Uninstall-AI-Office-Dollhouse.cmd`
- `scripts/uninstall-app.ps1`

### Tests

- `tests/choreography.test.mjs`
- `tests/domain.test.mjs`
- `tests/floor-layout.test.mjs`
- `tests/native-bridge.test.mjs`
- `tests/resource-manager.test.mjs`
- `tests/scripts.test.mjs`

### Contract documents to read only for intended boundaries

- `README.md`
- `CONTRIBUTING.md`
- `docs/ARCHITECTURE.md`
- `docs/INTEGRATIONS.md`
- `docs/PRIVACY.md`
- `docs/TESTING.md`
- `SECURITY.md`
- `AI_OFFICE_DOLLHOUSE_V2_OWNER_GOAL_PLAN.md`（第 0 節為現行 Owner 視覺／顯示優先契約）
- `AI_OFFICE_DOLLHOUSE_DESIGN_SPEC.md`（第 0 節優先）

先用唯讀檔案清單確認沒有漏掉另一個**本專案自寫** `.js`／`.mjs`／`.ps1`／`.cs`／`.cmd`。如有，需列入審查；若是生成物或第三方，寫明排除理由。

## 現行 Owner 契約與已驗證基線

- 這是唯讀本機觀察器；不得控制外部 AI、捏造 session／agent／完成狀態、讀取 raw prompt 或 transcript。
- 透明微型透視樓板只有可靠 live、近期既有工作、短暫重要事件、Owner 請示或明確討論才顯示；idle Provider／Owner／Lobby／presence-only 不能留下可見空樓。
- 視窗在無有用工作時隱藏；有工作時必須可見但不應搶焦點。它目前預設置頂、使用低程序優先、允許移動和 DPI-aware 縮放；使用者手動最小化不得被新事件強制復原。
- 不得含第三方 sprite、音效、Logo、品牌角色 trade dress、外部字型或拷貝文字。
- 目前 Neutralino 6.9 沒有 Windows native click-through API；不可把 CSS `pointer-events` 當成會把點擊交給底層程式的假解法。
- 最近一次完整驗證：`npm test` 40/40，`npm run check` 通過，12,000 events／8 virtual hours soak 通過；最終安裝版已在真實桌面顯示兩個真實 Codex 垂直 annex（14 + 2 人），且不在前景。這些是既有證據，不取代你對程式碼的審查。

## 必審題目

1. 資料真實性：事件正規化、TTL、stale／presence、session／agent parent-child、快照是否可能憑空造人、造任務或錯誤完成工作？
2. 隱私與安全：hook 資料最小化、allowlist、命令組裝／注入、路徑處理、PowerShell、C# relay、安裝／解除安裝 scope、ACL／備份／權限、Native API allowlist 是否有實際可利用的風險？
3. Windows 行為：hidden／show／minimize／focus／always-on-top、DPI、透明視窗、低優先、拖曳／縮放、資源回收及 race condition。
4. 資源與可靠性：timer、requestAnimationFrame、observer、listener、watcher、文件／事件佇列、鎖定、重複 hook、長時間運作、錯誤恢復與多次啟動。
5. 安裝與封裝：release 是否可重現、安裝器是否只寫入預期範圍、更新時是否不會破壞其他 hook／設定、解除安裝是否可逆且不擴張刪除範圍。
6. 測試：測試是否真的覆蓋高風險實作，是否存在會讓 40/40 仍漏掉的具體漏洞。
7. 可維護性：dead code、文件與 runtime 矛盾、過度複雜或導致後續誤改的危險點。NIT 與安全／真實性問題要分開。

## 輸出格式（繁體中文）

第一行必須是：`VERDICT: PASS`、`VERDICT: CONDITIONAL PASS` 或 `VERDICT: FAIL`。

接著最多 20 個發現，依序分為：

- `MUST-FIX`：可造成安全／隱私／資料真實性違反、意外寫刪範圍、明確 Windows 破壞性行為或重大可靠性缺陷。
- `SHOULD-FIX`：不一定阻擋現在版本，但有具體錯誤、race、資源／DPI／安裝風險或明顯測試缺口。
- `NIT`：不影響 Owner 契約的維護性改善。

每個發現必須有：嚴重度、`file:line`、最小可重現路徑或精確理由、修正方向。不要只列泛泛的最佳實務。

最後附上：

1. `已閱讀程式碼檔案：N`（列出全部相對路徑）
2. `排除檔案：...`（含理由）
3. `高風險未驗證項：...`（若沒有，寫無）
4. `Owner 契約是否被程式碼守住：是／否／有條件`，逐項簡短說明 active-only、唯讀／隱私、低干擾、clean-room。
