# Grok Stage 8 — Remediation Review

Date: 2026-08-10  
Review mode: independent read-only working-tree review; no installer, credential, web, subagent, or project-file write by Grok.

## Invocation and independent evidence

```text
cmd /c grok --prompt-file "GROK_STAGE8_REMEDIATION_REVIEW_PROMPT.md" --no-plan --permission-mode dontAsk --sandbox read-only --no-subagents --disable-web-search --no-memory --output-format plain
```

Grok independently ran `cmd /c npm test`: **50/50 passed** at review time.

## Verdict

**PASS.** Grok found every Stage 7 MUST-FIX and the listed remediation claims implemented in first-party source, covered by tests and/or package evidence. It found no remaining release-blocking contract break for `v0.2.0`.

## Stage 7 remediation status

| Stage 7 concern | Grok conclusion |
|---|---|
| Owner request must survive stale state | Remediated |
| Bounded incremental event inbox | Remediated |
| Single-instance safety and minimize DND | Remediated |
| Packaged snapshot without system Node | Remediated |
| Hook JSON arrays and truthful subagent terminal state | Remediated |
| Narrow install/uninstall ownership | Remediated |
| Pinned CI/release supply chain | Remediated |
| Gemini `5000` timeout unit | Remediated as milliseconds |
| Privacy / clean-room / resource / no-model-call boundaries | No regression found |

## Grok findings at review time

### MUST-FIX

None.

### SHOULD-FIX

1. `resources/js/discovery.js:217-220`: an archive replacement that is larger than its predecessor could theoretically keep the old cursor if its creation time is unavailable/equal. Suggested bounded identity token/content fingerprint.
2. `scripts/relay/AIOfficeHookRelay.cs:153-165` and `scripts/hook-relay.ps1:62-63`: cancellation/stopped was no longer painted as success but still used the red failure representation; a neutral terminal state was optional polish.

### NIT

1. `docs/TESTING.md:12` said 40 tests while the reviewed suite had 50.
2. Installer/uninstaller path allowlists were clear in source but lacked automated regression tests.
3. A markerless `instance.lock` can wait up to 45 seconds before recovery; this is deliberate creation-race protection, while a dead PID with `owner.json` recovers immediately.

## Runtime limitations recorded by Grok

Not re-exercised in this static/review pass: multi-monitor/high-DPI placement, live dual-launch race, first install on a no-system-Node computer, packaged EXE plus real provider hook sequence, and the full 8-hour/package job during this particular review. These were not treated as defects; the implementation and release gates were inspected.

## Review recommendation

Grok recommended shipping `AI-Office-Dollhouse-v0.2.0-win-x64.zip`, with the two SHOULD items above as optional follow-up hardening.

## Post-review remediation note

The implementation team subsequently addressed both SHOULD items before the final rebuild:

- `EventInboxReader` now compares a bounded end-of-file fingerprint when a fully read file grows without a reliable identity-metadata change; `tests/discovery.test.mjs` covers larger same-metadata replacement.
- Explicit subagent cancellation now maps to `agent_cancelled`, rendered as neutral metal rather than success or red failure, with C#/PowerShell relay and model/choreography tests.
- `docs/TESTING.md` now records the final 56-test suite, including serialized complete shared-model replacement, short-tail append identity protection, and installer/uninstaller rejection of arbitrary roots before touching them.
