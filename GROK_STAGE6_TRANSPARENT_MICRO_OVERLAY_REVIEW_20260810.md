# Grok Stage 6 Review — Transparent Micro Overlay

Date: 2026-08-10 13:41 Asia/Taipei

Review invocation: `grok --prompt-file GROK_STAGE6_TRANSPARENT_MICRO_OVERLAY_REVIEW_PROMPT.md --permission-mode plan --no-subagents --disable-web-search --no-memory --output-format plain`

Scope: read-only review of the Owner-approved transparent micro-overlay redesign. The reviewer was not authorized to modify source, package, integrations, or settings.

## VERDICT: CONDITIONAL PASS

### 1. Transparent miniature perspective floor — implementation is real, not a rename

- `neutralino.config.json:48-49` sets `borderless` and `transparent: true`; default width is 164 at `:35-36`.
- `resources/styles.css:7-13,16-25,94-126` keeps `html`, `body`, `.tower-window`, `.floor-card`, and `.floor-canvas` transparent; the floor header and footer are hidden at `:111-112`, leaving no opaque card or nameplate row.
- `resources/js/renderer.js:145-160` draws only low-alpha perspective floor lines in `drawRoomShell`, with no outer walls. Furniture at `:338-342` and figures at `:511-514` are scaled down.
- The supplied zoom image visibly contains a tiny control strip and small floor slice. The reviewer notes black pixels in PrintWindow capture are a transparency-capture property, not contrary evidence.

### 2. `activeOnly` — main route excludes presence/installed shells

- `resources/js/main.js:324` calls `floorSpecsForModel(..., { activeOnly: true })`.
- `resources/js/floor-layout.js:52-59,61-85` keeps a floor only for displayable population, an eligible recent snapshot, Owner request/Lobby discussion, or a 20-second important event. `appOpen` and `installed` do not satisfy `floorHasUsefulWork`.
- `tests/floor-layout.test.mjs:34-70` covers an idle `gemini` `appOpen` exclusion and short important-event retention without reviving other providers.
- `resources/js/main.js:326-331` stops, unobserves, and removes vacant floor DOM. Presence only freezes an already-known unknown pod (`floor-layout.js:98-106`); it does not fabricate a worker.

### 3. Window behavior and desktop interaction

- `resources/js/main.js:230-234` shows only when `floorCount > 0`, with `show({ focus: false })`; it otherwise hides.
- Move uses `resources/js/main.js:214` and `resources/js/native-bridge.js:150-152`; resize is bounded at `resources/js/main.js:22-25,461-486`, with height derived from visible floor count.

### 4. Visual read

- Review screenshot supports the intended micro-scale and does not show a large panel or oversized figure.
- Controls are intentionally low-chrome; their idle opacity is `.3` at `resources/styles.css:39`.

### 5. Truth and resource behavior

- Live pods, recent snapshots, and request visitors are the only people shown. Historical non-recent data does not populate the display (`resources/js/floor-layout.js:45-48`; `resources/js/renderer.js:571-577`).
- Off-screen, hidden, and collapsed rendering stops at `resources/js/main.js:376-378,423-445`; `resources/js/resource-manager.js:79-99` applies zero FPS/DND and pressure degradation while hidden.

### 6. IP / clean-room

- Review found no external sprite, image artwork, sound, logo, or identifiable LEGO/brand trade dress. The visuals are Canvas geometry and system fonts (`Segoe UI`/`Microsoft JhengHei UI`).
- Generic block-toy character direction alone is not an infringement finding.

### 7. Historical documentation

- `AI_OFFICE_DOLLHOUSE_V2_OWNER_GOAL_PLAN.md:54-70,100` retains historical narrow-tower, collapsed-nameplate, and idle-nameplate language.
- The reviewer correctly treats it as documentation residue, not runtime behavior, because the Owner correction at the document start and `docs/ARCHITECTURE.md:17-22` take priority.

## MUST-FIX

None.

## SHOULD-FIX

1. Transparent WebView pixels can still intercept clicks. Assess platform-supported click-through or narrow hit regions.
2. `hidden: false` at initial startup together with `overlayVisible=true` before the first sync could briefly show an empty window. Prefer hidden-at-start and explicit non-focus show upon useful work.
3. Resize uses `event.screenX` physical pixels with CSS-pixel width, which may feel inconsistent under high DPI.
4. Floor `globalAlpha=.16` may be too low contrast against a busy wallpaper at the intended 7% width; improve legibility without enlarging the overlay.
5. Remove or clearly mark stale fixed-tower / idle-nameplate language in the Goal Plan and Design Spec.

## NIT

- `tower-*` class names and the configured app title versus runtime `AI Office Float` title are inconsistent labels.
- Dead renderer helpers such as `drawElevator` / `drawAnnexIndicator` could be removed in later cleanup.

## Direct answer

Only useful working floors: **Yes**. The reviewer found no UI path that keeps an idle Owner, Provider, or Lobby floor visible solely from app presence, installation, or stale history.

## Implementation response — 2026-08-10

- Implemented: `hidden: true` startup, `overlayVisible = false`, delayed native show until floor canvases render, and `useLogicalPixels: true` for DPI-aware native sizing.
- Implemented: a manually minimized overlay is treated as Owner DND; automatic activity display no longer calls `unminimize()` or `focus()`.
- Implemented: floor-plane alpha and edge contrast increased without adding an opaque panel; compact move/resize grips are slightly more discoverable.
- Implemented after a real desktop capture exposed the issue: the tiny overlay defaults to `alwaysOnTop: true`; it stays non-foreground and low process priority so it is visible without taking control of the work app.
- Deliberately deferred: click-through. Neutralino 6.9 exposes no native Windows mouse-passthrough API; CSS `pointer-events` would not reliably transfer clicks to the underlying application.
- Verified after reinstall: `npm test` 40/40, `npm run check`, full 12,000-event/8-hour soak release package, matching installed release hashes, and the real desktop crop `artifacts/desktop-final/live-transparent-overlay-topmost-after-grok-fixes-20260810-1350.png`.
