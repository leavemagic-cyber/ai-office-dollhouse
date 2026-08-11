# AI 玩偶辦公室：完整設計規格

版本：Concept Spec v0.6 Candidate（Provider 團隊樓層與多任務工作區修正版）
日期：2026-08-10
狀態：v0.2.0 已實作；2026-08-10 Owner 微型透明浮層修正優先於舊版玩偶屋敘述

## 0. 最新 Owner 視覺契約（2026-08-10，優先）

- 顯示為桌面左緣的微型透明透視樓板，不是有外牆的玩偶屋；背景保持透明，工作內容可從後方穿透。
- 預設只有約 7% 工作區寬度，頂端可拖曳、右下可縮放；高度只隨目前真正可見的工作樓板增加。
- 閒置、已安裝、單純 App presence、沒有可靠近期工作資料的 Provider，以及空 Lobby 全部不顯示；Owner 只在請示／重要 Owner 事件時出現。
- 每片保留原創小積木角色、透視樓板與極小工作／走動動畫；不使用外部素材、品牌角色或空白背景卡片。
- 本節優先於後文所有固定塔、固定／收合空樓、常駐 Lobby、空門牌、sprite 或大型玩偶敘述；那些內容僅保留為歷史脈絡，不能作為目前驗收或 runtime 行為。
- 目前 Neutralino Windows Runtime 沒有 native click-through API。透明區不得用 CSS 假裝穿透；以 active-only、緊湊尺寸、啟動隱藏與尊重手動最小化減少桌面干擾。
- 透明微型視窗預設為 always-on-top，否則會被主要工作視窗遮住；此行為不要求 focus，且程序仍採低優先資源政策。

## 1. 產品願景

製作一個常駐於 Windows 筆電桌面的低解析度側視玩偶屋，以原創玩偶與辦公室動畫，忠實呈現 Codex、Claude、Gemini、Grok 及其他 AI 工作階段的實際狀態。

它是「唯讀觀察器」，不是另一套 AI 控制平台。使用者仍在原本的 Codex、CLI 或其他工作介面下達指令；玩偶辦公室只接收本機事件並播放動畫，不擅自派工、批准、停止或改變任何 agent。

核心體驗：

- 擺在桌面上即可看見 AI 們工作、研究、討論、走動、敲門與報告。
- 動畫本身完全由本機程式播放，不額外呼叫 LLM，也不額外消耗 token。
- 所有可見樓層都保有真實狀態與工作微動畫；跨樓層走動、施工、交接等大型演出採全域動畫預算，避免筆電負擔失控。
- 建築固定寬度、垂直擴張。人數增加時以新增樓層呈現，不橫向長成巨大畫布。
- 視覺與素材採 clean-room 原創，不複製現有相似專案。

## 2. 已確認的產品決定

### 2.1 使用方式

- 唯讀顯示實際工作狀態。
- 桌面角落常駐，可調整大小、位置、縮放與置頂狀態。
- 辦公室可以比一般桌面寵物大，但必須有筆電友善的效能模式。
- 畫面採側面剖開的低解析度玩偶屋。
- 辦公室 UI 只控制視覺、隱私遮罩、員工名冊與版面；派工、停止、批准、指定討論及 delegated decision 等工作權限操作仍在原始 AI 工作介面完成。
- 金色鑰匙、授權卡、交接夾板與 Owner 核准都是事件的視覺結果，不是可點擊的執行按鈕。

### 2.2 Owner 與權限

- 使用者是永久 Owner，擁有不可被 AI 取代的位置與最終主導權。
- Owner 有可自訂玩偶與永久辦公室；閒置時可喝咖啡、看文件或打瞌睡。
- Owner 可以指定哪些 AI／agent 參與討論，以及由誰主持、審查、提出反例或報告。
- Owner 可以明確授權某個 AI 群組在該次事項中自行討論並作成決定。
- 未得到明確授權時，重要決定一律回到 Owner 請示。
- 即使獲得 delegated decision authority，該群組仍須把決定紀錄送到 Owner 收件匣。

### 2.3 動態人員與職級

Provider、職務、上下級與主導權是四個不同維度：

- Provider：Codex、Claude、Gemini、Grok 或其他工具。
- 職務：研究、實作、測試、審查、反方檢驗、報告等，可隨任務改變。
- 上下級：由實際 parent-child／spawn 關係決定，不由 AI 品牌決定。
- Acting lead：目前跨團隊協調該任務的暫時角色，以金色夾板與主管燈表示。

規則：

- 任何主 agent 只要實際產生下屬，就成為該工作階段的經理。
- 每位經理可有 0 到 N 位 subagent，沒有固定上限。
- Codex、Claude 可能各自帶大量 subagent。
- Gemini、Grok 可能單獨工作、成為臨時顧問、帶隊，或完全沒有出現。
- App、CLI、Provider、session 與使用者任務是不同概念；一個 App 程序可同時承載多個互不相干的 session。
- 同 Provider 的 session 優先共用一個團隊樓層；App 與 CLI 可在同樓並行，來源以桌牌區分。
- 樓層共用不等於任務合併。每個 top-level session 擁有獨立的專案桌／工作小組，subagent 只跟隨實際 parent session。
- 同一 Provider 同時處理兩個任務時，畫面上可出現兩個不同的 session 帶隊玩偶；它們在同一團隊樓層工作，但各有自己的工作標籤、部屬與生命週期。
- Subagent 若再產生下屬，可暫時成為小組長。
- Manager 一旦在該 session 產生過下屬，manager 身分保留到該 session 結束；不因最後一位 subagent 剛離場就立刻降級或搬樓。
- 已設定但暫時沒工作的 AI 可以在自己的席位睡覺。
- 未設定、不可用或從未出勤的 AI 不必出現。

### 2.4 玩偶風格

- 使用混合玩具世界：原創人型積木、小機器人、動物玩偶、辦公室人偶等。
- 所有角色共享相同像素比例、輪廓粗細、陰影方向與辦公室色盤。
- 玩偶外觀綁定「員工名冊」，不永久綁定 Provider 或固定職務。
- 未指定角色可從原創角色庫隨機產生。
- Provider 僅以純文字名牌或狀態欄辨識，不使用公司 Logo 或吉祥物。
- 職務以可替換配件表示，例如金色夾板、紅筆、放大鏡、書本、工具箱。

## 3. 組織模型

### 3.0 六個不可混用的身份單位

