// Every heist, every approach, played round by round by a scripted bot on the
// same sim the browser runs. Plus determinism and the tutorial's lesson.
import { describe, it, expect } from "vitest";
import { heists, env } from "../src/content/heists";
import { playPlan, playRound } from "../src/core/heist/bot";
import { Round } from "../src/core/heist/round";
import { Crew } from "../src/core/heist/crew";
import { MemoryStorage } from "../src/core/storage";

const verbose = !!process.env.HEIST_LOG;

describe("heists", () => {
  for (const h of heists) {
    describe(`${h.n}. ${h.title}`, () => {
      const approaches = Object.keys(h.solutions);
      if (h.n > 1) it("has quiet, social, loud and chaos plans", () => expect(approaches.sort()).toEqual(["chaos", "loud", "quiet", "social"]));
      for (const a of approaches) {
        it(`wins: ${a}`, () => {
          const plan = h.solutions[a];
          expect(plan.length - 1).toBeLessThanOrEqual(h.cap);
          const { results, last } = playPlan(h, env, plan);
          if (verbose || last.round.status !== "won") results.forEach((r, i) => console.log(`--- ${h.id}/${a} round ${i + 1}\n${r.log.join("\n")}`));
          expect(last.round.status).toBe("won");
        });
      }
      if (h.n > 1)
        it("can't be won alone", () => {
          for (const plan of Object.values(h.solutions)) expect(playRound(h, env, [], plan[plan.length - 1]).round.status).not.toBe("won");
        });
      it("replays identically", () => {
        const plan = Object.values(h.solutions)[0];
        const { echoes } = playPlan(h, env, plan.slice(0, -1));
        const a = playRound(h, env, echoes, plan[plan.length - 1]).round.hash();
        const b = playRound(h, env, echoes, plan[plan.length - 1]).round.hash();
        expect(a).toBe(b);
      });
    });
  }
});

describe("echoes", () => {
  const h1 = heists.find((h) => h.id === "h1")!;
  it("the tutorial can't be won alone", () => {
    const solo = playRound(h1, env, [], [["go", "plate"], ["wait", 1], ["go", "pearls", "run"], ["take", "pearls"], ["go", "exit", "run"]]);
    expect(solo.round.status).not.toBe("won");
  });
  it("an echo replays its round exactly", () => {
    const first = playRound(h1, env, [], [["go", "plate"], ["wait", 1], ["end"]]);
    const r = new Round(h1, env, [first.track]);
    for (let i = 0; i < first.track.len + 30; i++) r.step(h1.spawn.pos, 0);
    const e = r.bodies[0];
    const k = (first.track.len - 1) * 4;
    expect(e.pos).toEqual([first.track.p[k], first.track.p[k + 1], first.track.p[k + 2]]);
    expect(r.doors.get("study")!.open).toBe(true); // still holding the plate
  });
  it("an echo stalls when its door is now shut", () => {
    const holder = playRound(h1, env, [], [["go", "plate"], ["wait", 1], ["end"]]);
    const walker = playRound(h1, env, [holder.track], [["go", "s_mid", "run"], ["end"]]);
    // replay the walker without the plate-holder: the study door is shut in front of it
    const r = new Round(h1, env, [walker.track]);
    let stalled = "";
    for (let i = 0; i < walker.track.len; i++) {
      r.step(h1.spawn.pos, 0);
      for (const e of r.drain()) if (e.kind === "stall") stalled = e.reason;
    }
    expect(stalled).toMatch(/door/);
  });
});

describe("crew", () => {
  it("keeps echoes up to the cap, saves them, and opens heists in order", () => {
    const store = new MemoryStorage();
    const crew = new Crew(store, heists);
    const h1 = heists[0];
    const t = playRound(h1, env, [], [["go", "plate"], ["end"]]).track;
    expect(crew.unlocked(heists[1].id)).toBe(false);
    for (let i = 0; i < h1.cap + 2; i++) crew.keep(h1.id, t);
    expect(crew.echoes(h1.id).length).toBe(h1.cap);
    crew.won(h1.id, 2);
    const again = new Crew(store, heists);
    expect(again.echoes(h1.id).length).toBe(h1.cap);
    expect(again.unlocked(heists[1].id)).toBe(true);
    expect(again.current).toBe(heists[1].id);
  });
});
