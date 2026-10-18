# Decisions log

Newest last. Each entry: what, why.

## Phase 0–1 (graphics benchmark)
- **Year is NYE 1929 → 1930.** Art-deco peak, and "the party before the crash" fits grim-but-witty.
- **Floor, wallpaper, gold, marbles, night sky are self-generated textures** (`scripts/gen-textures.mjs`). CC0 libraries had no polished art-deco marble or fan wallpaper; generating them keeps the palette exact and the licence clean.
- **Architecture is a procedural modular kit** (`src/kit/modules.ts`) driven by `src/level/layouts/ballroom.json` (walls = sequences of panel/pilaster/window/mirror/door/stage modules). Props are CC0 Poly Haven models.
- **Static geometry is merged per material** (≈25 draw calls for the whole room's architecture). Props use GPU instancing.
- **Textures are WebP, not KTX2, for now.** KTX2 encoding needs the KTX-Software `toktx` binary (not installable here without Homebrew/sudo). WebP gets the download small; KTX2 (GPU memory savings on phones) is revisited before the vertical slice. Geometry is meshopt-compressed.
- **HUD is an HTML overlay** (crisper text at any DPR, simpler than Babylon GUI).
- **Lighting:** HDRI IBL (Poly Haven "ballroom", pre-baked to `.env`), shadowed moonlight through the windows, shadowed chandelier spotlights, ~40 cheap clustered point lights (sconces, candles, footlights, ceiling wash), emissive lamps + bloom.
- **Shadow maps render once** (the room is static). They will be re-armed when moving props/NPCs need it.
- **Light shafts are additive slices**, not a volumetric post-process: works identically on WebGPU and WebGL2, costs ~nothing, art-directable. They fade as you walk into them so they never wash out the view.
- **Reflections:** SSR at half resolution on glossy floors (Medium/High); planar mirror texture on the east mirror wall (High only, refreshed every 2nd frame).
- **High preset caps at 1.25× device pixels, Medium 1×, Low 0.8×.** At MacBook Air retina, High measured 14.7 ms/frame (≈68 fps) on this M2 — within the 60 fps target. 1.5× cost 32 ms, not worth it.
- **High uses 2 shadowed chandelier spots, not 3.** With 4 shadowed lights the mirror pass exceeded WebGPU's 16-varying limit.
- **Phones start on Medium and auto-step down** after a 2.5 s frame-time probe; desktop starts on High. Choice persists in settings.
- **Portrait screens get a wider vertical FOV** so the room still reads on a phone held upright.
- **Harness treats WebGPU validation warnings as errors**, not just `console.error` (WebGPU reports broken pipelines as warnings).
- **Frame time is measured uncapped** (render N frames back-to-back and wait for the GPU queue), because headless Chrome is vsync-capped at 60.
- **CI only builds and deploys.** GitHub runners have no GPU, so the screenshot/console-error/perf gate (`npm test`) runs locally before every push.
- **Glossy floors get almost no HDRI reflection (env 0.06).** The HDRI's own bright windows smeared as white streaks across the clear-coated floor; SSR already reflects the real room. Ceiling-wash lights have no specular for the same reason.
- **Preview hosting is pending the director's OK.** Free GitHub Pages needs a public repository; creating a public repo is an outward-facing step, so it waits for an explicit yes.
- **Checkpoint 1 approved by the director (2026-10-16).** Look is locked as the art bar for the rest of the manor. Preview: https://lightninggabe1.github.io/time-loop-contract/

## Phase 2 (core systems)
- **Game logic lives in `src/core/` as pure TypeScript with no Babylon imports**, so the bot/test harness can run whole loops in Node in milliseconds and determinism is unit-testable.
- **Time unit is the game minute (18:00 = 1080 … 24:00 = 1440).** The loop runs 9 real minutes, i.e. 40× real time.
- **Conditions are a tiny JSON language** (`flag`, `not`, `all`, `any`, `after`, `before`, `intel`), shared by events, contracts, intel leads and dialogue, so content never needs code.
- **Characters: Quaternius Universal Base Characters + Universal Animation Library (both CC0, verified in the bundled licence files).** Sculpted stylized faces/hands, ~13k tris each — the quality bar the director asked for (no blocky placeholders).
- **Outfits are generated, not modelled by hand** (`scripts/build-characters.mjs`): per-NPC 1024² textures are baked by painting each texel from its 3D bind-pose position (crisp necklines, lapels, studs, pinstripes, beading); cloth regions are smoothed *along normals only* (so painted lines stay straight) and inflated; limbs are slimmed and the waist filled for a tailored 1929 silhouette; skirts/fringe/hats/pearls/bow ties are generated geometry skinned to the same rig. Cloth inherits body weights, so it cannot clip.
- **Animations are retargeted at runtime** with Babylon's `AnimatorAvatar` (Rigify `DEF-*` → Unreal-style bone names, rest-pose differences handled).
- **NPC textures sit beside the .gltf files** (`npc/tex/`): Babylon's glTF loader rejects `../` URIs.
- **Schedule times mean "arrives at".** NPCs set off early enough to be in place on time (never before finishing the previous beat). Walking eats real game time at 40×, so this keeps every hint ("at 7:30 he's tipsy at the tower") true.
- **Routing uses a hand-authored waypoint graph** (`spots.json` hubs + links, deterministic Dijkstra) so schedules stay pure functions of time; the Recast navmesh is only used for chases.
- **Off-schedule walks ("goto" overrides) are also pure functions of time** (start point + start minute + route), so luring Dolly or sending the Ashcombes to the study stays reproducible.
- **Witnesses = same room, ≤ 7 m, within a 140° cone, conscious** (2.2 m in a blackout). No line-of-sight raycasts, per the brief. Any witnessed crime brings Brock running; outrun him (14 m for 3 s) or punch him first. Caught ends the loop with a quip; nothing is lost but the evening.
- **The rules engine (`src/game/session.ts`) has no Babylon imports**, so the bot test (`tests/bot.test.ts`) plays all 12 contract × approach routes in ~50 ms and asserts quiet routes are unseen.
- **Music is genuine 1919–1925 recordings marked public domain on Wikimedia Commons** (period-correct and allowed by the brief); CC0 jazz options were 8-bit or modern. Effects are Kenney CC0; crowd murmur is synthesised.
- **Workarounds for Babylon 9.31 WebGPU bugs:** (1) glTF transmission materials are converted to alpha glass (they add an opaque-scene pass that collides with clustered lights); (2) sheen is disabled on NPC fabric (WGSL sheen + clustered lights doesn't compile); (3) unlit/transparent materials are kept out of the SSR/SSAO prepass; (4) lights are never added/removed at runtime (frozen materials keep stale light bindings).
- **NPC glTF roots are never transformed directly** (they hold the handedness conversion the retargeter relies on); a parent node moves them.
- **High preset ≈ 16.9 ms at MacBook Air retina with the full cast** (mirror refresh every 3rd frame at 0.42 res); Medium ≈ 11 ms; Low ≈ 6 ms (phone-size viewport).

## Readability pass after Checkpoint 2 feedback (2026-10-17)
Director: "talking to people doesn't do anything", "the sunset painting has no cue", "needs to be more intuitive".
- **Conversations** (`src/content/talk.json`): Talk opens a menu (clock paused). Every person has 2–4 questions; each is asked once per loop and either notes a clue, or gives a *tip* that moves the Lead to what they hinted at. Big secrets (affair, debts, combination, Hollywood dream) are still only overheard, so watching still matters.
- **Social moves live in the conversation** (`talk: true` interactions): blackmail, the picture-man lure and telling Vivienne show in gold when ready, and greyed out with the reason ("He smokes alone on the balcony at 10:00") when not. A ❝ on the prompt and the name tag means "you have a move to make here".
- **The painting hides the safe**: "Swing the painting aside" comes first; it swings out on a hinge and reveals a brass-trimmed safe with a dial. The painting texture was upside down and blown out by the sky reflection; fixed.
- **Name tags** over nearby people (• = has something new to say) and usable things ("◆ Sunset painting", "◆ Fuse box"…).
- **Lead marker**: an on-screen pin over whoever or whatever the current Lead is about, sliding to the screen edge when it's off-screen.
- **Prompt order**: the thing you're looking at comes first, then the nearest.

## Phone fixes after Checkpoint 2 replay (2026-10-18)
- **Loading hang on phones**: phones now default to WebGL2 and the Low preset (far fewer, quicker shaders); the shader wait gives up after 10 s (unfinished meshes pop in a moment later) and shows a percentage; after 25 s on one step a "lighter version" link appears; a lost GPU context reloads on WebGL2/Low. WebKit iPhone emulation: 28 s → 7 s to playable.
- **HUD on phones**: compact clock, tracker collapsed to one line (▾ expands), smaller toasts/prompts/buttons, at most 2 prompts. Touch input listens page-wide, so only real buttons and open panels keep a touch; labels never block the stick or look.
- **Double taps**: the E and ⏱ buttons each had two handlers (a door opened and shut again; ⏱ skipped 20 min). One handler each now.
- **Again button**: all overlay buttons fire on touchend (some phones drop the synthesised click while another finger is down), and overlays scroll on short screens.

## Phase 4 — full game (2026-10-18)
- **Checkpoint 2 approved by the director (2026-10-18).** Full-scope expansion requested; content plan drafted in `CONTENT_PLAN.md` for Checkpoint A.
- **Mystery: Hobbs the butler rewinds the tower clock** to stop the deed of the Hall passing to Calloway at midnight; he hired the player via the telegrams. Chosen because it reuses the slice's existing clues (ledger, debts, telegrams) as story beats instead of discarding them.
- **9 Contracts (3 built + 5 new + finale).** Fewer, richer Contracts beat 10 thin ones; the finale is a Contract with 4 approaches so the one ending still respects "many approaches viable".
- **Every Loud route is bot-tested starting already spotted**, to prove nothing needs stealth.
- **Perks never gate progress**, only convenience and flavour.
- **Checkpoint A approved (2026-10-18).** The director also wants a second mystery after this one is built; it gets its own plan and approval after Checkpoint C.

## Phase 4a: streaming, Grand Foyer, Library, Contract 4 (2026-10-18)
- **Rooms stream in after the game starts.** Only the ballroom and balcony are built before the loading screen lifts; the rest build one at a time, nearest first, behind closed doors (a door stays shut while either side is still loading or compiling shaders). Guests also load behind the intro card. 10 Mbit/s time-to-playable: 57 s → 23 s, with two more rooms in the game.
- **Streamed rooms' lights take over spare cluster lights made at start** (220 parked slots). Adding lights, or creating key lights and shadow generators, after materials freeze breaks WebGPU bindings (dead light texture; mis-sized uniform buffer). Per-room key lights are created up front for every room that has one and only switch their meshes on when the room arrives.
- **Rooms outside the moon's shadow map get no direct moonlight** (`noMoon`) — it would leak through walls — and a cool blue fill inside each window instead. Each gets one shadowed key spot (Medium/High, rendered once) that lights only that room's static meshes: people under several shadowed lights would exceed WebGPU's 16-varying limit.
- **Animation library trimmed to the 12 clips used** (6.7 MB → 2.6 MB, meshopt). Table props get 512 px textures and foliage scans are decimated (`scripts/build-assets.mjs` DIET).
- **Grand Foyer**: black-and-white marble checker with a gold compass-star medallion, emerald coffered ceiling, a grand staircase to an upper landing (the upstairs door is locked until the upper floor is built). Stairs are a walkable pitched collider with a solid fill underneath.
- **Library**: two storeys of books, a decorative gallery, rolling ladders, banker's lamps, a grand chimney with an overmantel mirror, a deco rug.
- **Contract 4 changed slightly from the plan**: the Loud route knocks Hale flat anywhere (the conservatory fishpond comes with the conservatory); the Chaos route is the front-hall fire bell, which marches the whole house into the hall for a 25-minute head count. That's a reusable chaos tool for later Contracts too.
- **Contracts can unlock**; Contract 4 opens from the second evening (loop 1 stays the guided watch-and-explore loop).
- **`npm test` now also runs `scripts/flows-hall.mjs`**: streaming finishes and opens the doors, Hale reads in the library, the bell crowds the hall, the notebook is taken, the stairs are climbable, with no GPU errors.