1. `RuntimeSurface`：Codex App、Codex CLI、Claude Desktop Code、Claude CLI、Gemini CLI、Grok CLI 等工作介面。
2. `RuntimeProcess`：Windows 程序，只用於判斷安裝、開啟、退出或異常斷線，不代表任務數量。
3. `SessionInstance`：有穩定 thread／session ID 的一次對話或工作階段。
4. `ProviderTeam`：Codex、Claude、Gemini、Grok 等團隊，是動態樓層的主要單位；不是單一程序或單一員工。
5. `SessionPod`：團隊樓層內的一張專案桌／工作小組，以 top-level session ID 區分多任務。
6. `AgentInstance`：session 內的主 agent、subagent 或 sub-lead，以來源提供的 `agent_id` 與 parent-child 關係識別。

`Workstream`／`work_id` 保留為可選的整理標籤，只用於把數個 session 標成同一案件、篩選或安排跨團隊會議；沒有 `work_id` 也能正確顯示，不以它決定是否建立樓層。

以上六類是身份模型的封閉集合。附屬樓層、公共會議室、未歸屬槽、任務卡與委派動畫都只是 layout 或短暫 decoration，不得另建成可計數的員工／session／team 身份。

程序數、視窗數、分頁數、session 數、任務數與 agent 數都可能不同，任何 adapter 都不得互相代替計數。

### 3.1 角色類型

1. Owner：唯一永久最高權限位置。
2. Acting lead：由實際任務流程決定的暫時總召。
3. Manager：擁有一個或多個實際 subagent 的主 agent。
4. Specialist：沒有部屬、獨立研究或審查的 agent。
5. Subagent：由 parent agent 產生的臨時或常備部屬。
6. Sub-lead：產生自己下屬的 subagent。
7. Reviewer／Researcher／Tester：當前工作角色，不是永久職級。

### 3.2 員工名冊

- 可為常用 agent 與常備 subagent 定義名稱、玩偶外觀、服裝與偏好座位。
- 臨時 subagent 可自動取得新玩偶、臨時名字與任務配件。
- Session 結束後，臨時員工離場；常備員工可在下次匹配到相同 profile 時再次出現。
- 實際 session ID 與畫面身份分離，避免把 Provider 誤當成單一永久人物。
- 常備角色以使用者建立的 `profile_id` 為穩定鍵；臨時角色以 `agent_id + session_id` 為生命週期鍵，不以顯示名稱猜測身份。

## 4. 垂直玩偶屋與樓層規則

### 4.1 固定寬度、垂直擴張

- 建築寬度保持固定。
- 某 Provider 首次出現可靠 session 事件時，向上插入該 Provider 的團隊樓層。
- 同 Provider 的 App／CLI session 優先共用團隊樓層；只有人數或專案桌超過單層可讀容量時，才建立同團隊附屬樓層。
- 建議初始視覺門檻：每層約 2 位主 agent／經理加 8 位 subagent。
- 此門檻只是畫面配置門檻，不是 agent 數量限制。
- 不同 Provider 不混住團隊樓層。若共同參與一件工作，角色經明確 handoff／correlation 事件前往公共會議室；結束後回到各自團隊樓層。

### 4.2 固定樓層

- 頂樓：Owner 辦公室、請示等候區、Owner 收件匣。
- 決策層：跨團隊會議室、審查室、授權會議室。
- 動態團隊層：依目前有可靠 session 的 Provider 建立、收合與休眠；每層可容納多個 SessionPod。
- 公共工作層：研究室、測試工坊、印刷室、伺服器區。
- 一樓：大廳、電梯、休息區、訪客登記。
- 新的動態團隊層一律插入「決策層下方、公共工作層上方」，確保 Owner 與大廳位置語意穩定。
- 角色在同一時間只能位於一個樓層；前往研究室、測試工坊或會議室時，原座位顯示「外出」牌，不複製第二個玩偶。

### 4.3 樓層與工作小組建立規則

- 收到可靠的 top-level session 事件時，建立或喚醒該 `provider` 的團隊樓層，並以 `session_id` 建立一個 SessionPod。
- 新 session 不需要 Owner 先分類任務；安全化的 session title 只做專案桌標籤，未知時顯示「未命名工作」。
- 同 Provider 的新 session 優先加入現有團隊樓層，但絕不與舊 SessionPod 合併；App／CLI／Desktop 等來源寫在各自桌牌。
- Subagent 只依可靠 `parent_agent_id`／`parent_session_id` 進入所屬 SessionPod，不能因 Provider 相同就隨機分配。
- 收到 agent／tool 事件但缺少可靠 parent 時，先放在該 Provider 樓的「未歸屬」視覺槽並標示 unknown；事件補齊後再歸桌，不得就近吸附。
- 單層過度擁擠時插入同 Provider 的附屬樓層，門牌顯示例如「Codex 1/2」「Codex 2/2」。
- 團隊暫時沒有活動 session 時先關燈休眠；保留多久由本機版面設定決定，不因其中一個 session 結束就立即拆除。
- 完全閒置一段時間後標示為「待整理」，再執行收樓動畫。
- Owner 可釘選喜愛的樓層，使其永久保留。

### 4.4 Provider、App 與 CLI 的畫面位置

- Provider 是團隊樓層；App／CLI 不是樓層，也不是單一玩偶，而是每個 `SessionInstance` 的來源桌牌。
- 大廳可顯示很小的「已安裝／App 已開啟／來源未連線」狀態牌，但 Electron helper 程序數不得轉成員工數。
- 角色名牌可寫「Codex · App」「Codex · CLI」「Claude · Desktop Code」「Claude · CLI」；若來源無法可靠區分，就只寫「Codex · 來源未確認」，不可猜測。
- 同一 App 內兩個同時運行的 session，在同一 Provider 團隊樓層形成兩個 SessionPod，各有一位帶隊玩偶與自己的部屬；這不是把一個玩偶複製，而是兩個真實 session instance。
- Claude Desktop 的 Chat、Cowork、Code 是不同 surface。V1 只把能取得結構化事件的 Code session 畫成工作角色；Chat／Cowork 若只有程序存在訊號，只顯示大廳狀態牌，不播放具體工作動畫。

### 4.5 「命理＋辦公室動畫」靜態顯示測例

此例是顯示契約，不是未經事件驗證的 live-state 宣稱：

```text
Owner 辦公室
└─ Codex 團隊樓層
   ├─ 專案桌 A：命理（Codex · App，session A）
   │  └─ session A 實際產生的 subagent 只在 A 桌工作
   └─ 專案桌 B：辦公室動畫（Codex · App，session B）
      └─ session B 實際產生的 subagent 只在 B 桌工作

Claude／Grok 團隊若參與 review，保留自己的團隊樓層；有明確 correlation 時，指定角色到公共會議室與 B 桌代表討論。
```

