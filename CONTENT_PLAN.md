# CONTENT PLAN — One Minute to Midnight (echo heists)

Status: **approved by the director (2026-10-25)**. Replaces the time-loop mystery plan (retired). Being built in the order of section 5.

## Context
The director wants to turn Mansion from a 9-minute time-loop mystery into a
**one-minute heist game where every round adds an echo**: the actions you took
last round replay as a ghost of yourself, so each attempt builds on the last
until your crew of past selves pulls the job off together.

Decisions from the director (2026-10-25):
- **Growing crew of echoes.** Round N = you + up to N-1 echoes, each replaying
  one earlier round exactly.
- **A series of ~8 heists**, each a 60 s puzzle with its own echo cap, easy first.
- **Keep the manor and the 12-person cast** (as guards, guests, witnesses).
  Retire the 9 contracts, intel board, talk trees and the Hobbs mystery.
- **Setting stays (art-deco NYE manor), but much bigger.**

No overarching story is written (standing rule: plot only on request). Heists
get one-line flavour only.

What we keep: the whole tech/art stack — kit + JSON layouts, streaming, lighting,
quality presets, characters/retargeting, player controller, touch input, HUD
shell, audio, Playwright shots, GitHub Pages deploy.

---

## 1. Core game rules

**The round.** 60 real seconds: 23:59:00 → midnight. The tower clock bells at
the end; if you've won, fireworks. Restart is instant (< 2 s, no reload).

**Recording.** The sim runs at a fixed 30 Hz tick. Every tick records the
player's position + yaw; every action (use, pick up, drop, throw, punch,
hold-start/hold-end, talk) is recorded with its tick. ~1,800 samples per round,
tiny in memory/localStorage.

**Echoes.** Each saved round becomes an echo: a tinted, numbered ghost of the
fixer that follows its track kinematically (no physics drift) and fires its
recorded actions at the same ticks. Same tracks + same player = identical
outcome, every time.

**Causality, simply.** The world reacts to echoes like it reacts to you:
- An echo's action **fails if it's now impossible** (door locked, item already
  taken). The echo gets a "?" and **stalls in place** for the rest of the round
  — visible, readable, no paradox screens.
- A guard who **catches** a body (you or an echo) takes it out of the round.
  Protecting your echoes (distract, block, open a route) is the puzzle.
- Being spotted is never an instant fail. It starts a chase. Awareness stays a
  3-state icon (calm / suspicious / alarmed). No stealth meters.

**Win.** Loot reaches the exit (getaway car, dumbwaiter, balcony rope…) before
midnight, carried by anyone. Stars: ★ done · ★★ with ≤ par echoes ·
★★★ bonus loot or a time target. Stars unlock heists. Replacing old
memory points/perks.

**Between rounds (Crew card, 1 tap):** "Go again" (keeps this round as a new
echo) · "Redo last" (throws it away) · tap an echo chip to drop or re-record
it. Cap reached → you must pick one to overwrite. Ending a round early is
allowed (button / R); the echo then idles from that point.

**Heist toolkit (all deterministic, data-driven):** doors & locks, keys that
can be dropped and picked up by another body, levers/pressure plates that only
hold while occupied, safes with a hold-to-crack timer (shortened if two crack
together), light switches/fuse box (blackout: guards see 2 m), noise makers
(guard walks to the noise and stays N s), heavy loot (2 bodies to carry, or
slow alone), dumbwaiters/laundry chute (send an item between floors),
"chat up" a guest/guard (holds their gaze while you stay), punch (knockout
for 10 s; guard chases if seen), throwables (vase, bottle) to trip or stun.

**Four ways to win every heist (CLAUDE.md hard rule, adapted):**
Quiet (timing, a lever-holder, a decoy echo) · Social (an echo chats up the
guard while others slip past) · Loud (spotted on purpose; one echo is bait and
leads the chase away) · Chaos (blackout, fire bell, chandelier drop, fireworks).

**Learn in 60 s (heist 1 is the tutorial):** a door only stays open while its
lever is held. Round 1: you pull the lever and can't get through. The round
ends with "Need a hand? Next time, you'll have one." Round 2: your echo pulls
the lever and you walk through. One idea, taught by doing. A free hint button
shows a ghost path of a working plan, one step at a time.

---

## 2. Heist campaign (~8, easiest first)

| # | Heist | Where | Echo cap / par | New idea taught |
|---|---|---|---|---|
| 1 | The Lever Door | Ballroom → Study | 2 / 1 | echoes exist |
| 2 | The Study Safe | Study | 3 / 2 | hold-to-crack, guard patrol |
| 3 | Champagne Tower | Ballroom | 3 / 2 | chat-up, distraction |
| 4 | Lights Out | Kitchen + cellar | 4 / 3 | blackout, dumbwaiter |
| 5 | First Edition | Library (2 storeys) | 4 / 3 | key hand-off, ladders |
| 6 | The Orchid | Conservatory + grounds | 4 / 3 | bait the chase, fishpond |
| 7 | The Portrait | Upstairs gallery | 5 / 4 | heavy 2-person loot, laundry chute |
| 8 | The Vault | Cellar vault → garage | 6 / 5 | everything; spans floors |

