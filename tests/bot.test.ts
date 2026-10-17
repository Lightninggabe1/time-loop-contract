// Scripted bot: completes every contract via every approach on the pure game
// session (same rules the browser runs). Quiet approaches must be unwitnessed.
import { describe, it, expect } from "vitest";
import { Session } from "../src/game/session";
import { MemoryStorage } from "../src/core/storage";
import { parseTime } from "../src/core/conditions";
import { RATE } from "../src/core/clock";
import { contracts, interactions, anchors, spots, npcs, talk, board } from "../src/content";
import type { Vec3 } from "../src/core/schedule";

class Bot {
  s = new Session(new MemoryStorage());
  witnessed: string[] = [];
  log: string[] = [];
  constructor() {
    this.s.start();
  }
  at(p: Vec3 | string) {
    const pos = typeof p === "string" ? spots[p].pos : p;
    this.s.tick(0, { pos: [...pos] as Vec3 });
    return this;
  }
  until(t: string) {
    const target = parseTime(t);
    while (this.s.minute < target && !this.s.ended) this.s.tick(0.25 / RATE * 4, { pos: this.s.player.pos });
    return this;
  }
  /** stand next to an NPC (offset so we're in front of them) */
  near(npc: string, d = 1.2) {
    const pose = this.s.world.npcPose(npc);
    this.at([pose.pos[0] + Math.sin(pose.yaw) * d, pose.pos[1], pose.pos[2] + Math.cos(pose.yaw) * d]);
    return this;
  }
  /** stand behind an NPC (out of their sight cone) */
  behind(npc: string, d = 1.5) {
    const pose = this.s.world.npcPose(npc);
    this.at([pose.pos[0] - Math.sin(pose.yaw) * d, pose.pos[1], pose.pos[2] - Math.cos(pose.yaw) * d]);
    return this;
  }
  nearAnchor(a: string, d = 0.9) {
    const p = anchors[a];
    this.at([p[0] - Math.sign(p[0]) * 0 - (a === "safe" || a === "fusebox" ? d : 0), 0, p[2] - (a === "stove" || a === "rope" ? d : 0) + (a === "microphone" ? -0.6 : 0)]);
    return this;
  }
  act(id: string) {
    const offers = this.s.offers().map((o) => o.id);
    const it = interactions.find((x) => x.id === id);
    if (it?.talk) {
      // social moves are made from the conversation menu
      const npc = it.target.npc!;
      if (!offers.includes(`talk:${npc}`)) throw new Error(`can't talk to ${npc} at ${this.s.minute.toFixed(1)} (offers: ${offers.join(", ")})`);
      const opt = this.s.talkOptions(npc).find((o) => o.id === id);
      if (opt?.kind !== "move") throw new Error(`"${id}" not ready in conversation at ${this.s.minute.toFixed(1)}: ${opt?.note ?? "not listed"}`);
    } else if (!offers.includes(id)) throw new Error(`"${id}" not offered at ${this.s.minute.toFixed(1)} (offers: ${offers.join(", ")})`);
    const r = this.s.perform(id);
    if (!r.ok) throw new Error(`"${id}" failed: ${r.message}`);
    this.witnessed.push(...r.witnessed);
    this.log.push(`${this.s.minute.toFixed(0)} ${id}`);
    return this;
  }
  punch(npc: string) {
    const r = this.s.punch(npc);
    this.witnessed.push(...r.witnessed);
    return this;
  }
  flag(f: string) {
    return this.s.world.flags[f];
  }
  done(contract: string) {
    return this.s.contractStatus().find((c) => c.contract.id === contract)!.complete?.id ?? null;
  }
}

const runs: Record<string, Record<string, (b: Bot) => void>> = {
  ledger: {
    quiet: (b) => {
      b.until("19:31").at([0.9, 0, 7.6]).until("19:33");
      expect(b.s.world.intel.has("i.combo")).toBe(true);
      b.until("21:40").at("s_passage").nearAnchor("safe").act("painting.swing").act("safe.open").act("safe.take");
    },
    social: (b) => {
      b.until("19:01").at([-13.6, 0, 2.6]).until("19:04");
      expect(b.s.world.intel.has("i.affair")).toBe(true);
      b.until("22:05").near("calloway").act("calloway.blackmail");
      b.until("22:10").at("s_passage").nearAnchor("safe").act("painting.swing").act("safe.open").act("safe.take");
    },
    loud: (b) => {
      b.until("23:24").near("calloway").act("calloway.rob");
    },
    chaos: (b) => {
      b.until("23:01").nearAnchor("fusebox").act("fuse.pull");
      expect(b.flag("ledger.dropped")).toBe(true);
      b.near("calloway").act("ledger.grab");
    },
  },
  song: {
    quiet: (b) => {
      b.until("20:50").nearAnchor("microphone").act("mic.cut").until("22:03");
    },
    social: (b) => {
      b.at([-14.4, 0, 3.4]).until("18:06");
      b.until("20:01").near("rupert").until("20:03");
      b.until("21:32").near("dolly").act("dolly.lure").until("22:03");
    },
    loud: (b) => {
      b.until("21:35").near("rupert").punch("rupert").until("22:03");
    },
    chaos: (b) => {
      b.until("21:59").nearAnchor("fusebox").act("fuse.pull").until("22:03");
    },
  },
  toast: {
    quiet: (b) => {
      b.until("21:01").behind("marcel", 1.6).until("21:03");
      b.until("21:26").nearAnchor("stove").act("drops.take").nearAnchor("jacket").act("jacket.take");
      b.until("23:43").near("ashcombe").act("ashcombe.serve").until("23:56");
    },
    social: (b) => {
      b.until("20:46").at([15.4, 0, 3.2]).until("20:50");
      expect(b.s.world.intel.has("i.debts")).toBe(true);
      b.until("23:06").near("vivienne").act("vivienne.tell").until("23:58");
    },
    loud: (b) => {
      b.until("22:33").near("ashcombe").until("22:34").punch("ashcombe").until("23:56");
    },
    chaos: (b) => {
      b.nearAnchor("rope").until("23:52").act("rope.untie").until("23:56");
    },
  },
};