畫面可以在同一 Codex 樓同時有兩個帶隊玩偶，因為 session A 與 B 是不同 `AgentInstance`。大廳仍只顯示一張「Codex App 已開啟」狀態牌，不把 App helper 程序或單一 App 圖示當成第三個員工。

## 5. 擴建動畫

擴建必須是產品招牌動畫，而不是瞬間增加一塊畫面。

### 5.1 新樓層施工流程

1. 大廳出現「部門擴編」小告示。
2. 電梯旁亮起施工燈，原創工程玩偶推工具車進場。
3. 工程人員拉起警示帶，展開藍圖。
4. 玩具吊車從畫面邊緣吊入預製樓層模組。
5. 新樓層在既有樓層間滑入並鎖定；整棟樓只做極小幅度的彈性反應。
6. 電梯軌道向上延伸，電纜與燈光逐段接通。
7. 門牌、部門旗幟與工作桌被安裝。
8. 經理做簡短剪綵；新 subagent 抱著紙箱搭電梯進駐。
9. 工程玩偶收走警示帶，樓層正式進入工作狀態。

可重用的低成本玩具細節：

- 大廳印表機吐出新樓層門牌貼紙。
- 預製模組顯示原創「此面朝上」箭頭，吊入時短暫旋轉校正。
- 電梯貼上「施工中」小牌，跨層角色暫以簡短淡入換層。
- 新樓層燈光依序測試一次，不持續閃爍。
- 剪綵使用玩具安全剪刀與便利貼緞帶。
- 第一次同類型擴建播放完整版本；之後可由使用者選擇完整、簡短或略過。

### 5.2 效能與模式差異

- 完整動態：播放上述完整施工過程。
- 低動態：以藍圖淡入、樓層滑入、燈光亮起三段完成。
- 勿擾：無聲播放，不搶鏡頭。
- 只顯示重要事件：擴建仍屬重要事件，但縮短施工時間。
- 擴建動畫為本機固定腳本，不呼叫模型。

### 5.3 收樓動畫

- 確認樓層無工作中角色後才允許整理。
- 員工先收拾文件、搬走紙箱並搭電梯離開。
- 工程玩偶關閉燈光、拆下門牌、封存樓層狀態。
- 樓層縮成一張歸檔卡送往檔案室，再從建築中收起。
- 不補播所有離線期間的動畫，也不移動仍在工作的角色。

## 6. 全樓可見、逐層控制

### 6.1 顯示方式

- 主視圖是完整垂直建築剖面。
- 所有目前可見且展開的樓層都能同時播放工作動畫。
- 建築過高時可整體縮放或垂直捲動。
- 使用者可以固定某些樓層，也可依專案、團隊或 Provider 篩選。
- 每個可見樓層至少保留一項廉價、可讀的工作微動畫，例如鍵盤、書頁、狀態燈或座位姿態；不要求每個玩偶同時走動。
- 全域同時位移的角色數由動畫預算限制；P0–P2 大型演出排入單一招牌動畫佇列，不遺失但可以依序播放。

### 6.2 每層控制

- 顯示／隱藏。
- 展開／收合。
- 固定顯示。
- 該層環境音開關。
- 完整動畫／低動態。

收合後顯示狀態橫條，例如：

```text
Codex 團隊  ● 工作中  2 Managers  8 Subagents  ⚠ 1 件待處理
```

收合或隱藏樓層停止繪圖，只保留事件與最新狀態；再次展開時直接顯示當前狀態，不補播已錯過的走路動畫。

## 7. 核心動畫庫

第一版保留全部十組招牌動畫：

### A. 指派 subagent

經理按桌鈴，電梯開門；新部屬進場領取任務資料夾。

### B. Acting lead 交接

前任 acting lead 將金色夾板像接力棒一樣交給下一位，主管燈同步移動。

### C. 跨團隊討論

不同樓層的指定角色抱著文件搭電梯集合，會議室門牌亮起。

### D. 發現程式錯誤

文件裡跳出原創小蟲，審查者用玻璃罐捕捉；不固定由任何 Provider 扮演審查者。

### E. 要求修改

文件蓋上橘色 `REVISE` 印章，沿傳送帶或由信差退回原作者。

### F. 審查通過

文件蓋上綠色印章並綁上緞帶，送回經理或 acting lead。

### G. 向 Owner 請示

角色依事件嚴重度拿不同顏色公事包，上樓敲門三下並在等候區排隊。

### H. Owner 授權群組決定

Owner 把金色鑰匙或授權卡交給指定群組；會議室掛上「已授權」牌。群組可依授權決定並繼續，但須送交決定紀錄。

### I. 多名 subagent 同時交件

多人抱文件奔向經理桌，差點相撞後重新排隊；低動態模式改成依序淡入。

### J. 最終完成

成果依「部屬 → 經理 → acting lead → Owner」逐層傳遞，最後進入 Owner 成果收件匣。

## 8. 其他工作與日常動畫

### 8.1 工作動畫

- 研究：進入圖書室，拉書、展開地圖或轉動地球儀。
- 網路搜尋：使用望遠鏡／索引卡，不呈現或暗示隱藏思考。
- 寫程式：鍵盤與螢幕低頻閃動，紙帶送入電腦。
- 測試：玩具車進入測試軌道，抵達綠旗或停在紅旗。
- Git branch／merge：原創分枝樹與合併工作桌。
- Merge conflict：兩份不同顏色紙片在合併桌拼接。
- 建置：小工坊組裝零件並包裝。
- 文件產出：印刷室運轉並疊出紙張。
- 長時間任務：角色戴上夜班頭燈，環境依本機時間改變。
- Context 整理：檔案員把散紙裝訂成薄冊。
- 等待外部結果：角色坐在電話旁或看時鐘。
- Rate limit／暫時不可用：前往充電區；只有偵測到明確事件時才顯示。
- Process crash：樓層燈光短暫閃爍，角色拿工具箱檢查電腦。
- 取消任務：經理收回資料夾，臨時員工整理桌面後離場。

### 8.2 討論動畫

- 支持方案：貼綠色便利貼。
- 發現風險：貼橘色風險標籤。
- 新方案：白板亮起小燈泡。
- 找到證據：把書本或資料卡放到桌面中央。
- 無共識：桌面拼圖片暫時無法接合。
- 達成共識：不同顏色拼圖片形成決策卡。
- Owner 要求重議：決策卡退回並附加新的限制條件。
- Owner 授權決定：門外插上金色小旗。

過程顯示短氣泡；會議結束才產生摘要卡。摘要只呈現可觀察的選項、共識、分歧與結果，不顯示或虛構模型的隱藏思考。

