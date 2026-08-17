## Summary

Describe the user-visible change and why it is needed.

## Validation

- [ ] `npm.cmd test`
- [ ] `npm.cmd run check`
- [ ] `npm.cmd run test:soak` when runtime or event handling changed

## Observer boundary

- [ ] No prompts, responses, transcripts, secrets, full command lines, or raw session identifiers are persisted
- [ ] No model calls or background token use were added
- [ ] Displayed work and completion states remain backed by structured lifecycle evidence
