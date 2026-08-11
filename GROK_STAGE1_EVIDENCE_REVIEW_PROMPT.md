請直接審查以下「已抽取的現行程式證據」，不要再呼叫工具或讀其他檔案。範圍只限 Stage 1 單一左側窄塔、一鍵啟動、垂直樓層與停繪生命週期。輸出繁體中文 `VERDICT: PASS` 或 `VERDICT: CHANGE`，最多 6 點。不要討論 Stage 2 美術。

Owner hard requirements:
- one-click route must create only one tower; no child-window routes or window.create.
- tower order Owner, Codex, Claude, Gemini, Grok, Lobby.
- 272 CSS target on this 150% DPI machine via 408 native request; 24 collapsed, 156 normal expanded, 174 crowded.
- active live or explicitly recent snapshot may auto-expand; stale/presence-only cannot create workers.
- collapsed/off-screen/document-hidden floors stop rAF.
- only mode-cycle/privacy/minimize/close controls; startup scans automatically.

Current exact evidence:

1. `resources/js/main.js:13`
```js
const ROOM_ORDER = ['owner', 'codex', 'claude', 'gemini', 'grok', 'lobby'];
```

2. `resources/js/main.js:148`
```js
await bridge.configureCurrentWindow({ title: 'AI 玩偶辦公室', width: 408, height: 1317, x: 4, y: 4, alwaysOnTop: settings.alwaysOnTop });
```

3. `resources/js/main.js:177-181`
```js
function automaticExpansion(room, status, model) {
  if (room === 'owner') return true;
  if (status.kind === 'live') return true;
  if (room === 'lobby') return false;
  return Boolean(model.providers[room]?.snapshotWork?.some((work) => work.recent));
}
```

4. `resources/js/renderer.js:408-409`
```js
// snapshot-labelled doll; older records stay as archive cards in the lobby.
for (const work of (provider.snapshotWork || []).filter((item) => item.recent).slice(0, 2)) {
```

5. `resources/js/main.js:205-210`
```js
const expanded = manualExpansion.has(room) ? manualExpansion.get(room) : automaticExpansion(room, status, currentModel);
view.card.classList.toggle('collapsed', !expanded);
const shouldRender = expanded && view.inView && !document.hidden;
view.renderer.setModel(currentModel, shouldRender);
if (shouldRender) view.renderer.start(); else view.renderer.stop();
```

6. `resources/js/main.js:291-311` has an `IntersectionObserver` rooted at the scrolling floor list; intersecting expanded visible floors call `setModel` then `start`, non-intersecting floors call `stop`. A `visibilitychange` listener repeats the same active predicate and stops all renderers when hidden.

7. `resources/js/renderer.js:473-499`: `setModel(model, drawImmediately)` only draws when requested; `start()` guards duplicate loops and owns one requestAnimationFrame chain; `stop()` sets `running=false`, cancels the stored frame, and clears the handle.

8. `resources/styles.css:31-89`: tower rows are 32px / scroll area / 20px; floor head is 24px; normal scene is 114px; crowded scene is 132px; footer is 18px; collapsed hides scene and footer. Therefore normal total = 156 and crowded total = 174.

9. `resources/index.html:10-28` contains only the tower DOM. It exposes mode-cycle, minimize, close, floor list and privacy. The old controller and room DOM were removed.

10. Repository searches now return zero matches for `window.create`, `createRoom`, `startRoom`, `ROOM_QUERY`, `owner.html`, `codex.html`, `claude.html`, `gemini.html`, `grok.html`, and `lobby.html` under `resources/` and `neutralino.config.json`. All six obsolete child HTML files were deleted.

11. `resources/js/main.js:328-333` automatically runs discovery scan, event poll and existing-work snapshot, then starts discovery/inbox and broadcasts the model. There is no manual setup gate.

12. Current checks: 15/15 Node tests pass; project check passes with 52 checked files, 11 JavaScript files, 0 audio assets, runtimeLogging=false; `git diff --check` has no errors.

Known deferred evidence: Windows real-desktop measurement is intentionally deferred until the 2.5D art is complete, per Owner instruction not to waste repeated desktop-monitoring tokens. Judge Stage 1 source architecture, not final desktop appearance.
