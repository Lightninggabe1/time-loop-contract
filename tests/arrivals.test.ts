// Prints when each tagged schedule beat actually begins (after walking) — a designer's sanity table.
import { it } from "vitest";
import { npcs, spots, router } from "../src/content";
import { compileSchedule } from "../src/core/schedule";
import { formatTime } from "../src/core/clock";

it("arrival table", () => {
  const rows: string[] = [];
  for (const n of npcs) {
    for (const c of compileSchedule(n, spots, router)) {
      if (!c.entry.tag) continue;
      const f = (m: number) => { const t = formatTime(m); return `${t.hm}${t.ampm[0].toLowerCase()}`; };
      rows.push(`${n.id.padEnd(9)} ${c.entry.tag.padEnd(12)} sched ${f(c.start).padEnd(6)} arrives ${f(c.start + c.travel)} (${c.travel.toFixed(1)} min walk)`);
    }
  }
  console.log(rows.join("\n"));
});
