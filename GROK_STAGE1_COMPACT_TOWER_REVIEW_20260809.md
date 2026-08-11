# Grok Stage 1 Review — Compact Vertical Tower

Date: 2026-08-09  
Scope: narrow single-window tower, 2.5D direction, motion readability, performance modes  
Verdict: **CHANGE**

## Grok required changes

1. Use a 272 CSS px target width, allow 256–288, and keep a hard upper bound near 18% of the Windows work area.
2. Use a 32 px top bar, 20 px footer, 24 px collapsed floor, and 156 px normal expanded floor (24 + 114 + 18). A crowded multi-pod floor may grow to 174 px.
3. Stop requestAnimationFrame for collapsed, off-screen, minimized, or hidden floors. Resume from current state without replaying missed movement.
4. Use a consistent 2.5D six-part drawing contract: light slanted top, darker side, mid-tone front, contact shadow, cast shadow, and warm dark outline.
5. In normal/full mode, do not limit the building to one moving character. Allow up to four seated detail loops and two moving characters per visible active floor, with up to two global signature performances. Reduce concurrency and FPS only under pressure or low-motion modes; do not remove 2.5D form or transition quality.
6. Implement five detailed loops with anticipation, main action, and recovery: typing, document research, whiteboard work, desk-to-desk delivery, and manager rounds.
7. Implement a right-edge elevator shaft and four cross-floor MVP sequences: travel, three-knock Owner request and queue, delivery to inbox, and subagent arrival with a box.
8. Differentiate providers only with original functional furniture and text labels, not official logos, gradients, mascots, or identifying palettes.

## Owner-plan disposition

- **Accepted:** compact dimensions, single tower, expanded/collapsed heights, off-screen render suspension, detailed 2.5D form rules, full-mode multi-character animation, elevator sequences, and functional non-branded room identity.
- **Clarified:** the 272 px target is applied on this 150% DPI Windows machine through a 408 native-pixel window request and verified at final desktop acceptance.
- **Rejected in part:** Grok suggested that snapshots should never auto-expand. The Owner plan is authoritative: a clearly recent local snapshot may create a visibly snapshot-labelled doll and may auto-expand; stale records remain archive cards and presence-only never creates workers.
- **Final Stage 1 gate:** After obsolete child-window HTML, routes and `window.create` code were removed, Grok reviewed consolidated exact source evidence and returned `VERDICT: PASS`. The gate verified one-window routing, floor order, 408 native/272 CSS target, 24/156/174 sizing, recent-snapshot truth rules, off-screen/hidden rAF cancellation, minimal controls, and automatic startup discovery.
