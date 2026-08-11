# AI Office Dollhouse V2 — Art Direction and IP Boundary Review

You are an external art director and adversarial IP-risk reviewer. You are not the Owner and not legal counsel. Review before implementation; do not edit files, run code, or broaden scope.

## Owner correction

The current UI is rejected as visually ugly. It uses crude low-resolution blocks and generic rounded rectangles. The quality bar is now:

- at minimum, the charm and readability of a modular construction-toy scene or a childhood RPG town/office;
- original characters with recognizable silhouettes, roles, movement, furniture, and room personality;
- independent floating desktop rooms/windows for Owner, Codex, Claude, Gemini, Grok, existing-work lobby, and a compact controller;
- clean enough to watch for hours without looking like an engineering placeholder;
- low resource use on a Windows laptop;
- no copied sprites, logos, fonts, sound, screenshots, README wording, proprietary character silhouettes, or recognizable game asset language.

The user mentioned LEGO only as a quality/composability reference. The product must NOT imitate LEGO minifigure geometry, stud patterns, logos, packaging language, signature parts, or trade dress. The user mentioned childhood RPG games only as a mood/readability reference. The product must NOT copy Pokémon, MapleStory, Stardew Valley, Habbo, RPG Maker defaults, or any named game's sprites, palette, tiles, UI frames, proportions, animations, maps, or iconography.

## Proposed clean-room direction to challenge

Working label: **Clockwork Office RPG**.

- Original 24×32 or 32×40 logical-pixel characters, rendered crisply at integer scale.
- Toy-like modular body parts, but no cylindrical minifigure head, C-shaped hands, studded bricks, or yellow-plastic default.
- 3/4 top-down RPG room view with inked 1–2 px outlines, selective highlights, and a restrained custom palette.
- Four original body families: cloth doll, tin robot, wooden animal, office adventurer.
- Four-frame walk, two-frame work, report/knock/wait/meeting/celebrate/failure micro-animations.
- Furniture uses original asymmetric silhouettes and toy-workshop construction rather than copied isometric tiles.
- Provider identity uses custom room themes and text labels only, never company logos or signature brand gradients.
- Ultra-low mode replaces filled sprites with simplified line silhouettes.

## Required review

1. Give a bottom-line verdict: `APPROVE_DIRECTION`, `APPROVE_WITH_CHANGES`, or `REJECT_DIRECTION`.
2. Explain why the current crude-block approach fails aesthetically and what measurable quality threshold replaces it.
3. Produce a clean-room visual system with exact recommendations for:
   - logical sprite size and integer scaling;
   - head/body/limb proportions that avoid known toy/game character signatures;
   - outline thickness, shading levels, palette size, and contrast;
   - furniture perspective and room composition;
   - animation frames and timing;
   - idle density suitable for long-running desktop viewing.
4. Make an IP/trade-dress risk matrix with `GREEN`, `YELLOW`, and `RED` examples. Separate copyright, trademark/logo, and trade-dress concerns. Do not claim legal certainty.
5. Define a seven-part master acceptance checklist that every independently reviewed room must pass:
   - Owner/decision room;
   - Codex room;
   - Claude room;
   - Gemini room;
   - Grok room;
   - existing-work lobby;
   - compact controller.
6. Recommend how each Provider room can feel distinct without copying its brand identity.
7. Identify any risk or aesthetic flaw in the proposed **Clockwork Office RPG** direction and give exact corrections.
8. End with a concise specification named `MASTER_ART_BASELINE_V2` that another reviewer can apply mechanically to each room.

Answer in Traditional Chinese. Be specific, skeptical, and implementation-ready. Do not spend tokens praising the idea.
