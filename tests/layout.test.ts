import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import wing from "../src/level/layouts/wing.json";

const inside = (b: number[], x: number, z: number) => x > b[0] && x < b[2] && z > b[1] && z < b[3];

describe("wing layout", () => {
  it("wall modules exactly fill every wall", () => {
    for (const r of wing.rooms)
      for (const w of r.walls) {
        const len = Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]);
        const sum = w.modules.reduce((s, m) => s + m.w, 0);
        expect(sum, `${r.id}/${w.id}`).toBeCloseTo(len, 3);
      }
  });
  it("room bounds don't overlap", () => {
    for (const a of wing.rooms)
      for (const b of wing.rooms) {
        if (a === b) continue;
        const [ax0, az0, ax1, az1] = a.bounds, [bx0, bz0, bx1, bz1] = b.bounds;
        const overlap = ax0 < bx1 - 0.01 && bx0 < ax1 - 0.01 && az0 < bz1 - 0.01 && bz0 < az1 - 0.01;
        expect(overlap, `${a.id} vs ${b.id}`).toBe(false);
      }
  });
  it("every door id is unique and frame-only doorways pair with a real door", () => {
    const ids = wing.rooms.flatMap((r) => r.walls.flatMap((w) => w.modules.filter((m) => m.type === "door" && "id" in m).map((m) => (m as unknown as { id: string }).id)));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["study", "kitchen", "balcony", "passage"]));
  });
  it("every model has a built asset", () => {
    const models = new Set(wing.rooms.flatMap((r) => r.props.map((p) => p.model)));
    for (const m of models) expect(existsSync(`public/assets/models/${m}.glb`), m).toBe(true);
  });
  it("screenshot spots are inside some room", () => {
    for (const s of wing.shots) expect(wing.rooms.some((r) => inside(r.bounds, s.pos[0], s.pos[2])), s.name).toBe(true);
  });
});