### 8.3 閒置日常

- 經理替睡著的 subagent 蓋毯子。
- 動物玩偶追逐滾走的迴紋針。
- 小機器人替同事接上充電線。
- 澆花過量後拿拖把清理。
- 電梯客滿，最後一位等待下一班。
- 茶水間交換貼紙。
- Owner 喝咖啡、看文件或打瞌睡。
- 深夜只剩值班樓層亮燈。
- 大型里程碑後拍攝原創辦公室合照。

## 9. Owner 請示、討論與授權

### 9.0 觀測面與控制面邊界

辦公室 UI 可以執行：

- 顯示、隱藏、收合、釘選、縮放與排序樓層。
- 切換完整動態、低動態、勿擾、重要事件與隱私遮罩。
- 編輯純視覺員工名冊、玩偶外觀與安全顯示別名。
- 查看既有事件、摘要卡與待請示數量。

辦公室 UI 不可以執行：

- Spawn、停止、取消或重啟 agent／subagent。
- 派工、修改 prompt、指定會議參與者或發送訊息。
- 批准權限、授予／撤回 delegated decision authority。
- 宣稱工作完成、建立 acting lead 或推斷 Owner 的意思。

上述工作控制必須發生在原始 Codex、CLI 或其他 AI 工作介面。辦公室只在 adapter 收到明確事件後播放對應動畫。

### 9.1 請示

- AI 需要使用者決定時，離開工作位、上樓、敲門並等待。
- 同時多人請示時在 Owner 門外排隊。
- 正常模式顯示問號氣泡、柔和提示音與桌面紅點。
- 勿擾模式只保留門燈、紅點與 Owner 收件匣數量。
- 玩偶辦公室不替 Owner 回答，也不自動批准。

### 9.2 Owner 指定討論

- Owner 在原始工作介面指定參與者與主持者。
- 辦公室從實際事件判斷被召集者，播放集合、會議與報告動畫。
- 未被指定者繼續工作或休息。
- 會議結束後由指定報告者向 Owner 或 acting lead 交付摘要卡。

### 9.3 Delegated decision

- 只有明確的 Owner 指令才能啟動。
- 授權包含事項、參與者、範圍與有效期。
- 視覺以金色鑰匙／授權卡及會議室門牌呈現。
- 群組可在授權範圍內決定並繼續，不需再次請示。
- 決定完成後仍建立紀錄卡並送到 Owner 收件匣。
- 若來源沒有明確 `AuthorityGrant` 事件，辦公室不得自行推斷已授權，也不得顯示金色鑰匙。

## 10. 動畫、通知與事件模式

三項設定彼此獨立：

### 10.1 動態等級

- 完整動態：播放全部工作、施工與日常動畫。
- 低動態：縮短走路、關閉自動鏡頭、跳躍、搖晃與閃光，保留明確狀態變化。
- 尊重系統 `prefers-reduced-motion`。

### 10.2 勿擾

- 關閉桌面彈窗與工作列閃爍。
- 動畫仍繼續。
- Owner 請示只亮門燈與紅點。
- 關閉勿擾後顯示期間待辦總數，不一次補播所有通知。

### 10.3 只顯示重要事件

- P0：等待 Owner 決定／授權。
- P1：失敗、權限問題、重大衝突。
- P2：交接、審查結果、會議決定、任務完成、擴建。
- P3：一般寫檔、搜尋、測試、指派。
- P4：喝咖啡、睡覺、澆花等日常。

重要事件模式播放 P0 到 P2；P3 簡化為座位狀態，P4 暫停。

建議預設：完整動態、正常通知、全部事件、完全靜音；鏡頭不自動搶焦點。

### 10.4 全域動畫預算

- 狀態層：所有可見樓層都持續更新廉價狀態與微動畫。
- 動作層：完整動態預設同時最多 6–8 位角色做跨格位移；低動態 2–3 位；筆電省電 1–2 位。
- 招牌層：同時最多播放 1 個 A–J／擴建主演出，其他主演出進佇列。
- P0–P2 不得丟棄；P3 可在短時間窗內合併；P4 每 20–40 秒全樓最多觸發一則。
- 完全靜止且無新事件時降至 5 FPS 或休眠；收到事件再恢復目標幀率。
- 電梯是共享跨樓層移動佇列，可降低 pathfinding 與同時位移量，並自然產生客滿等待動畫。

### 10.5 零音效預算

- V1 不提供音效聲道、環境聲、腳步、鍵盤、語音或背景音樂。
- 啟動時不建立 `AudioContext`，不載入或解碼音訊素材，也不保留混音 timer、buffer 或聲道佇列。
- 所有 Owner 請示、錯誤、完成與擴建都使用視覺提示；系統通知仍遵守勿擾設定。
- 若未來加入音效，必須是獨立、預設關閉、延遲載入的選配模組，不屬於 V1 驗收範圍。

## 11. 事件與資料模型

所有 Provider adapter 將來源事件正規化為本機契約。身份、surface、session、工作、會議與授權不得只塞在無型別字串中：

```text
RuntimeSurface {
  surface_id, provider, surface_kind, executable_path?,
  installed_version?, process_state, observation_tier
}

SessionInstance {
  session_id, surface_id, workspace_id?, work_id?,
  lifecycle, activity_state, parent_session_id?, source_confidence
}

ProviderTeam {
  team_id, provider, lifecycle, annex_count
}

SessionPod {
  pod_id, team_id, session_id, safe_label, floor_id
}

Workstream {
  work_id, safe_label, owner_confirmed, lifecycle
}

AgentInstance {
  agent_id, provider, surface_id, session_id, parent_agent_id?,
  profile_id?, lifecycle, roles[], work_id?
}

WorkItem {
  work_id, safe_label, state, assignees[]
}

AuthorityGrant {
  grant_id, scope, participants[], expires_at?, source_event_id
}

MeetingRecord {
  meeting_id, participants[], work_id?, decision_id?, state
}
```

`OfficeEvent`：

```text
event_id
schema_version
timestamp
source_seq
workspace_id / project_id
provider
surface_id / surface_kind
session_id
agent_id
parent_agent_id
team_id
current_role
event_type
priority
task_label
safe_target_label
requires_owner
decision_authority
work_id
meeting_id
grant_id
decision_id
correlation_id
cause_event_id
observation_tier
source_confidence
```

必要事件類型包含：