Heists 1–3 use rooms that already exist, so the new game is playable before
the manor grows.

---

## 3. Bigger manor
Grow `wing.json` into `manor.json`, 6 rooms → ~15, via the existing kit and
nearest-first room streaming:
- **Ground floor (have):** Ballroom, Study, Kitchen, Balcony, Grand Foyer,
  Library. **Add:** Conservatory, Dining Room, Butler's Pantry, Billiard Room.
- **Upper floor (stairs already built, door locked):** Gallery landing,
  Portrait Gallery, Master Suite, Guest Corridor.
- **Cellar:** Wine Cellar, Vault.
- **Grounds:** front drive + Garage (getaway car), terrace garden with
  fishpond, fireworks launch.

Per-room budget stays as in DECISIONS (merged statics, one shadowed key spot
per room, cluster lights). Each new room gets preset camera spots for
`npm run shots`.

---

## 4. Code changes

**New, pure TS (no Babylon), in `src/core/heist/`:**
- `round.ts` — fixed-tick sim + RoundManager (start/end, restart, echo slots,
  stars, save via existing `src/core/storage.ts`). Replaces `src/core/loop.ts`.
- `track.ts` — record/replay/compress tracks; deterministic state hash.
- `echo.ts` — echo playback, action preconditions, stall/caught states.
- `guards.ts` — patrol routes as pure functions of t; alert → chase nearest
  seen body along the waypoint graph (reuse `Router` in `src/core/schedule.ts`
  so it stays Node-testable; Recast navmesh only for render smoothing).
  Witness rule reused from current session (same room, ≤ 7 m, 140° cone).
- `devices.ts` — doors, levers, plates, safes, lights, noise, chutes, loot.
- Conditions language `src/core/conditions.ts` kept for device logic.

**Content:** `src/content/heists/*.json` (spawn, exit, cap, par, guards,
devices, loot, star goals, and the scripted bot solutions per approach).
`npcs.json`/`cast.json`/`spots.json` kept and extended. Retire
`talk.json`, `intel.json`, `contracts.json`, most of `events.json`,
`src/core/intel.ts`, `src/core/contracts.ts`.

**Game layer:** rewrite `src/game/session.ts` → `src/game/heist-session.ts`
(drives the round sim, records the player). `src/game/client.ts` renders
echoes: a new "fixer" character built by the existing
`scripts/build-characters.mjs` pipeline, tinted per echo + floating number,
animated with `NpcActor` (`src/characters/npc.ts`) clips (walk/run/use/carry).
Short fading footprint trail so you can read where each echo is headed.

**HUD (`src/ui/`):** big 60 s ring timer, echo chips (colour, number, status
✓ / ? / caught), objective checklist, Restart button, the Crew card between
rounds, heist select with stars. Remove intel board/contract tracker. Touch
layout unchanged (stick, look, context button, item button + restart).

**Docs:** update CLAUDE.md "Concept", "Core systems" and "Scope" to the new
design (director-approved revamp); log choices in `DECISIONS.md`; replace
`CONTENT_PLAN.md` with the heist plan; short README.

**Housekeeping first:** commit the in-progress Faraday/Tom/Zelda character
work (cast is kept).

---

## 5. Build order and checkpoints
1. **R1 — Echo core + heists 1–3 in existing rooms.** Sim, recording, echoes,
   guards, devices, Crew card, HUD. → **Checkpoint: "Is the echo idea fun and
   clear?"** Playable link + 3 things to judge. Stop and wait.
2. **R2 — Bigger manor:** cellar, conservatory + grounds, upper floor, other
   rooms; screenshots reviewed per room.
3. **R3 — Heists 4–8**, stars, hints, audio (bell countdown, fireworks).
4. **R4 — Polish & perf**, then **Checkpoint: full campaign.**

---

## 6. Verification
- `tests/heist.test.ts` (Vitest, Node): for every heist, a bot builds echo
  tracks from scripted waypoint paths + actions and wins via **each of ≥ 4
  approaches**; Loud routes start already spotted. Determinism test: replay the
  same tracks twice → identical state hash. Stall/caught tests for echoes.
- Tutorial test: heist 1 round 1 cannot be won solo; round 2 with one echo can.
- `scripts/flows-heist.mjs` (Playwright, replaces `flows-hall.mjs`): play a
  round in the browser, restart, confirm the echo walks the same path and
  pulls the lever; restart < 2 s; zero console/WebGPU errors.
- `npm run shots` for every room incl. new ones — look at each image.
- Frame time per preset reported at each milestone (echoes are up to 6 extra
  skinned characters: check Low on phone emulation stays 30+ fps).
- `npm test` must pass before every push; bundle size reported.
