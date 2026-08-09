# Grok v0.4 第二輪確認審查

日期：2026-08-09
審查對象：`AI_OFFICE_DOLLHOUSE_DESIGN_SPEC.md` Concept Spec v0.4
方法：Grok 唯讀完整規格；未改檔、未執行外部命令、未上網、未使用 subagent

## Bottom line

Grok 確認 v0.4 已把第一輪核心工程缺口收斂成可進入沙盒的設計。A–J 保留為 V1 目標、先做 Phase 0 效能閘門的排序合理。

**沒有會阻止開始 synthetic-event 動畫沙盒的 MUST-FIX。**

## 第一輪問題確認

| # | 第一輪問題 | 第二輪狀態 |
|---|---|---|
| 1 | 觀測面／控制面切開 | `RESOLVED` |
| 2 | V1 不可假裝未接入的 Provider 已存在 | `RESOLVED` |
| 3 | 動態樓層插入點與角色不可重複出現 | `RESOLVED` |
| 4 | Manager 身分不可因 subagent 離場閃爍 | `RESOLVED` |
| 5 | Acting lead 僅能來自明確事件 | `RESOLVED` |
| 6 | 全樓狀態／微動畫／大型演出預算 | `RESOLVED` |
| 7 | 無結構結果時不可編造會議共識 | `RESOLVED` |
| 8 | Work／meeting／grant／decision 關聯鍵 | `RESOLVED` |
| 9 | 聲音預算、合併、非同步持久化、retention | `PARTIAL`：只缺並行音效上限與聲音預算細節 |
| 10 | 一鍵隱私遮罩、redaction、IPC 鑑權 | `RESOLVED` |

第一輪 blocker 無任何項目仍為 `OPEN`。

## 第二輪殘餘風險

以下不阻止 Phase 0：

1. P0–P2 有界佇列仍需定義極端溢出時的落盤、告警與恢復契約。
2. 需要把「動畫完成」「工作完成」「payload 可釋放」對齊明確狀態，避免誤清未完成項目。
3. `team_capacity_changed` 應明確標為 core／`LayoutPolicy` 衍生事件，而不是 Provider adapter 的畫面決定。
4. `MainlineProtection` 的繁忙偵測門檻需要實機校準與 cooldown。
5. 壓力降級後，可見樓層至少仍要保留狀態燈、座位姿態或另一項最低微動畫。
6. CPU、GPU、RAM、1–2% 主線影響與 soft／hard budget 都是 prototype 假說，不是尚未實測的承諾。

## Phase 0 守衛

1. 建立效能校準表：測得值、採納值、未達標時降級順序。
2. 顯示可見樓層微動畫數、同時跨格位移數、招牌佇列深度與電梯佇列深度。
3. 合成事件洪峰必須驗證 P0–P2 不丟、P3 可合併、P4 有上限。
4. 壓力模式不得讓展開樓層變成空白靜層。
5. 建立最小狀態表，例如 `waiting_owner`、`in_progress`、`completed`、`failed`，作為資源釋放依據。
6. 資源釋放與 MainlineProtection 只能操作本應用，不得觸碰外部 AI／CLI 程序。

## Grok 對關鍵問題的確認

- 控制面越界：未發現。
- 自動資源釋放：方向安全；仍須以完成態定義防止本程式內部誤釋。
- `MainlineProtection`：足以作為主線優先設計，1–2% 影響必須實測。
- 全樓微動畫＋大型位移預算：可實作。
- A–J 保留 V1、Phase 0 先過效能閘門：可以接受。
- Phase 0 blocker：無。

## 最終 Verdict

`GO_PHASE_0_WITH_GUARDS`

可以開始 Phase 0 synthetic-event 動畫沙盒；在效能數字完成實機校準、P0–P2 不丟、全域動畫預算可量測，以及資源釋放不碰外部程序的守衛下推進。
