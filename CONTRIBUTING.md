# Contributing

Contributions should preserve these non-negotiable boundaries:

- clean-room visuals only; no copied sprites, audio, fonts, logos, screenshots, or README text;
- no prompt, response, transcript, secret, full command line, or raw session ID persistence;
- presence is never displayed as active work;
- process exit is never treated as task completion;
- no network model calls or background token use;
- hook changes require explicit user confirmation and must fail open;
- resource collections remain bounded and hidden windows do no rendering.

Run `npm test`, `npm run check`, and `npm run test:soak` before opening a pull request. Keep provider-specific event mappings supported by primary documentation and add a regression test for every truth-model change.
