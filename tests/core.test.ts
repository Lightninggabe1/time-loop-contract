import { describe, it, expect } from "vitest";
import { parseTime, test as cond } from "../src/core/conditions";
import { minuteAt, formatTime, LOOP_REAL_SECONDS, LOOP_END } from "../src/core/clock";
import { evalSchedule, NpcDef, Spot } from "../src/core/schedule";
import { World, EventDef } from "../src/core/world";
import { IntelBoard, IntelDef } from "../src/core/intel";
import { contractStatus, validateContract, ContractDef } from "../src/core/contracts";
import { LoopManager, PerkDef } from "../src/core/loop";
import { MemoryStorage } from "../src/core/storage";

const spots: Record<string, Spot> = {
  bar: { id: "bar", pos: [0, 0, 0], yaw: 90 },
  door: { id: "door", pos: [10, 0, 0] },
  mid: { id: "mid", pos: [5, 0, 5] },
};
const npc: NpcDef = {
  id: "vera",
  name: "Vera",
  role: "heiress",
  look: { body: "f", outfit: "gown" },
  schedule: [
    { at: "18:00", spot: "bar", act: "drink" },
    { at: "19:00", spot: "door", act: "smoke", tag: "alone" },
    { at: "20:00", spot: "bar", via: ["mid"], act: "talk" },
  ],
};
const events: EventDef[] = [
  { id: "toast", when: { after: "19:30" }, do: [{ set: "toast.done" }, { toast: "A toast!" }] },
  { id: "chain", when: { flag: "toast.done" }, do: [{ learn: "i.toast" }] },
];

describe("clock & conditions", () => {
  it("maps real seconds to game time", () => {
    expect(minuteAt(0)).toBe(18 * 60);
    expect(minuteAt(LOOP_REAL_SECONDS)).toBe(LOOP_END);
    expect(formatTime(1170)).toEqual({ hm: "7:30", ampm: "PM" });
    expect(formatTime(1440)).toEqual({ hm: "12:00", ampm: "AM" });
    expect(parseTime("00:00")).toBe(1440);
  });
  it("evaluates nested conditions", () => {
    const ctx = { flags: { a: true, n: 3 }, minute: 1200, intel: new Set(["x"]) };
    expect(cond({ all: [{ flag: "a" }, { flag: "n", gte: 2 }, { intel: "x" }, { after: "19:59" }] }, ctx)).toBe(true);
    expect(cond({ any: [{ flag: "b" }, { not: { flag: "a" } }, { before: "20:00" }] }, ctx)).toBe(false);
  });
});

describe("schedules are a pure function of time", () => {
  it("same minute → identical pose", () => {
    for (const m of [1080, 1085, 1140.5, 1141, 1200, 1203.3, 1439]) {
      expect(evalSchedule(npc, m, spots)).toEqual(evalSchedule(npc, m, spots));
    }
  });
  it("walks between spots and arrives", () => {
    const start = evalSchedule(npc, 1140, spots);
    expect(start.moving).toBe(true);
    expect(start.pos[0]).toBeCloseTo(0, 3);
    const mid = evalSchedule(npc, 1142, spots);
    expect(mid.pos[0]).toBeGreaterThan(0);
    expect(mid.pos[0]).toBeLessThan(10);
    const there = evalSchedule(npc, 1170, spots);
    expect(there).toMatchObject({ pos: [10, 0, 0], act: "smoke", tag: "alone", moving: false });
  });
  it("follows waypoints", () => {
    // 20:00 leaves door via mid; after ~4.7 m it reaches mid
    let sawMid = false;
    for (let m = 1200; m < 1215; m += 0.1) {
      const p = evalSchedule(npc, m, spots).pos;
      if (Math.abs(p[0] - 5) < 0.2 && Math.abs(p[2] - 5) < 0.2) sawMid = true;
    }
    expect(sawMid).toBe(true);
  });
});

