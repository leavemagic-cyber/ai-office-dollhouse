# Grok Stage 7 — Full Code Review

Date: 2026-08-10  
Review mode: read-only architecture and code review. No project files were changed by Grok.

## Scope and invocation

Primary review command:

```text
cmd /c grok --prompt-file "GROK_STAGE7_FULL_CODE_REVIEW_PROMPT.md" --permission-mode plan --no-subagents --disable-web-search --no-memory --output-format plain
```

The review covered the runtime UI and model, provider discovery and event relay, native bridge, integration installers, release scripts, tests, and governing product contracts. Generated/vendor output and secrets were excluded.

## Verdict

**CONDITIONAL PASS.** Grok found no direct breach of the core product contract such as fabricated activity, raw prompt/content capture, AI control, or a false claim of CSS click-through. One behavioral defect must be fixed before calling the current implementation fully contract-complete.

## MUST-FIX

### 1. An Owner request can disappear after the normal stale timeout

Evidence:

- `resources/js/domain.js:589-595`
- Related display path: `resources/js/main.js:126-128,523-526`
- Related floor policy: `resources/js/floor-layout.js:33-34,98-105`

`owner_input_required` puts a provider pod into `waiting_owner`. If no later event arrives, stale-session degradation changes every active state to `unknown` after five minutes. The compact Owner inbox counts only `waiting_owner`, while active-only rendering can then hide the Owner floor. This conflicts with the rule that a request for the Owner must remain visible until it is resolved.

Recommended repair: preserve `waiting_owner` during stale degradation (and evaluate whether `discussing` should also be protected), or retain an explicit `awaitingOwner` flag that survives generic state expiry.

## SHOULD-FIX

### 2. Existing-work snapshot depends on a system Node installation

Evidence: `resources/js/native-bridge.js:59-68,91-95`; `scripts/snapshot-work.mjs`.

The packaged application does not bundle Node. A user who has no system `node.exe` can lose the Codex/Claude existing-work snapshot despite the owner-facing claim that current work will be displayed. Bundle/replace the snapshot path or make the dependency and fallback behavior explicit.

### 3. A single integration hook group may be serialized as an object instead of an array

Evidence: `scripts/install-integrations.ps1:100-113,139`; test coverage in `tests/scripts.test.mjs:99-128` does not cover blank settings / a single created group.

PowerShell `ConvertTo-Json` can collapse a single-element collection. Force array serialization and add a blank-settings test so the target CLI schema always receives an array.

### 4. Install-root validation and uninstall safety do not match

Evidence: `scripts/install-app.ps1:19-22`; `scripts/uninstall-app.ps1:7-12`.

Installation accepts an arbitrary `InstallRoot`, but uninstallation only recognizes a narrow safe allowlist. Validate/document the same ownership boundary on both paths so a custom install remains cleanly removable without opening arbitrary deletion scope.

### 5. Integration-consent policy is contradictory

Evidence: `CONTRIBUTING.md:10`; `resources/js/main.js:241-255,506-516`; unused path `resources/js/native-bridge.js:107-116`.

The contribution policy says hook changes require confirmation, while the runtime can silently reinstall missing integrations. Choose and document one intentional policy: an owner-authorized one-click install with clear disclosure, or an explicit confirmation/no automatic repair path.

### 6. Event-file processing can read an unbounded whole file every 900 ms

Evidence: `resources/js/discovery.js:73-95`.

The relay caps its own output at 2 MiB, but an external/local writer is not capped. Repeated full reads can create a UI spike. Use incremental/offset reads or an explicit tail-size ceiling.

### 7. The app has no single-instance guard

Evidence: startup path in `resources/js/main.js`; native process behavior in `resources/js/native-bridge.js:195-198`.

Two application instances can race the model and integration behavior. Add a mutex/lock or an explicit second-instance handoff.

### 8. Gemini timeout unit/schema is unclear

Evidence: `scripts/install-integrations.ps1:148-168`.

Gemini uses `5000`, unlike the other providers' `3`. Verify the official schema and document/assert the intended unit instead of relying on an ambiguous literal.

### 9. A stopped subagent may be visually represented as finished successfully

Evidence: `scripts/relay-hooks/codex-relay.cs:83`; `scripts/relay-hooks/claude-relay.ps1:89`.

Preserve an error/stopped state or use a neutral completion visual so cancellation does not imply successful completion.

### 10. Add direct tests for the key edge cases

Missing focused cases include: protected `waiting_owner` persistence, hook arrays from blank settings, native overlay hide/show/minimized behavior, no-Node snapshot fallback, and incremental/rotated event-file reads.

## NIT / cleanup

- Remove or use the dead `confirmIntegration` path; reassess unused `automaticExpansion` state and hidden head/foot DOM.
- State that `%LOCALAPPDATA%\AIOfficeDollhouse` remains after uninstall unless the user removes it manually.
- The PowerShell hook relay has no write retry equivalent to the C# relay.
- Historical fixed-tower wording still appears in Goal Plan section 3; keep it clearly marked historical under the current micro-overlay contract.

## Contract assessment

- Active-only display: passes.
- Read-only/privacy: conditional, principally because hook-change policy is unclear and titles may be displayed when privacy is disabled by the owner.
- Low disturbance: passes in the reviewed code path.
- Clean-room / no copied branded assets: passes in the reviewed code path.

## Review limitations / follow-up verification

The review was static and did not execute the test suite. It flagged these items for live/focused verification after repair:

- official Gemini hook-timeout schema and provider tolerance for hook-array shape;
- real multi-monitor / high-DPI behavior;
- resilience to malformed or oversized local event input;
- package behavior on a computer without Node installed.

See also the supplemental CI and supply-chain review: `GROK_STAGE7_SUPPLEMENTAL_CI_SUPPLY_CHAIN_REVIEW_20260810.md`.