- session_started／session_stopped
- agent_spawned／agent_finished／agent_failed
- task_assigned／task_started／task_waiting／task_completed
- tool_started／tool_finished
- research_started／review_started／test_started
- handoff_started／handoff_completed
- meeting_requested／meeting_started／meeting_completed
- owner_input_required／owner_decision_received
- authority_delegated／authority_revoked
- team_capacity_changed

來源資料不足時必須降級顯示，例如只顯示「正在工作」，不可猜測具體內容。

### 11.1 狀態顯示的真實性規則

- `installed`：只表示可找到受信任的套件或 executable。
- `app_open`：只表示 App 主程序存在；不代表有任何 session 正在運行。
- `session_idle`：session 已知且沒有正在進行的 turn；可播放看文件、喝咖啡等低意義動畫。
- `running`：必須由 prompt／turn／agent-start 等結構化事件開始，並由 stop／after-agent／turn-completed 等事件結束。
- `waiting_owner`：只由 permission、approval、elicitation 或明確請示事件觸發。
- `completed`：只由明確 task/session 完成事件觸發；程序消失、視窗關閉、長時間沒更新都不能推論完成。
- `unknown`：事件中斷、adapter 失聯或來源衝突時凍結最後可靠狀態並顯示灰色問號牌，不播放 crash 或完成動畫。
- top-level `SessionInstance` 一律建立獨立 SessionPod；`work_id` 是可選標籤，不存在時也不影響樓層與 parent-child 顯示。
- Presence-only 的 surface 一律不得播放具體工作動畫；最多顯示大廳狀態牌、靜態在場或關燈團隊樓。
- `RuntimeProcess`、歷史 state／index 列、關窗、timeout、adapter 失聯與 `work_id` 都不得把狀態上推為 `running`、`waiting_owner` 或 `completed`。

### 11.2 觀測來源優先序

1. Tier A：官方 lifecycle hooks、JSONL／stream-json 或 ACP／app-server 結構化事件，含穩定 session／thread ID。
2. Tier B：本機唯讀、版本探測後的 session index／state database，用於補標題、parent 與 surface；格式漂移即停用，不把歷史列當活躍狀態。
3. Tier C：受信任的 CLI wrapper 或由 hook 記錄的祖先程序鏈，用於區分 App 與 CLI surface。
4. Tier D：程序／視窗偵測，只能顯示 installed、app_open、process_exited 或 unknown。

高層級來源缺少時可以降級，不得用低層級猜測補成更具體的狀態。UI 的診斷模式要能顯示每個角色的 observation tier。

### 11.3 各 surface 的 V1 偵測契約

| Surface | 存在／開啟 | session／turn | subagent | V1 顯示邊界 |
|---|---|---|---|---|
| Codex App | Windows 套件 `OpenAI.Codex` 與受信任路徑的 `ChatGPT.exe` | Codex hooks 的 `session_id`、`turn_id`；本機 state source 只作 surface 補充 | `SubagentStart`／`SubagentStop` 的 `agent_id` | 程序數不代表任務數；來源衝突時標示未確認 |
| Codex CLI | 解析到的 `codex` executable；版本探測 | hooks；非互動工作可用 `codex exec --json` 的 thread／turn／item JSONL | hooks 的 agent lifecycle | `cli` 與 `exec` 是不同 surface kind；同 Provider 樓內各自成為 SessionPod |
| Claude Desktop Code | Windows 套件 `Claude` 與受信任路徑的 `Claude.exe` | 與 CLI 共用的 Claude Code hooks；session 彼此獨立 | `SubagentStart`／`SubagentStop` | 以 hook 祖先路徑或明確 surface marker 區分 Desktop；無法區分就降級 |
| Claude Desktop Chat／Cowork | 套件與 App 程序 | V1 無可依賴的本機 Code hook 契約 | 不顯示 | 只顯示大廳狀態牌，不捏造任務動畫 |
| Claude CLI | 解析到的 `claude` executable；版本探測 | hooks；headless 可用 `--output-format stream-json` | hooks 含 `agent_id`／`agent_type` | 可精確分開多個同時 CLI session |
| Gemini CLI | 解析到的 `gemini` executable；版本探測 | SessionStart／BeforeAgent／AfterAgent hooks，或 `--output-format stream-json` | 目前沒有專用 subagent lifecycle hook；以 subagent tool 的 BeforeTool／AfterTool 表示單一委派區間 | 委派區間只是短暫 decoration，不建立、計數或佔容量的 `AgentInstance`；不顯示內部步驟 |
| Grok CLI | 解析到的 `grok` executable；版本探測 | hooks、`streaming-json` 或 ACP `session/update` | `SubagentStart`／`SubagentStop` | hooks payload 為 camelCase，adapter 不可和 Claude schema 混用 |
| Antigravity CLI (`agy`) | 與 `gemini` 分開探測 executable／版本 | 獨立 adapter；未驗證結構化契約前只顯示有限狀態 | 未驗證 | 不得因 Google 生態或歷史關係直接冒充 Gemini CLI |

事件契約規則：

- Adapter 只回報來源事實；Provider 團隊樓層容量與是否擴建由本機 `LayoutPolicy` 判斷，不由 Provider adapter 發出。
- Acting lead 只有在來源提供明確交接／主導事件時才顯示；禁止以「最忙」或最後發言者推斷。
- `work_id` 只作可選的案件標籤；自動關聯只接受 parent invocation、明確 handoff token、correlation ID 或來源提供的 parent session。Provider、cwd、標題相似或時間接近不得合併 SessionPod。
- 即使兩個 top-level session 擁有相同 `work_id`，也只增加同案標籤或會議關係，不能合併 SessionPod 身份。
- `event_id + source_seq` 用於冪等、排序與斷線重播，避免重複施工或重複交件。
- Tool 級高頻事件可在短時間窗內合併成 task 級狀態，但不得丟棄 P0–P2。
- 事件洪峰時套用背壓與優先佇列；視覺層不得阻塞 adapter。

### 11.4 啟動時主動偵測與零分類負擔

辦公室每次啟動都自動執行唯讀 discovery，不以手動新增 Provider、App、CLI、session 或 `work_id` 作為正常使用前提：