describe("world & events", () => {
  it("fires timed events once and chains them", () => {
    const w = new World([npc], spots, events);
    w.advance(1100);
    expect(w.flags["toast.done"]).toBeUndefined();
    w.advance(1171);
    expect(w.flags["toast.done"]).toBe(true);
    expect(w.intel.has("i.toast")).toBe(true);
    const out = w.drain();
    expect(out.map((o) => o.kind)).toEqual(["toast", "learn"]);
    w.advance(1200);
    expect(w.drain()).toEqual([]);
  });
  it("overrides take an NPC off schedule until they wear off", () => {
    const w = new World([npc], spots, []);
    w.apply([{ npc: "vera", override: { state: "ko", until: 1100, pos: [3, 0, 3] } }]);
    expect(w.npcPose("vera").pos).toEqual([3, 0, 3]);
    w.advance(1101);
    expect(w.npcPose("vera").pos).toEqual([0, 0, 0]);
  });
  it("two loops with the same inputs end identically", () => {
    const run = () => {
      const w = new World([npc], spots, events);
      for (let m = 1080; m <= 1440; m += 7) {
        w.advance(m);
        if (m === 1199) w.apply([{ set: "player.bribed" }]);
      }
      return { flags: { ...w.flags }, pose: w.npcPose("vera"), intel: [...w.intel] };
    };
    expect(run()).toEqual(run());
  });
});

const intelDefs: IntelDef[] = [
  { id: "a", kind: "person", title: "A", text: "", lead: 1, hint: "look at bar" },
  { id: "b", kind: "secret", title: "B", text: "", lead: 2, requires: { intel: "a" }, hint: "ask Vera", links: ["a"] },
  { id: "c", kind: "key", title: "C", text: "", lead: 0, requires: { flag: "never" }, hint: "" },
];

describe("intel board", () => {
  it("leads to the next unlocked clue", () => {
    const b = new IntelBoard(intelDefs);
    const ctx = (intel: string[]) => ({ flags: {}, minute: 1080, intel: new Set(intel) });
    expect(b.lead(ctx([]))?.intel.id).toBe("a");
    expect(b.lead(ctx(["a"]))?.intel.id).toBe("b");
    expect(b.lead(ctx(["a", "b"]))).toBeNull();
    expect(b.edges(ctx(["a", "b"]))).toEqual([["a", "b"]]);
  });
});

const contract: ContractDef = {
  id: "c1", title: "T", client: "x", target: "vera", brief: "", reward: 5,
  approaches: (["quiet", "social", "loud", "chaos"] as const).map((k) => ({
    id: k, kind: k, title: k, steps: [{ text: "step", done: { flag: `${k}.1` } }], complete: { flag: `${k}.done` },
  })),
};
const perks: PerkDef[] = [{ id: "fast", title: "Quick feet", text: "", cost: 3, mods: { sprint: 0.2 }, startFlags: { "has.lockpick": true } }];

describe("contracts & loop manager", () => {
  it("requires four approaches", () => {
    expect(() => validateContract(contract)).not.toThrow();
    expect(() => validateContract({ ...contract, approaches: contract.approaches.slice(1) })).toThrow(/quiet/);
  });
  it("tracks checklist progress", () => {
    const st = contractStatus(contract, { flags: { "loud.1": true }, minute: 1080, intel: new Set() });
    expect(st.focus.approach.kind).toBe("loud");
    expect(st.complete).toBeNull();
  });
  it("persists intel, points and perks across loops; resets everything else", () => {
    const store = new MemoryStorage();
    const content = { npcs: [npc], spots, events, contracts: [contract], perks };
    const lm = new LoopManager(content, store);
    let w = lm.startLoop();
    expect(w.flags["loop.first"]).toBe(true);
    w.advance(1200);
    w.apply([{ set: "chaos.done" }, { set: "temp" }]);
    const s = lm.endLoop("midnight");
    expect(s.completed).toEqual([{ contract: "c1", approach: "chaos" }]);
    expect(s.memoryEarned).toBe(5 + 1); // contract + one new clue (i.toast)
    expect(s.quip.length).toBeGreaterThan(5);

    const lm2 = new LoopManager(content, store); // e.g. page reload
    expect(lm2.buyPerk("fast")).toBe(true);
    w = lm2.startLoop();
    expect(w.flags.temp).toBeUndefined();
    expect(w.intel.has("i.toast")).toBe(true);
    expect(w.flags["has.lockpick"]).toBe(true);
    expect(w.flags["remember.c1.chaos"]).toBe(true);
    expect(lm2.mod("sprint")).toBeCloseTo(0.2);
    expect(lm2.meta.loop).toBe(2);
  });
  it("starting a loop is fast enough for a < 5 s reset", () => {
    const lm = new LoopManager({ npcs: [npc], spots, events, contracts: [contract], perks }, new MemoryStorage());
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) lm.startLoop();
    expect((performance.now() - t0) / 100).toBeLessThan(5);
  });
});
