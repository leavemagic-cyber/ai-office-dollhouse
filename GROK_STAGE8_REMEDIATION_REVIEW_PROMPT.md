# Grok Stage 8 — Remediation Review (read-only)

You are the final independent code reviewer for the local project at the current working directory. Review the current working tree only. Do not modify files, do not run installers, do not access credentials/configuration outside this project, do not browse, and do not invoke subagents.

This project is a Windows Neutralino desktop micro-overlay that displays only truthful, local AI-work events. It must remain read-only with respect to external AI tools, privacy-preserving, lightweight, and must never fabricate activity.

## Review the whole owned codebase

Review all first-party runtime frontend files in `resources/js/` (except generated Neutralino vendor client), `resources/index.html`, styles, all files under `scripts/`, `tests/`, `neutralino.config.json`, `package.json`, `runtime-lock.json`, `.github/workflows/ci.yml`, `.gitignore`, `.gitattributes`, the CMD wrappers, and package/install/uninstall code. Inspect release package code/configuration where needed, but do not treat generated binaries or `node_modules` as hand-authored source.

## Stage 7 remediation claims to verify

1. `waiting_owner` must remain visible and not turn stale/unknown until an explicit resolving event; a generic later event or adapter disconnect must not erase it.
2. NDJSON inbox reads must be bounded and incremental, recover safely from rotation/truncation, reject malformed/oversized input without surfacing raw content, and have all required Neutralino permissions.
3. There must be a safe single-instance guard: no duplicate overlay races, no broad deletion, a crashed owner can be recovered without a permanent lock, and the manual-minimize DND behavior remains intact.
4. Existing-work snapshot must work in the shipped Windows package without assuming a user-installed Node. It must prefer the verified packaged runtime and degrade truthfully to live events if unavailable.
5. Hook installation must serialize singleton groups/commands as JSON arrays. Subagent stop must not become `agent_finished` without explicit success evidence; failed/cancelled outcomes must not be painted as success. Relay retries must remain fail-open and private.
6. Install/uninstall must have compatible, narrow ownership boundaries and not remove arbitrary custom paths or unrelated shortcuts.
7. CI/release must not use an unconstrained `neu update`; Neutralino runtime/client and portable Node must be version/hash pinned, CI/local packaging should verify the actual ZIP, and GitHub Actions must be immutable pins.
8. Gemini hook timeout is intentionally 5000 milliseconds, verified against Gemini CLI's official hook schema. Ensure code/doc/tests make the unit unambiguous rather than converting it to seconds.
9. Check for regressions in privacy, clean-room visuals, resource limits, no background model calls, no fake mouse click-through claims, and no raw prompt/transcript/session data persistence.

## Evidence already observed by the implementer (verify, do not trust blindly)

- `cmd /c npm test`: 50/50 passed.
- full package script passed tests, static checks, 8-hour virtual soak, pinned runtime preparation, ZIP extraction manifest verification.
- current package is `release/AI-Office-Dollhouse-v0.2.0-win-x64.zip`.

## Required response structure

1. `VERDICT: PASS`, `CONDITIONAL PASS`, or `FAIL`.
2. State whether each Stage 7 MUST-FIX is actually remediated.
3. Findings separated into MUST-FIX / SHOULD-FIX / NIT, each with exact `file:line` evidence and a concrete reproduction or reasoning path.
4. Identify any unverified runtime-only behavior honestly.
5. Finish with a short release recommendation.

