# AI Office Dollhouse V2 — Stage 5 Owner visual-correction review

You are an external aesthetic/IP/implementation reviewer. The Owner explicitly rejected the previous scene because it lacked depth, the people and props were too large, the scene was not readable at a glance, and the character design was strongly disliked. Review only the correction described below. Do not invent unrelated product changes.

## Binding product context

- Independent narrow Windows desktop tower at the left, at most one fifth of the work area.
- Original code-drawn Canvas 2.5D. No external sprites, images, sound, logos, brand palettes, copied trade dress, or branded toy/game silhouettes.
- Provider floors remain vertical; current people should first fit in one floor, and a new annex is allowed only after real capacity is exceeded.
- Old records and process presence alone must not invent live workers.
- The Owner is the final authority; you are an advisor.

## Implemented correction to assess

1. `PEOPLE_PER_ANNEX` changed from 7 to 14. Up to fourteen small figures use two depth-sorted rows of seven; only the 15th visible person creates another floor.
2. Historical Tier-A hook surfaces no longer keep unknown teams or empty annexes visible. Only a fresh, currently open Tier-D presence may freeze unknown live workers.
3. The room is now a cutaway 2.5D box: outlined back-wall plane, darker right return wall, trapezoid floor, separate front and side fascia, converging floor grid, trim depth, contact/cast shadows.
4. All functional furniture is rendered at 70% of the previous scale using the same top/front/side surface grammar. The elevator was narrowed from 11 to 7 logical pixels.
5. The old dolls were fully redrawn, not merely scaled: approximate height is now 22–24 logical pixels instead of about 42; head width is about 7–8 instead of 10–11; torso, visible neck, separated short legs, wide shoes, small wedge arms/hands, contact shadow and cast shadow remain.
6. Four original material families remain but have new compact silhouettes: small visor-and-antenna tin robot, small-eared wood animal, seam-capped cloth toy, and short-brim office adventurer. Human-like faces now use only two small eye dots; the large mouth was removed.
7. Carried paper, keyboard, card, box and briefcase props were reduced substantially. Session truth tags moved from large hovering plaques above heads to tiny foot-level plaques.
8. Eight or more people get a taller 132 px Canvas and front/back rows; seven or fewer keep 114 px. Figures remain small rather than growing with the room.
9. Tests: 36/36 pass. Project check: 77 files, 16 JavaScript files, zero audio assets, runtime logging disabled.

## Files in review scope

- `resources/js/renderer.js`
- `resources/js/floor-layout.js`
- `resources/js/main.js`
- `resources/js/domain.js`
- `resources/styles.css`
- `tests/floor-layout.test.mjs`
- `tests/domain.test.mjs`
- `AI_OFFICE_DOLLHOUSE_V2_OWNER_GOAL_PLAN.md`

## Required review output

Return exactly these headings:

1. `VERDICT: PASS` or `VERDICT: MUST-FIX`
2. `OWNER COMPLAINT COVERAGE`
3. `2.5D DEPTH AND ONE-GLANCE READABILITY`
4. `CHARACTER SILHOUETTE AND SCALE`
5. `CAPACITY AND TRUTHFULNESS`
6. `IP / TRADE-DRESS RISK`
7. `MUST-FIX ITEMS`
8. `OPTIONAL POLISH`

Use MUST-FIX only for concrete defects that block the Owner's stated correction or create material IP/truthfulness risk. The later real desktop screenshot remains a separate final visual gate; do not claim screenshot verification here.
