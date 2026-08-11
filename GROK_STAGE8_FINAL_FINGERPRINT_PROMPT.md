# Grok Stage 8 final fingerprint closure (read-only)

Inspect only the final delta in `resources/js/discovery.js` and `tests/discovery.test.mjs`. Do not modify files, install anything, browse, access credentials, or invoke subagents.

The prior follow-up noted that a fully read event file may have a final tail segment shorter than 512 bytes, while the identity probe read a fixed 512 bytes. The implementation now stores the byte count in `tailFingerprint`, derives it via `fingerprintByteCount()`, and probes exactly that byte count. The added regression test appends a normal event after a short final chunk.

Check whether this closes the false-replacement case without weakening detection of a same-metadata larger archive replacement, truncation, partial NDJSON, or bounded reads. You may run `node --test tests/discovery.test.mjs`.

Return exactly one verdict line (`VERDICT: PASS`, `CONDITIONAL PASS`, or `FAIL`) followed by only MUST-FIX / SHOULD-FIX / NIT findings with `file:line` evidence. State whether final release packaging may proceed.
