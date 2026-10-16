# CLAUDE.md — Time-Loop Contract (working title)

These are the standing rules from the product director. Re-read them at the
start of every session. Check every decision against THE AIM.

## Role and working style
- Claude is the sole engineer, technical artist and game designer.
- The director works at product level only: never writes code, runs
  terminals or uses an editor. Claude installs, builds, tests, verifies
  visually and fixes everything itself.
- Only interrupt the director at the CHECKPOINTS below. Make sensible
  decisions and log them in `DECISIONS.md`. If truly blocked, ask for the one
  specific thing needed.
- The director plays on a phone, with no terminal. Keep README short.

## The aim
A replayable, easy-to-learn first-person puzzle-action browser game whose
visuals match the best-looking 3D browser games (look reference only; no
portal size limits). A new player understands the core idea within 60 s and
never feels punished or confused. Tie-breakers, in order:
1. instantly readable  2. beautiful at a glance  3. smooth to run
4. many approaches viable.

## Concept
- Player is a "fixer" stuck repeating one evening: New Year's Eve gala at an
  art-deco manor. Loop = 6 PM → midnight game time, ~8–10 real minutes.
- Guests and staff follow fixed schedules. Each loop the player learns
  secrets, fills an intel board, tries to complete a Contract.
- Failure is never harsh: witty one-liner, restart in < 5 s.
- Tone: grim-but-witty, dry banter. No gore, horror or sexual content.
  "Eliminations" are stylized comic accidents or knockouts, never bloody.

## Camera and controls
- First-person only.
- Desktop: WASD, mouse look, E interact, Shift sprint, Q/F use item,
  Tab intel board. Handle pointer lock gracefully.
- Touch: left virtual stick, right-side look, one big context button, one
  item button. Gamepad optional.

## Not stealth-only (hard rule)
Every Contract solvable at least 4 ways:
- Quiet: disguise, distraction, timing
- Social: persuasion or blackmail using collected intel
- Loud: brawl/chase with improvised weapons; being spotted is NOT an instant
  fail, it triggers a chase/brawl
- Chaos: sabotage (lights, fire alarm, fireworks, chandelier drop)
Awareness = simple 3-state icon above NPC heads (calm / suspicious /
alarmed). No stealth meters, no line-of-sight puzzles.

## Easy to learn
Loop 1 is a guided "just watch and explore" loop. Intel board fills
automatically. A "Lead" pins the next suggested clue. Free hint button always
available. Contracts show a simple checklist. Short text; teach by doing.

## Core systems (data-driven, deterministic)
- World clock + NPC schedules: NPC position/animation is a pure function of
  game time from JSON schedules → loops exactly reproducible. Player actions
  set flags / trigger events that branch outcomes. Navmesh only for
  deviations (chase, flee).
- Intel board: clues, schedules, secrets, keys; links between clues.
- Contracts: JSON-defined objectives, approaches, rewards.
- Meta progression: "memory points" spent on perks between loops.
- Loop manager: snapshot/reset; persist intel + perks via a storage adapter
  (localStorage).

## Scope
- Vertical slice first: ONE finished wing (ballroom, study, kitchen,
  balcony), ~10 NPCs, 3 Contracts × 4 approaches, ~15 intel items, 2 perks.
- Expand only after the slice passes the quality gates.
- Final target: whole manor (3 floors + grounds), 8–10 Contracts, 30+ hours.

## Tech stack (decided — do not re-debate)
Babylon.js 9.x + TypeScript + Vite. Havok physics (WASM). Recast navmesh
plugin. Babylon GUI or HTML overlay for HUD (whichever is crisper/simpler).
glTF/GLB with meshopt or Draco, KTX2 textures. WebGPU when available, WebGL2
fallback.

## Graphics target
- Polished premium stylized 3D, not a tech demo. Stylized semi-real, warm
  art-deco palette (gold, emerald, deep burgundy); palette file in
  `src/art/palette.ts` — stick to it.
- Spend bytes where they show (up to 2K textures up close, hero props).
- Lighting: HDRI IBL, several shadow-casting key lights, many cheap
  non-shadow lights + emissives, baked AO or SSAO, ACES, bloom, vignette,
  grading, AA, depth fog, light shafts, SSR / reflection probes.
- PBR, trim sheets, tiling detail maps.
- Quality presets Low/Medium/High, auto-selected by frame-time probe,
  changeable in settings.
- Perf: High 60 fps on MacBook Air M2 class; Low 30+ fps on mid-range phone.
  Instancing, thin instances, merged statics, frozen materials, per-room
  culling, LOD.
- Clean loading screen, first room playable fast, stream the rest. Report
  bundle size each milestone (informational).

## Assets
- ONLY CC0/public-domain or self-generated (Kenney, Quaternius, Poly Haven,
  ambientCG, CC0 audio). Download them yourself. On failure, build
  primitives with good materials and tell the director.
- Never Mixamo, store packs, non-CC0 Sketchfab.
- Log every asset in `CREDITS.md` with licence and URL.
- Manor built from a modular kit assembled from a JSON level layout.

## Self-verification (Claude is the tester)
- Dev server + headless Chromium (Playwright) screenshots from preset camera
  spots in every room → `/screenshots/`. Look at them; fix anything flat,
  dark, noisy, clipped or broken.
- Test harness: scripted bot completes every Contract via every approach.
  `npm test` must pass.
- Fail the build on any console error.
- Report relative frame time per preset every milestone.
- Never claim something works without having run it.

## Checkpoints (the ONLY times to stop and ask)
1. Graphics benchmark: one finished room, final lighting, 3–4 screenshots,
   playable preview link. Director approves look on own device. If premium
   bar is unreachable in this engine, say exactly what falls short and the
   cost of switching, then wait.
2. Vertical slice complete: playable link + short list of what to judge.
3. Before major new scope, any paid service or any account.

## Delivery
Static preview (GitHub Pages) so every push gives a playable URL. If the
director must do one thing, give exact steps in one short message.

## Project conventions (Claude-maintained)
- `npm run dev` dev server · `npm run build` production build ·
  `npm run shots` Playwright screenshots · `npm test` test harness.
- Assets fetched by `scripts/fetch-assets.mjs` into `public/assets/`.
