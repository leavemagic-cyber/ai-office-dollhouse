# Contributing

Contributions are welcome when they preserve the observer model and its privacy boundary.

- Use original visuals and text, without copied sprites, audio, fonts, logos or screenshots
- Never persist prompts, responses, transcripts, secrets, full command lines or raw session IDs
- Do not present presence or process exit as proof of active work or completion
- Keep model calls and background token use out of the application
- Preserve unrelated hooks, back up changed settings and keep hook failures fail-open
- Keep resource collections bounded and stop rendering hidden Canvas elements

Run the full validation before opening a pull request:

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run test:soak
```

Provider event changes should cite primary documentation and include a regression test for the truth-model behavior they affect.