1. 掃描受信任的 Windows 套件登記、PATH 與已知安裝位置，辨認可用 Provider surface 與版本。
2. 掃描受信任 executable 的程序與祖先程序鏈，只判斷 App／CLI 是否開啟及來源種類。
3. 自動連接先前已授權的 hook、JSONL／stream-json、ACP 或 app-server 事件來源，依 session ID 重建 ProviderTeam 與 SessionPod。
4. 啟動後持續監看新 session／agent lifecycle；新事件自動入樓、分桌與產生部屬，不要求 Owner 手動刷新。
5. Adapter 失聯時自動以退避策略重連；重連前保留最後可靠狀態並標示 `unknown`，不猜測完成或失敗。
6. 未安裝結構化事件 hook 時，仍可自動顯示 installed／app_open；需要修改外部工具設定才能提升精度時，只在首次顯示一次清楚的逐 Provider 授權，允許一鍵安裝或略過。
7. 授權後由程式執行版本相容性檢查、建立最小 hook 設定、驗證測試事件與顯示診斷結果；日後自動重用，不反覆打擾。
8. 使用者仍可在設定中停用某 Provider、撤銷 hook 或清除本程式的顯示對應；不得因此刪除外部 AI 的 session 或工作資料。

主動偵測的底線：自動化發現與連線，不自動升高資料含義。只看到程序就只畫大廳狀態牌；只有結構化 session／turn／agent 事件才能建立工作動畫。

## 12. 零額外 token 與隱私

1. 辦公室不得為動畫自行呼叫任何 LLM。
2. 環境、走路、施工與閒置動作全部由本機狀態機產生。
3. 氣泡使用既有任務名稱與本機模板。
4. 會議摘要使用 agent 已產生的結果；沒有資料時顯示「尚無結論」。
5. 任何 AI-enhanced summary 必須為預設關閉的明確選配功能，並提示可能消耗 token。
6. 預設不顯示 raw prompt、完整命令、程式碼、憑證、環境變數或敏感路徑。
7. 可只顯示安全化檔名、模組名與使用者自訂任務名稱。
8. 事件、名冊與版面預設只存在本機。
9. 若使用本機服務，只綁定 `127.0.0.1`，不得預設暴露到區域網路。
10. 提供一鍵隱私遮罩：立即隱藏 Provider、任務標籤、專案名稱與氣泡，只保留匿名玩偶和狀態色。
11. `safe_label` 由 core redaction 層產生：路徑只保留允許的 basename，限制長度與字元，移除疑似 token、金鑰、email 與使用者自訂敏感模式。
12. 真實事件日誌設定 retention 與一鍵清除；匯出前顯示可能含專案資訊的警告。
13. Loopback WebSocket 仍須使用短期本機認證 token；Windows 上優先評估 named pipe 與 ACL。
14. 禁止從事件推斷或顯示進度百分比、情緒、信心或思考時間軸，除非來源明確提供可觀察欄位。

## 13. 原創與發布邊界

- 不 fork 現有 AI 辦公室 repo。
- 不複製其程式碼、sprite、音效、字型、場景配置、README 文案或截圖。
- 不使用 OpenAI、Anthropic、Google、xAI 或其他公司的官方 Logo、吉祥物或近似識別。
- 所有角色、家具、動畫、名稱、UI 與文件重新創作。
- Provider 名稱只作相容性與狀態的描述性純文字。
- 使用者可把 Provider 顯示名稱改成安全別名；不得使用官方色彩、字型或近似品牌 CI 讓人誤認官方產品。
- 建立 `THIRD_PARTY_NOTICES.md` 與素材授權清單。
- 外部依賴與字型必須在發布前完成授權稽核。
- README 可列出靈感連結，但不得複製對方描述。
- 發布時明確聲明為非官方社群專案，與各 AI 供應商無隸屬或背書關係。

## 14. 技術架構建議

### 14.1 桌面外殼

- 優先評估 Tauri＋Windows WebView2，避免為單純動畫引入大型 Electron runtime。
- 支援置頂、無邊框、縮放、移動、透明度與開機後手動啟動。
- 不應預設自動啟動或修改系統設定。

### 14.2 視覺層

- TypeScript＋單一 Canvas 2D。
- 內部低解析度畫布，採 nearest-neighbor 放大。
- 所有可見樓層共享同一渲染迴圈，不為每層建立獨立 renderer。
- Sprite 動畫使用小型 sprite sheet；不使用 3D、動態模糊、即時反射或重粒子效果。

### 14.3 事件層

- 每個 AI 工具使用獨立 adapter，輸出同一 `OfficeEvent`。
- Adapter 與視覺層透過本機 IPC 或 loopback WebSocket 溝通。
- 使用 JSONL 或 SQLite 保存必要事件索引與名冊，不保存 raw secrets。
- 支援 synthetic event replay，讓動畫可在沒有真實 AI 的情況下測試。
- IPC 必須具本機鑑權；事件持久化採非同步寫入並有 retention 上限，不在 UI 執行緒同步寫 SQLite／JSONL。

## 15. 筆電效能策略

- 所有可見展開樓層共用約 20–30 FPS，而非每層各自運行。
- 低動態／電池模式降至約 12–15 FPS。
- 工作動畫優先；日常動畫分散時間、限制同時動作人數。
- 畫面外、收合或隱藏樓層停止繪圖，只更新狀態。
- 視窗最小化、螢幕關閉或系統睡眠時停止渲染。
- 使用事件驅動更新，不以高頻輪詢檢查所有 agent。
- 事件物件、便利貼、文件與小道具使用 object pool 或可重用實例，避免事件洪峰造成大量 GC。
- 建築過高時使用垂直 viewport culling；使用者仍可縮小看到整棟建築的低細節動畫。
- 提供手動「筆電省電」快捷開關。
- 提供不透明／實心背景模式；透明置頂視窗若在實機造成額外 Windows composition 負擔，可直接關閉透明度。
- 預設讓 Windows 使用整合顯示核心；不得因常駐動畫強制喚醒獨立顯示卡。獨顯是否被喚醒列入實機驗收。
- 原型階段必須在實際使用者筆電上測量 CPU、GPU、RAM 與電池影響，再設定正式效能門檻。

### 15.1 Phase 0 建議效能門檻

以下是 prototype 的驗收目標，不是尚未量測就宣稱已達成的數字：

- 測試場景：5 個展開樓層、25 個可見玩偶、全樓微動畫、6–8 位角色跨格移動，並同時播放一次擴建主演出。
- 正常活動：CPU 平均目標不超過約 5%，GPU 使用率不應長時間高於約 5%，working set 目標不超過約 250 MB。
- 無新事件但視窗可見：CPU 目標低於約 1%，降至 5 FPS 或靜幀休眠。
- 視窗最小化／隱藏：停止渲染，CPU 目標低於約 0.5%，GPU 接近閒置。
- 事件洪峰／施工尖峰：可以短暫上升，但不應持續超過數秒，也不得造成 Codex／CLI 工作明顯卡頓。
- 整合顯示核心優先；若啟動辦公室會使獨立 GPU 長時間保持喚醒，視為不通過。
- 使用 Windows 平衡與電池模式各做至少一次長時間比較；記錄基準耗電、開啟辦公室後耗電與勿擾／低動態後耗電。
- 門檻未通過時，依序降低同時位移數、環境動畫頻率、透明度與目標 FPS，不先犧牲 P0–P2 事件正確性。

