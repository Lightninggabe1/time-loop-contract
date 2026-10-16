// One loop's mutable state + the event system. Everything that changes during
// a loop lives here, so a reset is just "make a new World".
import { Cond, CondCtx, FlagValue, test } from "./conditions";
import { NpcDef, NpcPose, Spot, evalSchedule, Vec3 } from "./schedule";
import { LOOP_START } from "./clock";

export type Awareness = "calm" | "suspicious" | "alarmed";

/** A deviation from an NPC's schedule caused by the player. */
export interface NpcOverride {
  state: "ko" | "distracted" | "chasing" | "fleeing" | "detained" | "gone";
  until?: number; // game minute it wears off (absent = rest of loop)
  pos?: Vec3; // where they are held (ko, distracted, detained)
  yaw?: number;
}

export type Action =
  | { set: string; value?: FlagValue }
  | { add: string; by: number }
  | { learn: string } // discover an intel item
  | { npc: string; override: NpcOverride | null }
  | { say: string; line: string } // speech bubble
  | { toast: string }; // HUD message

export interface EventDef {
  id: string;
  when: Cond;
  do: Action[];
  repeat?: boolean; // default: fires once per loop
}

export type Output = { kind: "say"; npc: string; line: string } | { kind: "toast"; text: string } | { kind: "learn"; intel: string };

export class World {
  minute = LOOP_START;
  readonly flags: Record<string, FlagValue> = {};
  readonly intel = new Set<string>(); // known: remembered from past loops + learned now
  readonly learnedThisLoop = new Set<string>();
  readonly overrides: Record<string, NpcOverride> = {};
  readonly awareness: Record<string, Awareness> = {};
  private fired = new Set<string>();
  private outbox: Output[] = [];

  constructor(
    readonly npcs: NpcDef[],
    readonly spots: Record<string, Spot>,
    readonly events: EventDef[],
    remembered: Iterable<string> = [],
    startFlags: Record<string, FlagValue> = {},
  ) {
    for (const i of remembered) this.intel.add(i);
    Object.assign(this.flags, startFlags);
    for (const n of npcs) this.awareness[n.id] = "calm";
  }

  get ctx(): CondCtx {
    return { flags: this.flags, minute: this.minute, intel: this.intel };
  }

  check(c: Cond) {
    return test(c, this.ctx);
  }

  /** Advance time and fire events. Deterministic for the same action sequence. */
  advance(toMinute: number) {
    this.minute = Math.max(this.minute, toMinute);
    for (const [id, o] of Object.entries(this.overrides)) {
      if (o.until !== undefined && this.minute >= o.until) delete this.overrides[id];
    }
    this.runEvents();
  }

  /** Apply player-caused actions (interactions call this), then settle events. */
  apply(actions: Action[]) {
    for (const a of actions) this.exec(a);
    this.runEvents();
  }

  private runEvents() {
    // settle chains: an event may enable another; cap passes to avoid loops
    for (let pass = 0; pass < 8; pass++) {
      let any = false;
      for (const e of this.events) {
        if (!e.repeat && this.fired.has(e.id)) continue;
        if (!this.check(e.when)) continue;
        this.fired.add(e.id);
        for (const a of e.do) this.exec(a);
        any = true;
        if (e.repeat) continue;
      }
      if (!any) break;
    }
  }

  private exec(a: Action) {
    if ("set" in a) this.flags[a.set] = a.value ?? true;
    else if ("add" in a) this.flags[a.add] = ((this.flags[a.add] as number) || 0) + a.by;
    else if ("learn" in a) this.learn(a.learn);
    else if ("npc" in a) {
      if (a.override) this.overrides[a.npc] = { ...a.override };
      else delete this.overrides[a.npc];
    } else if ("say" in a) this.outbox.push({ kind: "say", npc: a.say, line: a.line });
    else if ("toast" in a) this.outbox.push({ kind: "toast", text: a.toast });
  }

  learn(id: string) {
    if (this.intel.has(id) && this.learnedThisLoop.has(id)) return;
    const isNew = !this.intel.has(id);
    this.intel.add(id);
    this.learnedThisLoop.add(id);
    if (isNew) this.outbox.push({ kind: "learn", intel: id });
  }

  /** Drain UI outputs produced since the last call. */
  drain(): Output[] {
    const o = this.outbox;
    this.outbox = [];
    return o;
  }

  npcPose(id: string): NpcPose & { override?: NpcOverride } {
    const def = this.npcs.find((n) => n.id === id);
    if (!def) throw new Error(`Unknown npc ${id}`);
    const pose = evalSchedule(def, this.minute, this.spots);
    const o = this.overrides[id];
    if (!o) return pose;
    if (o.pos) return { ...pose, pos: [...o.pos], yaw: o.yaw ?? pose.yaw, moving: false, act: "idle", override: o };
    return { ...pose, override: o };
  }
}