describe("content integrity", () => {
  it("every schedule spot, anchor and interaction target exists", () => {
    for (const n of npcs) for (const e of n.schedule) expect(spots[e.spot], `${n.id} ${e.at} ${e.spot}`).toBeTruthy();
    for (const it of interactions) {
      if (it.target.anchor) expect(anchors[it.target.anchor], it.id).toBeTruthy();
      if (it.target.npc) expect(npcs.find((n) => n.id === it.target.npc), it.id).toBeTruthy();
    }
  });
  it("every NPC can walk its whole evening (routes exist)", () => {
    const b = new Bot();
    for (let m = 18 * 60; m <= 24 * 60; m += 1.5) {
      b.s.world.minute = m;
      for (const n of npcs) expect(() => b.s.world.npcPose(n.id)).not.toThrow();
    }
  });
});

describe("bot completes every contract through every approach", () => {
  for (const c of contracts) {
    for (const a of c.approaches) {
      it(`${c.title} — ${a.kind}`, () => {
        const b = new Bot();
        runs[c.id][a.id](b);
        expect(b.done(c.id), b.log.join("; ")).toBe(a.id);
        if (a.kind === "quiet") expect(b.witnessed, "quiet must be unseen").toEqual([]);
      });
    }
  }
  it("covers all 12 contract × approach pairs", () => {
    const n = contracts.reduce((s, c) => s + c.approaches.length, 0);
    expect(n).toBe(12);
    expect(Object.values(runs).reduce((s, r) => s + Object.keys(r).length, 0)).toBe(12);
  });
});

describe("conversation", () => {
  it("everyone has at least two things to talk about", () => {
    for (const n of npcs) expect((talk[n.id] ?? []).length, n.id).toBeGreaterThanOrEqual(2);
  });
  it("questions give clues once, and then make way for new ones", () => {
    const b = new Bot();
    b.until("18:20").near("pryce");
    expect(b.s.offers().map((o) => o.id)).toContain("talk:pryce");
    const before = b.s.talkOptions("pryce").map((o) => o.id);
    expect(before).toContain("ask:pryce:study");
    b.s.perform("ask:pryce:study");
    expect(b.s.world.intel.has("i.safe")).toBe(true);
    expect(b.s.talkOptions("pryce").map((o) => o.id)).not.toContain("ask:pryce:study");
    expect(b.s.greet("pryce")).not.toEqual(b.s.greet("pryce"));
  });
  it("a tip points the Lead at what they hinted about", () => {
    const b = new Bot();
    expect(board.lead(b.s.world.ctx)!.intel.id).toBe("i.calloway");
    b.near("vivienne");
    b.s.perform("ask:vivienne:edmund");
    expect(board.lead(b.s.world.ctx)!.intel.id).toBe("i.debts");
  });
  it("a social move you can't make yet is shown greyed out, with why", () => {
    const b = new Bot();
    b.s.world.learn("i.affair");
    b.until("19:40").near("calloway");
    const opt = b.s.talkOptions("calloway").find((o) => o.id === "calloway.blackmail");
    expect(opt?.kind).toBe("locked");
    expect(opt?.note).toMatch(/10:00/);
    expect(b.s.perform("calloway.blackmail").ok).toBe(false);
    expect(b.flag("blackmail.calloway")).toBeFalsy();
  });
  it("the safe hides behind the painting", () => {
    const b = new Bot();
    b.s.world.learn("i.combo");
    b.until("21:40").at("s_passage").nearAnchor("safe");
    const ids = b.s.offers().map((o) => o.id);
    expect(ids).toContain("painting.swing");
    expect(ids).not.toContain("safe.open");
  });
});

describe("loops", () => {
  it("an untouched evening plays out: song sung, toast given, intel learned, quick reset", () => {
    const b = new Bot();
    b.at("b_center").until("23:59");
    b.s.tick(30);
    expect(b.flag("song.performed")).toBe(true);
    expect(b.flag("toast.given")).toBe(true);
    expect(b.s.ended?.reason).toBe("midnight");
    expect(b.s.ended!.quip.length).toBeGreaterThan(5);
    const t0 = performance.now();
    b.s.start();
    expect(performance.now() - t0).toBeLessThan(50);
    expect(b.s.world.flags["toast.given"]).toBeUndefined();
    expect(b.s.world.intel.size).toBeGreaterThan(0);
  });
  it("the same inputs give the same evening", () => {
    const run = () => {
      const b = new Bot();
      runs.ledger.loud(b);
      b.until("23:59");
      return JSON.stringify(b.s.world.flags);
    };
    expect(run()).toEqual(run());
  });
});
