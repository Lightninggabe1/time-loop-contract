# CLAUDE.md — One Minute to Midnight (working title)

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

## Concept (revamped 2026-10-25, see `CONTENT_PLAN.md`)
- Player is a "fixer" pulling heists at a New Year's Eve gala in an art-deco
  manor. Each heist is ONE real minute: 23:59 → midnight.
- Every round adds an **echo**: a ghost of the player that replays an earlier
  round exactly. Round N = you + up to N-1 echoes, so every attempt builds on
  the last until the crew pulls it off together. Each heist caps its echoes.
- Guards and guests follow fixed 60 s routines. Echoes stall ("?") when their
  recorded action is now impossible; anyone a guard catches is out for the round.
- A campaign of ~8 heists across a much bigger manor, easiest first; stars for
  doing it with fewer echoes / faster.
- Failure is never harsh: witty one-liner, restart in < 2 s.
- Tone: grim-but-witty, dry banter. No gore, horror or sexual content.
  "Eliminations" are stylized comic accidents or knockouts, never bloody.

## Camera and controls
- First-person only.
- Desktop: WASD, mouse look, E interact, Shift sprint, F punch, Q rewind
  (end the round now). Handle pointer lock gracefully.
- Touch: left virtual stick, right-side look, one big context button, one
  rewind button. Gamepad optional.

## Not stealth-only (hard rule)
Every heist (after the one-idea tutorial) solvable at least 4 ways:
- Quiet: disguise, distraction, timing
- Social: chat up a guard so he watches you, not your crew
- Loud: brawl/chase with improvised weapons; being spotted is NOT an instant
  fail, it triggers a chase/brawl
- Chaos: sabotage (lights, fire bell, fireworks, chandelier drop)
Awareness = simple 3-state icon above NPC heads (calm / suspicious /
alarmed). No stealth meters, no line-of-sight puzzles.

## Easy to learn
Heist 1 teaches the one idea by doing (a door held open by a plate: round 1
you hold it, round 2 your echo does). Free hint button always available. The
HUD shows the goal in a few words, the timer and the crew. Short text.

## Core systems (data-driven, deterministic)
- `src/core/heist/`, pure TypeScript, no Babylon: fixed 30 Hz round sim.
  Same echo tracks + same player = same round, always.
- Recording: the player's pose every tick + actions with their tick → Track.
  Echoes replay tracks kinematically and fire actions at the same ticks.
- Guards: patrol loops (pure function of time) on the waypoint graph; perceive
  in a cone, chase, catch, give up. Guests witness and shout.
- Gadgets: doors, plates, safes, noise, blackout, announcements, chandelier,
  bell, loot, keys. Heists are JSON (`src/content/heists/`) incl. scripted bot
  plans per approach.
- Crew + stars persisted via the storage adapter (localStorage).

## Scope
- R1: echo core + heists 1–3 in the existing rooms → checkpoint ("is the echo
  idea fun and clear?").
- Then: bigger manor (cellar, conservatory + grounds, upper floor, more
  rooms), heists 4–8, polish. Final: whole manor (3 floors + grounds).

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
- Test harness: scripted bot wins every heist via every approach, and no
  heist (after the tutorial) can be won without echoes.
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
