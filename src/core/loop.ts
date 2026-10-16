// Loop manager: starts/ends loops, carries memory (intel, perks, points)
// across resets through a storage adapter.
import { World, EventDef } from "./world";
import { NpcDef, Spot, Router } from "./schedule";
import { ContractDef, contractStatus } from "./contracts";
import { FlagValue } from "./conditions";
import { Storage } from "./storage";

export interface PerkDef {
  id: string;
  title: string;
  text: string;
  cost: number;
  /** flags set at the start of every loop while owned */
  startFlags?: Record<string, FlagValue>;
  /** numeric tweaks read by gameplay code */
  mods?: { sprint?: number; hints?: number; disguises?: number };
}

export interface Meta {
  version: 1;
  loop: number; // number of loops started
  memory: number; // unspent memory points
  intel: string[]; // remembered across loops
  perks: string[];
  completed: Record<string, string>; // contract id → approach id used first
  approachesUsed: string[]; // "contract/approach" ever completed (replay value)
}

export type EndReason = "midnight" | "caught" | "contract" | "restart";

export interface LoopSummary {
  reason: EndReason;
  quip: string;
  memoryEarned: number;
  newIntel: number;
  completed: { contract: string; approach: string }[];
}

const QUIPS: Record<EndReason, string[]> = {
  midnight: [
    "Auld lang syne. Again.",
    "Midnight. The champagne forgets; you don't.",
    "Happy New Year. Same as the old one.",
    "The clock strikes twelve. So does déjà vu.",
  ],
  caught: [
    "Escorted out. Politely. Firmly. Repeatedly.",
    "Security has your face memorised. Luckily, only until midnight.",
    "Note to self: the butler does not like being punched.",
    "Thrown out before the toast. Rude of them.",
  ],
  contract: [
    "Job done. The evening, however, insists on an encore.",
    "Clean work. Shame nobody will remember it but you.",
    "One problem solved. The loop is unimpressed.",
  ],
  restart: ["Let's take that from the top.", "Rewind. Fresh tie. Try again."],
};

const KEY = "meta";

export function freshMeta(): Meta {
  return { version: 1, loop: 0, memory: 0, intel: [], perks: [], completed: {}, approachesUsed: [] };
}

export interface Content {
  npcs: NpcDef[];
  spots: Record<string, Spot>;
  events: EventDef[];
  contracts: ContractDef[];
  perks: PerkDef[];
  router?: Router;
}

export class LoopManager {
  meta: Meta;
  world!: World;

  constructor(readonly content: Content, readonly storage: Storage) {
    this.meta = storage.load<Meta>(KEY) ?? freshMeta();
  }

  get firstLoop() {
    return this.meta.loop <= 1;
  }

  startLoop(): World {
    this.meta.loop++;
    const startFlags: Record<string, FlagValue> = { "loop.first": this.meta.loop === 1, "loop.n": this.meta.loop };
    for (const id of this.meta.perks) Object.assign(startFlags, this.perk(id)?.startFlags);
    for (const [c, a] of Object.entries(this.meta.completed)) startFlags[`remember.${c}.${a}`] = true;
    this.world = new World(this.content.npcs, this.content.spots, this.content.events, this.meta.intel, startFlags, this.content.router);
    this.world.advance(this.world.minute); // fire 18:00 events
    this.persist();
    return this.world;
  }

  /** Close the loop: bank intel and memory points, pick a one-liner. */
  endLoop(reason: EndReason): LoopSummary {
    const w = this.world;
    const before = new Set(this.meta.intel);
    const newIntel = [...w.learnedThisLoop].filter((i) => !before.has(i));
    this.meta.intel = [...new Set([...this.meta.intel, ...w.intel])];
    const completed: LoopSummary["completed"] = [];
    let earned = newIntel.length; // 1 point per new clue
    for (const c of this.content.contracts) {
      const st = contractStatus(c, w.ctx);
      if (!st.complete) continue;
      const key = `${c.id}/${st.complete.id}`;
      completed.push({ contract: c.id, approach: st.complete.id });
      if (!this.meta.approachesUsed.includes(key)) {
        // full reward for a new approach, a little for repeats
        earned += this.meta.completed[c.id] ? Math.ceil(c.reward / 2) : c.reward;
        this.meta.approachesUsed.push(key);
      } else earned += 1;
      this.meta.completed[c.id] ??= st.complete.id;
    }
    this.meta.memory += earned;
    this.persist();
    const pool = QUIPS[reason];
    const quip = pool[(this.meta.loop + newIntel.length) % pool.length];
    return { reason, quip, memoryEarned: earned, newIntel: newIntel.length, completed };
  }

  perk(id: string) {
    return this.content.perks.find((p) => p.id === id);
  }

  buyPerk(id: string): boolean {
    const p = this.perk(id);
    if (!p || this.meta.perks.includes(id) || this.meta.memory < p.cost) return false;
    this.meta.memory -= p.cost;
    this.meta.perks.push(id);
    this.persist();
    return true;
  }

  mod(name: keyof NonNullable<PerkDef["mods"]>): number {
    return this.meta.perks.reduce((s, id) => s + (this.perk(id)?.mods?.[name] ?? 0), 0);
  }

  resetAll() {
    this.meta = freshMeta();
    this.persist();
  }

  private persist() {
    this.storage.save(KEY, this.meta);
  }
}
