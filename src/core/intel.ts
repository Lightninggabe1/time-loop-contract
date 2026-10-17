// Intel board: everything the player has noticed, linked together, plus the
// "Lead" (the next suggested clue) and free hints.
import { Cond, CondCtx, test } from "./conditions";

export type IntelKind = "person" | "schedule" | "secret" | "key" | "place";

export interface IntelDef {
  id: string;
  kind: IntelKind;
  title: string;
  text: string;
  links?: string[];
  /** lower = suggested sooner as the Lead */
  lead?: number;
  /** only suggested once this holds (e.g. after the prerequisite clue) */
  requires?: Cond;
  /** where/how to find it; shown by the Lead and the hint button */
  hint: string;
  contract?: string;
}

export interface Lead {
  intel: IntelDef;
  hint: string;
}

export class IntelBoard {
  constructor(readonly defs: IntelDef[]) {
    const ids = new Set(defs.map((d) => d.id));
    for (const d of defs) for (const l of d.links ?? []) if (!ids.has(l)) throw new Error(`Intel ${d.id} links unknown ${l}`);
  }

  get(id: string) {
    const d = this.defs.find((x) => x.id === id);
    if (!d) throw new Error(`Unknown intel ${id}`);
    return d;
  }

  known(ctx: CondCtx) {
    return this.defs.filter((d) => ctx.intel.has(d.id));
  }

  /** Next suggested clue: undiscovered, unlocked, lowest lead number (optionally for one contract).
   *  A tip someone gave you (flag `tip.<id>`) jumps the queue. */
  lead(ctx: CondCtx, contract?: string): Lead | null {
    const tipped = (d: IntelDef) => (ctx.flags[`tip.${d.id}`] ? 0 : 1);
    const open = this.defs
      .filter((d) => !ctx.intel.has(d.id) && d.lead !== undefined && (tipped(d) === 0 || !d.requires || test(d.requires, ctx)))
      .filter((d) => !contract || d.contract === contract)
      .sort((a, b) => tipped(a) - tipped(b) || a.lead! - b.lead!);
    return open[0] ? { intel: open[0], hint: open[0].hint } : null;
  }

  /** Links between known items (for drawing strings on the board). */
  edges(ctx: CondCtx): [string, string][] {
    const seen = new Map<string, [string, string]>();
    for (const d of this.known(ctx))
      for (const l of d.links ?? []) {
        if (!ctx.intel.has(l)) continue;
        const pair: [string, string] = d.id < l ? [d.id, l] : [l, d.id];
        seen.set(pair.join("|"), pair);
      }
    return [...seen.values()];
  }
}
