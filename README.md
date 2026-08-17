# AI Office Dollhouse

[![Latest release](https://img.shields.io/github/v/release/leavemagic-cyber/ai-office-dollhouse?display_name=tag)](https://github.com/leavemagic-cyber/ai-office-dollhouse/releases/latest)
[![Windows CI](https://github.com/leavemagic-cyber/ai-office-dollhouse/actions/workflows/ci.yml/badge.svg)](https://github.com/leavemagic-cyber/ai-office-dollhouse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-2f855a.svg)](LICENSE)

**See what your coding agents are actually doing without reading another log.**

AI Office Dollhouse is a privacy-first Windows desktop overlay for local Codex, Claude, Gemini, and Grok sessions. It turns real lifecycle evidence into a compact animated office, so you can spot active work, waiting tasks, subagents, discussions, and completions at a glance.

<p align="center">
  <img src="docs/images/overview.png" alt="AI Office Dollhouse showing live coding-agent sessions across several office floors" width="340">
</p>

<p align="center"><em>Current v0.3.9 desktop view. Every visible worker and state comes from observed local evidence.</em></p>

<p align="center">
  <a href="https://github.com/leavemagic-cyber/ai-office-dollhouse/releases/latest"><strong>Download for Windows</strong></a>
  ·
  <a href="#install-on-windows">Installation</a>
  ·
  <a href="docs/PRIVACY.md">Privacy</a>
</p>

## Why use it

- Follow several agent sessions without switching windows or reading terminal output
- See when work is active, waiting for you, discussing, completed, or cancelled
- Keep a small always-on-top office in a corner of the desktop
- Use full motion, reduced motion, do-not-disturb, or important-events-only mode
- Observe local activity without sending prompts, responses, commands, or credentials anywhere

The app does not start agents, dispatch tasks, call a model, or spend tokens. An open process alone never makes a worker appear busy: active and completed states require lifecycle evidence.

## Install on Windows

AI Office Dollhouse supports Windows 10 and 11 on x64 systems and requires Microsoft Edge WebView2 Runtime.

1. Open the [latest release](https://github.com/leavemagic-cyber/ai-office-dollhouse/releases/latest).
2. Download `AI-Office-Dollhouse-*-win-x64.zip`.
3. Extract the complete archive.
4. Run `Install-AI-Office-Dollhouse.cmd`.
5. Open **AI Office Dollhouse** from the desktop or Start menu.

The installer uses `%LOCALAPPDATA%\Programs\AI Office Dollhouse`, backs up existing provider settings, and merges only this project's lifecycle hooks. Existing unrelated hooks are preserved. For full Codex lifecycle events, open `/hooks` in Codex and review the AI Office Dollhouse hook through the normal trust flow; the read-only local session observer remains available as a fallback.

To remove the app, close it and run `Uninstall-AI-Office-Dollhouse.cmd`. The uninstaller removes this project's hooks, relay, shortcuts, and program files without restoring stale backups over newer settings.

## What it shows

- A permanent Owner area and dynamically allocated project floors
- Runtime-selected supervisors, active workers, and recently finished workers
- Separate sessions instead of a fabricated provider hierarchy
- Local everyday motion while real work is live, with evidence-backed special actions for requests, handoffs, reviews, and completions
- Click-through drawing areas, DPI awareness, and automatic resource-pressure fallback

## Provider support

| Provider | Evidence source |
|---|---|
| Codex | User-level lifecycle hook plus a bounded, read-only local session fallback |
| Claude | Session and subagent lifecycle hooks |
| Gemini | Session and agent lifecycle hooks |
| Grok | Session and subagent lifecycle hooks |

Provider integrations are evidence adapters, not model integrations. Read [Provider integrations](docs/INTEGRATIONS.md) for the exact event contract and trust boundaries.

## Privacy by design

The local event store may contain hashed session and agent identifiers, provider names, event types, tool names, and only the final segment of a working directory. It never stores prompts, model responses, transcript content, full paths, command lines, account details, tokens, API keys, or environment secrets.

The app makes no model API calls, sends no telemetry, and does not control external agent processes. Read the complete [privacy boundary](docs/PRIVACY.md) and [security policy](SECURITY.md).

## Run from source

Node.js 22 or newer is required.

```powershell
npm.cmd ci
npm.cmd run start
```

Run the complete verification and Windows packaging flow with:

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run test:soak
npm.cmd run package:win
```

## Documentation

- [Architecture and display truth](docs/ARCHITECTURE.md)
- [Testing and performance](docs/TESTING.md)
- [Provider integrations](docs/INTEGRATIONS.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Security policy](SECURITY.md)

## Contributing

Issues and pull requests are welcome when they preserve the read-only observer model and privacy boundary. Start with [CONTRIBUTING.md](CONTRIBUTING.md). If the project is useful to you, starring the repository or sharing a real use case helps other coding-agent users find it.

## License and names

The source code is available under the [MIT License](LICENSE). All code, artwork, icons, and text in this repository were created independently. Codex, Claude, Gemini, and Grok are mentioned only to describe compatible interfaces; this project is not affiliated with or endorsed by their providers and includes none of their logos, characters, or branded artwork.