### 15.2 自動資源釋放與 watchdog

程式必須有獨立的 `ResourceLifecycleManager`，只管理玩偶辦公室自己的資源。它不得清理、調整優先權、暫停或終止 Codex、Claude、Gemini、Grok、其他 CLI、使用者工作程式或任何不屬於本應用的程序。

#### 正常生命週期釋放

- 每段動畫完成後立即解除 timeline、path、callback、temporary prop 與事件 payload 的引用。
- `requestAnimationFrame`、timer、observer、IPC subscription 與 event listener 必須跟隨畫面／樓層生命週期註冊及撤銷。
- Session 結束後先保存最小摘要，再釋放 pathfinding、active sprite、會議座位與工作中狀態。
- 收合／隱藏樓層停止 frame update；閒置一段時間後卸載該層非共用裝飾素材。
- 共用 sprite atlas 保持單份，避免每層複製；額外造型與大型裝飾使用有上限的 LRU cache。
- V1 不建立 AudioContext 或載入任何音訊資源。
- Background worker 在工作完成及 idle timeout 後結束，不保留無限 worker pool。

#### 有界佇列與儲存

- P0–P2 重要事件使用有界、可持久化佇列，不得因記憶體壓力靜默丟失。
- P3 高頻事件在短時間窗內 coalesce；P4 只保留下一個待播放日常，不累積歷史動畫。
- 完成後的 transient event payload 轉成最小狀態，不把 raw 大字串長期留在 RAM。
- 真實事件日誌預設採 rolling retention，例如最多 7 天或 50 MB，以先到者為準；Owner 可調整或立即清除。
- SQLite／JSONL 寫入非同步批次執行；整理、checkpoint 或 vacuum 只能在程式閒置且非電池壓力時進行，不高頻執行。

#### 資源壓力分級

- Green：正常運行完整動畫。
- Yellow：持續接近 soft budget 時，先停止 P4、降低非焦點樓層微動畫頻率、清除 LRU 尾端與已完成 event payload。
- Orange：超過 soft budget 一段時間時，自動切到低動態、暫停透明特效、卸載隱藏樓層非共用素材並降低 FPS。
- Red：超過 hard budget 且 working set 仍持續上升時，先保存最小 UI snapshot，再只重啟視覺 renderer；事件 collector 與外部 AI 程序保持不動。
- 資源恢復穩定後可逐級恢復，但要有 cooldown，避免模式反覆跳動。

Phase 0 建議先以 app working set 約 200 MB 作 soft-budget 實驗值、300 MB 作 hard-budget 實驗值；它們必須依實機 WebView2 基準調整，不是未實測的永久常數。

#### 禁止的假釋放方式

- 不高頻呼叫強制 GC。
- 不使用 Windows 全系統記憶體清理器或 aggressive working-set trim。
- 不以殺掉、重啟或降低外部 AI 程序優先權換取本程式效能。
- 不刪除仍在工作的 session、P0–P2 待辦或未完成 Owner 請示。
- 不因資源壓力捏造「任務完成」或讓角色消失；只能降低動畫細節並保留真實狀態。

#### 可觀察性

- 設定頁提供本程式自己的 FPS、working set、事件佇列長度、可見樓層、活躍玩偶數與目前資源等級。
- 提供「立即釋放閒置資源」按鈕，但只執行安全的本程式 cache／動畫清理。
- 記錄 renderer 自動降級與重啟原因，不記錄 raw prompt、secret 或敏感事件內容。
- Phase 0 加入 8 小時 soak test：反覆 spawn、完成、擴建、收樓、隱藏與展開，確認回到閒置後 working set 能回落或維持穩定平台，不持續單調上升。

### 15.3 主線任務優先與自我降級

核心規則：玩偶辦公室只能降低自己的資源使用，絕不能以修改外部程序優先權的方式「保護」主線。Codex、Claude、Gemini、Grok、編譯器、IDE、Terminal 與使用者指定的工作程式永遠不被本程式暫停、降權、綁核、限速或終止。

#### 優先模式

- Auto（預設）：依系統壓力、電池狀態、前景程式與 Owner 指定的受保護程式自動調整。
- Always Low：辦公室 renderer 與背景工作永久使用低優先與低 I/O 模式。
- Normal：允許完整動畫，但仍受 CPU、RAM、FPS 與事件預算上限約束。
- Pause Visuals：事件 collector 繼續保存 P0–P2，視覺 renderer 完全暫停。

#### 受保護程式

- Owner 可用 executable name 建立受保護清單，例如 Codex、Terminal、IDE、編譯器或 AI CLI。
- 預設只比對 executable name 與前景狀態，不讀取命令列參數、prompt、工作內容或 credentials。
- 受保護程式位於前景或持續繁忙時，辦公室進入 `MainlineProtection`。
- 使用者也可從系統匣立即手動啟用／解除 `MainlineProtection`。

#### 系統壓力偵測

- CPU 長時間高負載。
- 可用記憶體低於實機校準門檻。
- Windows 省電模式、使用電池或低電量。
- 全螢幕／簡報／遊戲或 Owner 指定的前景程式。
- 本程式 working set、事件佇列或 frame time 超過自身 budget。

壓力門檻必須有 hysteresis 與 cooldown；不可因瞬間尖峰在模式間來回閃爍。

#### MainlineProtection 行為

1. 立即停止 P4 日常與所有非必要環境音。
2. 將 P3 合併為廉價座位狀態，不播放多人物走動。
3. P0–P2 保存在優先佇列，以燈號／狀態卡即時呈現；大型演出改成低動態版本。
4. 將全樓渲染降至約 5–10 FPS，或在沒有畫面變化時使用 dirty-frame rendering。
5. 暫停透明效果、非焦點樓層裝飾與背景 worker。
6. 擴建若剛好發生，立即建立正確樓層狀態並播放三段式簡化施工；不等待完整動畫才能反映真實狀態。
7. 降低本程式 renderer thread／process 與持久化 I/O 的優先等級；Windows 上優先評估 `BELOW_NORMAL`、background mode 或 EcoQoS，只套用到本程式自有程序／執行緒。
8. 壓力解除並經 cooldown 後逐步恢復，不一次補播被簡化的舊動畫。

#### 事件 collector 與 renderer 分離

