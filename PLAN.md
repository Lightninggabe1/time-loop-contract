# PLAN — Time-Loop Contract

## Phase 0 — Foundations
Vite + TS + Babylon 9 + Havok + Recast scaffold, palette, quality presets,
Playwright screenshot + console-error harness, GitHub Pages deploy.
**Gate:** `npm run build` clean, zero console errors, Pages URL loads on phone.

## Phase 1 — Graphics benchmark (CHECKPOINT 1)
The ballroom, finished: modular kit from JSON layout, HDRI IBL, shadowed key
lights + emissive fill, SSAO, bloom, ACES, fog, light shafts, floor
reflections, grading. First-person walkaround (desktop + touch).
**Gate:** 3–4 screenshots that read as a premium stylized game; High ≥ 60 fps
on M2-class; director approves on their own device.

## Phase 2 — Core systems
World clock, JSON NPC schedules (pure function of time), flags/events, loop
manager (snapshot/reset < 5 s), storage adapter, intel board, Lead + hints,
contract checklist, awareness icons (calm/suspicious/alarmed), chase/brawl
via navmesh, interaction + items.
**Gate:** unit tests for determinism (same time → same world), reset < 5 s.

## Phase 3 — Vertical slice (CHECKPOINT 2)
West wing: ballroom, study, kitchen, balcony. ~10 NPCs, 3 Contracts × 4
approaches (quiet / social / loud / chaos), ~15 intel, 2 perks, guided Loop 1,
audio, loading screen + streaming, Low/Medium/High auto-probe.
**Gate:** bot completes all 12 contract-approach paths in `npm test`;
screenshots of every room pass review; first-time player understands the
idea in 60 s (guided loop); Low ≥ 30 fps mid phone.

## Phase 4+ — Expansion (CHECKPOINT 3 before starting)
Rest of manor (3 floors + grounds), 8–10 Contracts, secrets, challenge modes.

## Standing quality gates (every milestone)
- No console errors (build fails otherwise)
- Screenshots from preset spots in every room, reviewed
- Relative frame time per preset reported
- Bundle size reported (informational)
- Every asset logged in CREDITS.md
