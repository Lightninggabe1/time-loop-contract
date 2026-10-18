// One loop's mutable state + the event system. Everything that changes during
// a loop lives here, so a reset is just "make a new World".
import { Cond, CondCtx, FlagValue, test } from "./conditions";
import { NpcDef, NpcPose, Spot, evalSchedule, Vec3, Router, WALK_SPEED } from "./schedule";
import { LOOP_START, RATE } from "./clock";

export type Awareness = "calm" | "suspicious" | "alarmed";

/** A deviation from an NPC's schedule caused by the player. */
export interface NpcOverride {
  state: "ko" | "distracted" | "chasing" | "fleeing" | "detained" | "gone";
  until?: number; // game minute it wears off (absent = rest of loop)
  for?: number; // …or this many game minutes from when it starts
  pos?: Vec3; // where they are held (ko, distracted, detained)
  yaw?: number;
  /** walk to this spot (from where they were when the override began) */
  goto?: string;
  from?: Vec3;
  at?: number;
}

export type Action =
  | { set: string; value?: FlagValue; for?: number }
  | { add: string; by: number }
  | { learn: string } // discover an intel item
  | { npc: string; override: NpcOverride | null }
  /** everyone conscious (except `except`) walks to these spots, in cast order, for a while */
  | { crowd: { spots: string[]; for: number; except?: string[] } }
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
  private expiry = new Map<string, number>();
  private outbox: Output[] = [];

  constructor(
    readonly npcs: NpcDef[],
    readonly spots: Record<string, Spot>,
    readonly events: EventDef[],
    remembered: Iterable<string> = [],
    startFlags: Record<string, FlagValue> = {},
    readonly router?: Router,
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
    for (const [k, t] of this.expiry) {
      if (this.minute >= t) {
        this.flags[k] = false;
        this.expiry.delete(k);
      }
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
    if ("set" in a) {
      this.flags[a.set] = a.value ?? true;
      if (a.for) this.expiry.set(a.set, this.minute + a.for);
    }
    else if ("add" in a) this.flags[a.add] = ((this.flags[a.add] as number) || 0) + a.by;
    else if ("learn" in a) this.learn(a.learn);
    else if ("npc" in a) {
      if (a.override) {
        const o: NpcOverride = { ...a.override };
        if (o.for !== undefined) o.until = this.minute + o.for;
        if (o.goto) {
          o.from = [...this.npcPose(a.npc).pos];
          o.at = this.minute;
        }
        if (o.state === "ko" && !o.pos) o.pos = [...this.npcPose(a.npc).pos];
        if (o.state === "ko") this.flags[`ko.${a.npc}`] = true;
        this.overrides[a.npc] = o;
      } else delete this.overrides[a.npc];
    } else if ("crowd" in a) {
      let i = 0;
      for (const n of this.npcs) {
        const cur = this.overrides[n.id]?.state;
        if (cur === "ko" || cur === "chasing" || a.crowd.except?.includes(n.id)) continue;
        const spot = a.crowd.spots[i++ % a.crowd.spots.length];
        this.exec({ npc: n.id, override: { state: "distracted", goto: spot, for: a.crowd.for } });
      }
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
    const pose = evalSchedule(def, this.minute, this.spots, this.router);
    const o = this.overrides[id];
    if (!o) return pose;
    if (o.goto && o.from && o.at !== undefined) return { ...this.walkTo(o.from, o.goto, this.minute - o.at, pose), override: o };
    if (o.pos) return { ...pose, pos: [...o.pos], yaw: o.yaw ?? pose.yaw, moving: false, act: "idle", override: o };
    return { ...pose, override: o };
  }

  /** Deterministic off-schedule walk: from a point, via the waypoint graph, to a spot. */
  private walkTo(from: Vec3, spotId: string, elapsed: number, base: NpcPose): NpcPose {
    const target = this.spots[spotId];
    const near = Object.entries(this.spots).reduce((b, [k, s]) => {
      const d = Math.hypot(s.pos[0] - from[0], s.pos[2] - from[2]);
      return d < b.d ? { k, d } : b;
    }, { k: spotId, d: Infinity }).k;
    const ids = this.router ? this.router.route(near, spotId) : [spotId];
    const pts: Vec3[] = [from, ...ids.map((k) => this.spots[k].pos)];
    let d = (elapsed / RATE) * WALK_SPEED; // game minutes → real seconds → metres
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (d <= seg && seg > 1e-6) {
        const t = d / seg;
        return { ...base, pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], yaw: Math.atan2(b[0] - a[0], b[2] - a[2]), act: "walk", moving: true, spot: spotId };
      }
      d -= seg;
    }
    return { ...base, pos: [...target.pos], yaw: ((target.yaw ?? 0) * Math.PI) / 180, act: "talk", moving: false, spot: spotId };
  }
}
