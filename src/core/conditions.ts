// Tiny JSON condition language shared by events, contracts, intel leads and
// dialogue. Pure: same inputs → same answer.
export type FlagValue = boolean | number | string;

export type Cond =
  | true
  | { flag: string; eq?: FlagValue; gte?: number }
  | { not: Cond }
  | { all: Cond[] }
  | { any: Cond[] }
  | { after: string } // game time "HH:MM", inclusive
  | { before: string } // exclusive
  | { intel: string }; // known (this loop or remembered)

export interface CondCtx {
  flags: Readonly<Record<string, FlagValue>>;
  minute: number;
  intel: ReadonlySet<string>;
}

/** "19:30" → 1170 game minutes since midnight. "00:00" means end of loop (1440). */
export function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) throw new Error(`Bad time "${t}"`);
  return (h === 0 ? 24 : h) * 60 + m;
}

export function test(c: Cond, ctx: CondCtx): boolean {
  if (c === true) return true;
  if ("flag" in c) {
    const v = ctx.flags[c.flag];
    if (c.eq !== undefined) return v === c.eq;
    if (c.gte !== undefined) return typeof v === "number" && v >= c.gte;
    return !!v;
  }
  if ("not" in c) return !test(c.not, ctx);
  if ("all" in c) return c.all.every((x) => test(x, ctx));
  if ("any" in c) return c.any.some((x) => test(x, ctx));
  if ("after" in c) return ctx.minute >= parseTime(c.after);
  if ("before" in c) return ctx.minute < parseTime(c.before);
  if ("intel" in c) return ctx.intel.has(c.intel);
  throw new Error(`Unknown condition ${JSON.stringify(c)}`);
}

/** Flags a condition depends on (used by content validation). */
export function flagsIn(c: Cond, out = new Set<string>()): Set<string> {
  if (c === true) return out;
  if ("flag" in c) out.add(c.flag);
  else if ("not" in c) flagsIn(c.not, out);
  else if ("all" in c) c.all.forEach((x) => flagsIn(x, out));
  else if ("any" in c) c.any.forEach((x) => flagsIn(x, out));
  return out;
}