- Collector 必須事件驅動、低 CPU、可在 renderer 暫停或重啟時繼續接收 P0–P2。
- Renderer 可以被降頻、暫停或安全重啟，不得影響外部 AI 與事件來源。
- Collector 與 renderer 之間使用有界 IPC；renderer 落後時只取得最新狀態與未處理重要事件，不補送全部 P3／P4 歷史。
- 日誌批次寫入使用低 I/O 優先；系統壓力高時延後非必要 checkpoint／vacuum。

#### 主線影響驗收

- 在實際筆電上選一個可重複的 CPU／I/O 工作負載，比較辦公室關閉、完整動畫、Auto 與 Always Low 四種情境。
- Auto／MainlineProtection 的目標是主線任務中位完成時間相對辦公室關閉的差異不超過約 1–2%；完整動畫模式目標不超過約 3%。
- 驗證前景 Codex／Terminal／IDE 操作延遲、編譯時間、磁碟 I/O 與獨顯喚醒狀態。
- 若未達標，先降低辦公室 FPS、同時移動數、透明度與日常動畫，再考慮其他視覺效果；不可要求主線程式讓步。

## 16. 建議開發階段

### Phase -1：顯示語義凍結（目前階段）

- Owner 已修正樓層模型：同 Provider 優先共用團隊樓層，多任務以獨立 SessionPod／專案桌並行。
- 用「命理」與「辦公室動畫」兩個真實案例畫出同一 Codex 樓的靜態狀態表，驗證多 App、多 CLI、多 session 與 subagent 不會混桌。
- 對每個 surface 完成 observation-tier 測試表，證明哪些狀態是 observed、哪些只能顯示 unknown。
- 畫出首次啟動 discovery、一次性 hook 授權、自動重連與降級顯示流程；正常使用不得要求手動新增 session 或分類工作。
- Phase -1 未經 Owner 確認，不開始 collector、adapter、renderer 或動畫 coding。

### Phase 0：動畫沙盒

- 原創玩偶、單一 Canvas、垂直樓層。
- Synthetic event generator。
- Owner、經理、subagent、專家與 acting lead 狀態。
- 擴建、收合、隱藏、全樓動畫與效能量測。
- 先驗證 5 層、25 個可見玩偶、事件洪峰與擴建同時發生時的全域動畫預算；未通過前不擴充動畫數量。

### Phase 1：核心可用版本

- Codex event adapter。
- 動態 parent-child 階層。
- Owner 請示與 delegated decision 視覺。
- A 到 J 全部招牌動畫。
- A–J 使用共用的走路、電梯、文件、印章、佇列與報告 primitive 分批完成；它們仍是 V1 目標，不因外部顧問的範圍建議而刪除。
- 完整動態、低動態、勿擾與重要事件模式。

### Phase 2：多 Provider

- Claude adapter。
- Gemini、Grok 與通用 CLI adapter。
- 同一 Provider 的多 session 在同樓正確分桌；不同 Provider 透過公共會議室呈現已連結協作。
- 跨團隊討論、會議摘要卡與報告路徑。

### Phase 3：完善與發布

- 員工名冊與角色自訂。
- 原創素材包與授權清單。
- 無障礙、鍵盤操作、色盲與 reduced-motion 測試。
- 效能回歸、隱私稽核、第三方授權稽核與 GitHub 發布文件。

## 17. 第一版驗收條件

1. 能依實際事件呈現主 agent、經理、subagent、sub-lead 與單人專家。
2. Provider 不決定職級；acting lead 可動態交接。
3. Owner 永久存在，可接收請示並明確授權指定群組決定。
4. 樓層依 Provider 團隊顯示；同 Provider 的不同 session 同樓但不混桌，跨 Provider 協作進入公共會議室。
5. 團隊人數增加時以完整施工動畫垂直擴建。
6. 所有可見展開樓層可同時播放工作動畫。
7. 每層可收合、隱藏、釘選與降低動態。
8. A 到 J 招牌動畫全部可由 synthetic events 重播測試。
9. 動畫與氣泡預設不產生任何額外 LLM 呼叫。
10. 不顯示 raw secrets、完整 prompt 或未經安全化的敏感資料。
11. 不使用或近似複製現有專案的程式、素材、Logo、文案與截圖。
12. 在實際筆電上通過可接受的 CPU、GPU、RAM 與電池影響測試。
13. 每個可見展開樓層都能維持至少一項工作微動畫；大型位移遵守全域預算與佇列。
14. 辦公室 UI 無法發送派工、停止、批准、授權或其他 agent 控制動作。
15. 重播相同 `event_id + source_seq` 不會生成第二個玩偶、重複擴建或重複交件。
16. 一鍵隱私遮罩能立即移除畫面中的 Provider、任務與專案文字。
17. 8 小時 soak test 後，完成動畫、結束 session 與隱藏樓層的資源可被回收，working set 不持續單調上升。
18. 超過資源 soft budget 時能自動降級；必要時只能重啟視覺 renderer，不影響事件 collector 或任何外部 AI 程序。
19. P0–P2、Owner 請示與未完成工作不會因自動清理、佇列合併或 renderer 重啟而遺失。
20. Auto／MainlineProtection 能在受保護程式繁忙或系統資源緊張時自動降低本程式負載，且不修改任何外部程序。
21. 實機可重複基準測試中，Auto 模式對主線任務完成時間的目標影響不超過約 1–2%；未達標不得進入發布候選版本。
22. 程序數不會被當成 session 或 agent 數；App 開啟不會被畫成工作中。
23. 沒有明確完成事件時，不會因程序退出、視窗關閉或 timeout 播放完成動畫。
24. V1 啟動後不存在 AudioContext、音訊素材解碼或背景聲道工作。
25. 啟動後能主動發現支援的已安裝／已開啟 surface，並自動重連已授權事件來源；除了首次 hook 授權外，不要求使用者手動建立 Provider 樓、session 專案桌或工作分類。

## 18. 設計原則摘要

- Truthful：動畫只代表可觀察到的事件，不假裝知道隱藏思考。
- Team-floor：同 Provider 優先共用團隊樓層；session／專案桌負責清楚呈現多任務與部屬歸屬。
- Auto-discovery：啟動即自動發現、連線與重連；訊號不足時誠實降級，不把設定負擔轉嫁給 Owner。
- Owner-first：AI 可協調與被授權決定，但最終治理權來自 Owner。
- Dynamic hierarchy：上下級來自實際 parent-child 關係，不來自品牌。
- Vertical dollhouse：固定寬度、垂直擴建、全樓可見且可逐層控制。
- Local and light：本機、低解析度、零額外 token、筆電友善。
- Original by design：clean-room 原創，從程式、視覺到文件都避開複製。
