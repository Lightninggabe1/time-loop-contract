import { describe, it, expect } from "vitest";
import { parseTime, test as cond } from "../src/core/conditions";
import { minuteAt, formatTime, LOOP_REAL_SECONDS, LOOP_END } from "../src/core/clock";
import { evalSchedule, NpcDef, Spot } from "../src/core/schedule";

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
  it("schedule times are arrivals: walks beforehand and is there on time", () => {
    const there = evalSchedule(npc, 1140, spots);
    expect(there).toMatchObject({ pos: [10, 0, 0], act: "smoke", tag: "alone", moving: false });
    const before = evalSchedule(npc, 1137, spots);
    expect(before.moving).toBe(true);
    expect(before.pos[0]).toBeGreaterThan(0);
    expect(before.pos[0]).toBeLessThan(10);
    expect(evalSchedule(npc, 1120, spots)).toMatchObject({ pos: [0, 0, 0], act: "drink" });
  });
  it("follows waypoints", () => {
    let sawMid = false;
    for (let m = 1185; m < 1200; m += 0.05) {
      const p = evalSchedule(npc, m, spots).pos;
      if (Math.abs(p[0] - 5) < 0.2 && Math.abs(p[2] - 5) < 0.2) sawMid = true;
    }
    expect(sawMid).toBe(true);
    expect(evalSchedule(npc, 1200, spots).pos).toEqual([0, 0, 0]);
  });
});
