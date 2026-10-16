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
