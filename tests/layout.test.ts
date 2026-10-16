import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import layout from "../src/level/layouts/ballroom.json";

describe("ballroom layout", () => {
  it("wall modules exactly fill every wall", () => {
    for (const w of layout.walls) {
      const len = Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]);
      const sum = w.modules.reduce((s, m) => s + m.w, 0);
      expect(sum, w.id).toBeCloseTo(len, 3);
    }
  });
  it("walls form a closed loop", () => {
    for (let i = 0; i < layout.walls.length; i++) {
      const a = layout.walls[i], b = layout.walls[(i + 1) % layout.walls.length];
      expect(a.to).toEqual(b.from);
    }
  });
  it("every prop model has a built asset", () => {
    const models = new Set([...layout.props.map((p) => p.model), "Chandelier_02", "dining_chair_02", "brass_candleholders", "brass_goblets"]);
    for (const m of models) expect(existsSync(`public/assets/models/${m}.glb`), m).toBe(true);
  });
  it("screenshot spots are unique and inside the room", () => {
    const names = layout.shots.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    const [W, H, D] = layout.size;
    for (const s of layout.shots) {
      expect(Math.abs(s.pos[0])).toBeLessThan(W / 2);
      expect(Math.abs(s.pos[2])).toBeLessThan(D / 2);
      expect(s.pos[1]).toBeLessThan(H);
    }
  });
});
