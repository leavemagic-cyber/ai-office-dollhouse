# Grok Stage 7 — Supplemental CI and Supply-Chain Review

Date: 2026-08-10  
Review mode: read-only supplemental review. No project files were changed by Grok.

## Scope and invocation

Supplemental command:

```text
cmd /c grok --prompt-file "GROK_STAGE7_SUPPLEMENTAL_CI_SUPPLY_CHAIN_REVIEW_PROMPT.md" --permission-mode plan --no-subagents --disable-web-search --no-memory --output-format plain
```

Files reviewed: `.github/workflows/ci.yml`, `package-lock.json`, `.gitignore`, `.gitattributes`, `package.json`, `scripts/package-release.ps1`, `scripts/build-relay.ps1`, and `scripts/check-project.mjs`.

## Verdict

**CONDITIONAL PASS.** This review supplements the main Stage 7 verdict and adds one release/supply-chain MUST-FIX. The main overall verdict remains conditional.

## MUST-FIX

### 1. CI downloads and overwrites the Neutralino runtime outside the lockfile

Evidence: `.github/workflows/ci.yml:26-27`.

`npx neu update` fetches and replaces the Neutralino runtime during CI. That binary/runtime fetch is not pinned by `package-lock.json` resolution and integrity data, so a CI build can change with upstream/network state. This prevents a reproducible, fully locked release chain.

Recommended repair: pin and verify the Neutralino runtime artifact (version plus hash), or make the build consume an already pinned/verified runtime artifact instead of performing an unconstrained update during CI.

## SHOULD-FIX

### 2. Pin GitHub Actions by immutable commit SHA

Evidence: `.github/workflows/ci.yml:17-19`.

`actions/checkout@v7` and `actions/setup-node@v7` float by major tag. Pin the exact trusted commit SHA and record the update process.

### 3. Make CI and the local release path prove the same artifact chain

Evidence: `.github/workflows/ci.yml:24-35`; `scripts/package-release.ps1:15-24`.

CI runs `npm ci`, `neu update`, test/check/soak, then `npm build`. The local release path builds the relay, runs the same quality checks, then runs `neu build --release`; it does not run `npm ci` or `neu update`, and CI does not produce/review the final ZIP and SHA. Align the pipelines and verify the packaged artifact that users receive.

### 4. Acknowledge/contain npm install scripts in the dev dependency chain

Evidence: `package-lock.json:139,317,920`.

The lockfile is version-3 and records exact resolved URLs/integrity values, including the declared exact `@neutralinojs/neu` version `11.7.2`. However, `bufferutil`, `es5-ext`, and `utf-8-validate` carry `hasInstallScript`; CI `npm ci` executes the locked dependency scripts from a pull-request code path. Keep this risk consciously documented and constrained.

### 5. Harden repository hygiene rules

Evidence: `.gitignore`; `.gitattributes:1-12`.

Build/runtime output is ignored, increasing reliance on network-installed runtime content. Add sensible secret-key exclusions such as `.env`, `*.pem`, and `*.key` where appropriate for this repository. Explicitly set line-ending handling for shipped `.cmd` files to avoid release drift on Windows.

## Positive observations / boundaries

- The workflow uses `permissions: contents: read` and does not use `pull_request_target` or repository secrets in the reviewed workflow, which materially reduces PR-execution exposure.
- `package-lock.json` does pin JavaScript package resolutions and integrity values; the concern is the separately updated Neutralino runtime, not a missing npm lockfile.
- The observed `glob@7` item is a development dependency; it does not itself show a production runtime dependency issue in this review.

## Required validation after repair

- Demonstrate that CI and local release package the same pinned Neutralino runtime.
- Verify the final ZIP and SHA produced by CI or a reproducible release job, not merely the source build.
- Re-run the main Stage 7 tests/focused cases after any changes to the release path.

See the product/runtime review: `GROK_STAGE7_FULL_CODE_REVIEW_20260810.md`.
