// One 60-second round of a heist: you, your echoes (earlier rounds replayed
// exactly), the guards and guests, the gadgets and the loot. Fixed 30 Hz ticks
// and no randomness, so the same tracks + the same player give the same round.
// No Babylon imports: the browser and the test bot drive the same code.
import type { Router, Spot, Vec3 } from "../schedule";
import { Gate, Rooms, crosses, roomAt, flat } from "./geo";
import { HeistDef, DeviceDef, ItemDef, TICK, ROUND_TICKS, GUARD_WALK, GUARD_RUN, REACH } from "./defs";

export interface Env {
  spots: Record<string, Spot>;
  router: Router;
  rooms: Rooms;
  gates: Record<string, Gate>;
  /** short display names for people */
  names: Record<string, string>;
}

export type Verb = "use" | "take" | "drop" | "punch" | "chat";
export interface Act { verb: Verb; target?: string }

/** A recorded round: one pose per tick (x, y, z, yaw) and the actions taken. */
export interface Track {
  len: number;
  p: number[];
  acts: [number, Verb, string?][];
}

export type BodyStatus = "active" | "stalled" | "caught" | "out";
export interface Body {
  id: number; // echo slot; the player is last
  echo: boolean;
  pos: Vec3;
  yaw: number;
  moving: boolean;
  carrying: string | null;
  engaged: string | null; // a safe being cracked, or "chat:<npc>"
  status: BodyStatus;
  reason?: string;
  wanted: boolean;
  crimeUntil: number;
  track?: Track;
}

export type Awareness = "calm" | "suspicious" | "alarmed";
type GuardMode = "patrol" | "go" | "hold" | "chat" | "chase" | "look" | "ko" | "return";

export interface Npc {
  npc: string;
  guard: boolean;
  pos: Vec3;
  yaw: number;
  moving: boolean;
  running: boolean;
  mode: GuardMode;
  awareness: Awareness;
  until: number; // tick the current mode ends (hold/look/ko)
  patrolT: number; // seconds into the patrol loop (frozen while off patrol)
  path: Vec3[];
  dest?: Vec3;
  target?: number; // body id being chased or chatted to
  lookAt?: Vec3;
  susFor: number;
  lostFor: number;
  home: { pos: Vec3; yaw: number };
  shouted: boolean;
}

export type RoundEvent =
  | { kind: "say"; npc: string; line: string }
  | { kind: "toast"; text: string; tone?: "warn" | "good" }
  | { kind: "stall"; body: number; reason: string }
  | { kind: "caught"; body: number; by: string }
  | { kind: "alarm"; npc: string; body: number }
  | { kind: "ko"; npc: string; by: number }
  | { kind: "device"; id: string; device: DeviceDef["kind"] }
  | { kind: "opened"; id: string }
  | { kind: "take"; body: number; item: string }
  | { kind: "escaped"; item: string; body: number }
  | { kind: "end"; status: RoundStatus };

export type RoundStatus = "running" | "won" | "caught" | "timeup" | "ended";

export interface Offer { verb: Verb; target?: string; label: string; dist: number; pos?: Vec3 }

export interface ItemState { def: ItemDef; pos: Vec3; carrier: number | null; free: boolean; escaped: boolean }
export interface DeviceState { def: DeviceDef; used: boolean; progress: number; done: boolean; activeUntil: number }
export interface DoorState { open: boolean; locked: boolean; changedAt: number; plate: boolean }

const SIGHT = 7, DARK_SIGHT = 2.2, CONE = Math.cos((70 * Math.PI) / 180);
const KO_TICKS = 12 * 30;
const SUSPICIOUS_TICKS = 36; // 1.2 s of being seen somewhere you shouldn't be
const CATCH = 0.9, LOSE_DIST = 12, LOSE_TICKS = 90;
const DOOR_GRACE = 24; // a door that has just shut is still passable for 0.8 s (leaves swing)

const PUNCH_LINES = ["Oof!", "Not the face!", "Unhand— oof.", "My monocle!"];

interface Leg { kind: "stand" | "walk"; dur: number; pos: Vec3; yaw: number; path?: Vec3[]; cum?: number[] }

export class Round {
  tick = 0;
  status: RoundStatus = "running";
  readonly bodies: Body[] = [];
  readonly npcs: Npc[] = [];
  readonly items = new Map<string, ItemState>();
  readonly devices = new Map<string, DeviceState>();
  readonly doors = new Map<string, DoorState>();
  darkUntil = 0;
  wonAt = -1;
  private events: RoundEvent[] = [];
  private rec: Track = { len: 0, p: [], acts: [] };
  private patrols = new Map<string, { legs: Leg[]; period: number }>();

  constructor(readonly def: HeistDef, readonly env: Env, echoes: Track[]) {
    echoes.forEach((t, i) => this.bodies.push(this.makeBody(i, true, t)));
    this.bodies.push(this.makeBody(echoes.length, false));
    for (const it of def.items) this.items.set(it.id, { def: it, pos: [...it.pos], carrier: null, free: !it.inside, escaped: false });
    for (const d of def.devices) this.devices.set(d.id, { def: d, used: false, progress: 0, done: false, activeUntil: 0 });
    for (const [id, d] of Object.entries(def.doors ?? {})) this.doors.set(id, { open: d.open ?? true, locked: !!d.locked, changedAt: -999, plate: false });
    for (const d of def.devices) if (d.kind === "plate") for (const id of d.doors ?? []) {
      const s = this.doors.get(id) ?? { open: false, locked: false, changedAt: -999, plate: true };
      s.plate = true;
      s.open = false;
      this.doors.set(id, s);
    }
    for (const g of def.guards) {
      const p = this.compilePatrol(g.patrol);
      this.patrols.set(g.npc, p);
      const t = (g.offset ?? 0) % p.period;
      const pose = this.patrolPose(g.npc, t);
      this.npcs.push({ npc: g.npc, guard: true, pos: pose.pos, yaw: pose.yaw, moving: pose.moving, running: false, mode: "patrol", awareness: "calm", until: 0, patrolT: t, path: [], susFor: 0, lostFor: 0, home: { pos: pose.pos, yaw: pose.yaw }, shouted: false });
    }
    for (const g of def.guests ?? []) {
      const s = env.spots[g.spot];
      if (!s) throw new Error(`${def.id}: guest ${g.npc} at unknown spot ${g.spot}`);
      const yaw = (((g.yaw ?? s.yaw ?? 0) as number) * Math.PI) / 180;
      this.npcs.push({ npc: g.npc, guard: false, pos: [...s.pos], yaw, moving: false, running: false, mode: "hold", awareness: "calm", until: Infinity, patrolT: 0, path: [], susFor: 0, lostFor: 0, home: { pos: [...s.pos], yaw }, shouted: false });
    }
    this.placeEchoes();
  }

  private makeBody(id: number, echo: boolean, track?: Track): Body {
    const pos: Vec3 = track && track.len ? [track.p[0], track.p[1], track.p[2]] : [...this.def.spawn.pos];
    const yaw = track && track.len ? track.p[3] : (this.def.spawn.yaw * Math.PI) / 180;
    return { id, echo, pos, yaw, moving: false, carrying: null, engaged: null, status: "active", wanted: false, crimeUntil: -1, track };
  }

  get player() {
    return this.bodies[this.bodies.length - 1];
  }
  get seconds() {
    return this.tick * TICK;
  }
  get left() {
    return Math.max(0, (ROUND_TICKS - this.tick) * TICK);
  }
  get dark() {
    return this.tick < this.darkUntil;
  }
  npc(id: string) {
    return this.npcs.find((n) => n.npc === id);
  }
  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }
  /** this round so far, ready to become an echo */
  recording(): Track {
    return { len: this.rec.len, p: [...this.rec.p], acts: this.rec.acts.map((a) => [...a] as [number, Verb, string?]) };
  }

  // ------------------------------------------------------------------ stepping

  /** Advance one tick. `pos`/`yaw` is where the player is now; `acts` what they did. */
  step(pos: Vec3, yaw: number, acts: Act[] = []) {
    if (this.status !== "running") return;
    const me = this.player;
    // record (millimetres, so the echo replays exactly what the sim saw)
    const q = (v: number) => Math.round(v * 1000) / 1000;
    if (me.status === "active") {
      const np: Vec3 = [q(pos[0]), q(pos[1]), q(pos[2])];
      me.moving = flat(np, me.pos) > 1e-4;
      me.pos = np;
      me.yaw = q(yaw);
    }
    this.rec.p.push(me.pos[0], me.pos[1], me.pos[2], me.yaw);
    this.rec.len++;
    this.moveEchoes();
    for (const a of acts) {
      if (me.status !== "active") break;
      const r = this.perform(me, a.verb, a.target);
      if (r.ok) this.rec.acts.push(a.target ? [this.tick, a.verb, a.target] : [this.tick, a.verb]);
      else if (r.reason) this.events.push({ kind: "toast", text: r.reason });
    }
    this.echoActs();
    this.updateDevices();
    this.updateNpcs();
    this.checkExit();
    this.tick++;
    if (this.status === "running" && this.tick >= ROUND_TICKS) this.finish("timeup");
  }

  /** Stop now (the rest of the round, your echo just waits where you stood). */
  endEarly() {
    if (this.status === "running") this.finish("ended");
  }

  private finish(s: RoundStatus) {
    this.status = s;
    this.events.push({ kind: "end", status: s });
  }

  private sample(t: Track, tick: number): [Vec3, number] {
    const i = Math.min(tick, t.len - 1) * 4;
    return [[t.p[i], t.p[i + 1], t.p[i + 2]], t.p[i + 3]];
  }

  private placeEchoes() {
    for (const b of this.bodies) if (b.echo && b.track && b.track.len) [b.pos, b.yaw] = this.sample(b.track, 0);
  }

  private moveEchoes() {
    for (const b of this.bodies) {
      if (!b.echo || b.status !== "active" || !b.track || !b.track.len) continue;
      const [p, yaw] = this.sample(b.track, this.tick);
      const shut = this.blockingGate(b.pos, p);
      if (shut) {
        this.stall(b, "The door's shut!");
        continue;
      }
      b.moving = flat(p, b.pos) > 1e-4;
      b.pos = p;
      b.yaw = yaw;
    }
  }

  private echoActs() {
    for (const b of this.bodies) {
      if (!b.echo || b.status !== "active" || !b.track) continue;
      for (const [t, verb, target] of b.track.acts) {
        if (t !== this.tick) continue;
        const r = this.perform(b, verb, target);
        if (!r.ok) {
          this.stall(b, r.reason ?? "Huh?");
          break;
        }
      }
    }
  }

  private stall(b: Body, reason: string) {
    b.status = "stalled";
    b.reason = reason;
    b.moving = false;
    b.engaged = null;
    this.events.push({ kind: "stall", body: b.id, reason });
  }

  /** A shut door between p and q, if any (ignores doors that only just shut). */
  blockingGate(p: Vec3, q: Vec3): string | null {
    for (const [id, d] of this.doors) {
      if (d.open || this.tick - d.changedAt < DOOR_GRACE) continue;
      const g = this.env.gates[id];
      if (g && crosses(g, p, q)) return id;
    }
    return null;
  }

  private setDoor(id: string, open: boolean) {
    const d = this.doors.get(id);
    if (!d || d.open === open) return;
    d.open = open;
    d.changedAt = this.tick;
  }

  // ------------------------------------------------------------------ actions

  private near(b: Body, p: Vec3, r = REACH) {
    return flat(b.pos, p) <= r && Math.abs(b.pos[1] + 1 - p[1]) < 2.2;
  }

  perform(b: Body, verb: Verb, target?: string): { ok: boolean; reason?: string } {
    if (verb === "drop") {
      if (!b.carrying) return { ok: false, reason: "Empty-handed." };
      const it = this.items.get(b.carrying)!;
      it.carrier = null;
      it.pos = [b.pos[0], b.pos[1] + 0.05, b.pos[2]];
      b.carrying = null;
      return { ok: true };
    }
    if (!target) return { ok: false };
    if (verb === "take") {
      const it = this.items.get(target);
      if (!it || it.escaped) return { ok: false, reason: "It's gone." };
      if (!it.free) return { ok: false, reason: "Locked away." };
      if (it.carrier !== null) return { ok: false, reason: "Someone's got it already!" };
      if (b.carrying) return { ok: false, reason: "Hands full." };
      if (!this.near(b, it.pos)) return { ok: false, reason: "It's not here any more!" };
      it.carrier = b.id;
      b.carrying = target;
      this.events.push({ kind: "take", body: b.id, item: target });
      return { ok: true };
    }
    if (verb === "punch" || verb === "chat") {
      const n = this.npc(target);
      if (!n || n.mode === "ko") return { ok: false, reason: "Nobody there." };
      if (flat(n.pos, b.pos) > REACH + 0.4) return { ok: false, reason: `${this.env.names[target] ?? target} isn't here.` };
      if (verb === "punch") {
        n.mode = "ko";
        n.until = this.tick + KO_TICKS;
        n.awareness = "calm";
        n.moving = false;
        n.path = [];
        b.crimeUntil = this.tick + 45;
        this.events.push({ kind: "ko", npc: n.npc, by: b.id });
        this.events.push({ kind: "say", npc: n.npc, line: PUNCH_LINES[this.tick % PUNCH_LINES.length] });
        return { ok: true };
      }
      if (!n.guard) return { ok: false, reason: "They're not the one to distract." };
      if (n.mode === "chase" || n.awareness === "alarmed") return { ok: false, reason: "He's in no mood to chat!" };
      if (b.wanted) return { ok: false, reason: "He knows your face." };
      if (this.isHot(b)) return { ok: false, reason: "Not with the loot in your hands!" };
      n.mode = "chat";
      n.target = b.id;
      n.moving = false;
      n.awareness = "calm";
      b.engaged = `chat:${n.npc}`;
      this.events.push({ kind: "say", npc: n.npc, line: CHAT_LINES[this.tick % CHAT_LINES.length] });
      return { ok: true };
    }
    // use: a door, or a device
    if (target.startsWith("door:")) {
      const id = target.slice(5), d = this.doors.get(id), g = this.env.gates[id];
      if (!d || !g) return { ok: false };
      const mid: Vec3 = [(g.a[0] + g.b[0]) / 2, g.y + 1, (g.a[1] + g.b[1]) / 2];
      if (!this.near(b, mid, 2.2)) return { ok: false, reason: "Too far from the door." };
      if (d.plate) return { ok: false, reason: "It only opens while someone's on the plate." };
      if (d.locked) {
        const key = this.def.doors?.[id]?.key;
        if (!key || b.carrying !== key) return { ok: false, reason: "Locked." };
        d.locked = false;
        this.setDoor(id, true);
        return { ok: true };
      }
      this.setDoor(id, !d.open);
      return { ok: true };
    }
    const dev = this.devices.get(target);
    if (!dev) return { ok: false };
    const D = dev.def;
    if (!this.near(b, D.pos)) return { ok: false, reason: `Too far from the ${D.label.toLowerCase()}.` };
    switch (D.kind) {
      case "plate":
        return { ok: false, reason: "Just stand on it." };
      case "safe":
        if (dev.done) return { ok: false, reason: "It's already open." };
        b.engaged = D.id;
        return { ok: true };
      case "noise":
      case "announce":
      case "chandelier":
      case "bell":
        if (dev.used) return { ok: false, reason: "That trick only works once a night." };
        dev.used = true;
        this.trigger(dev, b);
        return { ok: true };
      case "blackout":
        if (this.dark) return { ok: false, reason: "The lights are already out." };
        dev.used = dev.done = true;
        this.darkUntil = this.tick + Math.round((D.for ?? 15) / TICK);
        this.events.push({ kind: "device", id: D.id, device: D.kind });
        return { ok: true };
    }
  }

  private trigger(dev: DeviceState, by: Body) {
    const D = dev.def, until = this.tick + Math.round((D.for ?? 15) / TICK);
    dev.done = true;
    this.events.push({ kind: "device", id: D.id, device: D.kind });
    const room = roomAt(this.env.rooms, D.look ?? D.pos);
    if (D.kind === "noise" || D.kind === "bell") {
      const to = this.env.spots[D.spot!];
      for (const n of this.npcs) {
        if (!n.guard || n.mode === "ko") continue;
        if (D.kind === "noise" && !(D.lure ?? []).includes(n.npc)) continue;
        if (D.kind === "noise" && n.mode === "chase") continue;
        if (n.mode === "chat" && n.target !== undefined) this.bodies[n.target].engaged = null;
        n.mode = "go";
        n.target = undefined;
        n.awareness = "calm";
        n.dest = [...to.pos];
        n.path = this.pathTo(n.pos, to.pos);
        n.until = until;
        n.lookAt = D.look ?? D.pos;
      }
      void by;
      return;
    }
    // announce / chandelier: everyone in the room stops and stares
    const look = D.look ?? D.pos;
    for (const n of this.npcs) {
      if (n.mode === "ko") continue;
      if (D.kind === "chandelier" && flat(n.pos, look) <= (D.r ?? 2.5)) {
        n.mode = "ko";
        n.until = this.tick + KO_TICKS;
        n.awareness = "calm";
        n.moving = false;
        this.events.push({ kind: "ko", npc: n.npc, by: by.id });
        continue;
      }
      if (roomAt(this.env.rooms, n.pos) !== room) continue;
      if (n.mode === "chase") continue;
      if (n.mode === "chat" && n.target !== undefined) this.bodies[n.target].engaged = null;
      n.mode = "look";
      n.lookAt = look;
      n.until = until;
      n.moving = false;
      n.target = undefined;
    }
  }

  /** What the player could do right now, nearest first. */
  offers(): Offer[] {
    const b = this.player, out: Offer[] = [];
    if (b.status !== "active" || this.status !== "running") return out;
    for (const it of this.items.values()) {
      if (!it.free || it.carrier !== null || it.escaped || b.carrying) continue;
      if (this.near(b, it.pos)) out.push({ verb: "take", target: it.def.id, label: `Take the ${it.def.label}`, dist: flat(b.pos, it.pos), pos: it.pos });
    }
    for (const d of this.devices.values()) {
      const D = d.def;
      if (D.kind === "plate" || !this.near(b, D.pos)) continue;
      if (D.kind === "safe" && (d.done || b.engaged === D.id)) continue;
      if (d.used && D.kind !== "safe" && D.kind !== "blackout") continue;
      if (D.kind === "blackout" && this.dark) continue;
      out.push({ verb: "use", target: D.id, label: D.label, dist: flat(b.pos, D.pos), pos: D.pos });
    }
    for (const n of this.npcs) {
      if (n.mode === "ko") continue;
      const d = flat(n.pos, b.pos);
      if (d > REACH + 0.4) continue;
      const name = this.env.names[n.npc] ?? n.npc;
      if (n.guard && n.mode !== "chat" && n.mode !== "chase" && !b.wanted && !this.isHot(b)) out.push({ verb: "chat", target: n.npc, label: `Chat up ${name}`, dist: d + 0.01, pos: n.pos });
      out.push({ verb: "punch", target: n.npc, label: `Punch ${name}`, dist: d + 0.02, pos: n.pos });
    }
    for (const [id, d] of this.doors) {
      const g = this.env.gates[id];
      if (!g || d.plate) continue;
      const mid: Vec3 = [(g.a[0] + g.b[0]) / 2, g.y + 1, (g.a[1] + g.b[1]) / 2];
      if (!this.near(b, mid, 2.2)) continue;
      if (d.locked && b.carrying !== this.def.doors?.[id]?.key) continue;
      out.push({ verb: "use", target: `door:${id}`, label: d.locked ? "Unlock the door" : d.open ? "Close the door" : "Open the door", dist: flat(b.pos, mid) + 0.05, pos: mid });
    }
    if (b.carrying) out.push({ verb: "drop", label: `Drop the ${this.items.get(b.carrying)!.def.label}`, dist: 9 });
    return out.sort((a, c) => a.dist - c.dist);
  }

  // ------------------------------------------------------------------ devices

  private updateDevices() {
    // plates hold their doors open while anyone stands on them
    const held = new Map<string, boolean>();
    for (const d of this.devices.values()) {
      if (d.def.kind !== "plate") continue;
      const on = this.bodies.some((b) => (b.status === "active" || b.status === "stalled") && flat(b.pos, d.def.pos) <= (d.def.r ?? 0.8) && Math.abs(b.pos[1] - d.def.pos[1]) < 1);
      d.done = on;
      for (const id of d.def.doors ?? []) held.set(id, (held.get(id) ?? false) || on);
    }
    for (const [id, on] of held) this.setDoor(id, on);
    // safes: every engaged cracker in reach adds their time
    for (const b of this.bodies) {
      if (!b.engaged || b.engaged.startsWith("chat:")) continue;
      const d = this.devices.get(b.engaged);
      if (!d || d.done || b.status !== "active" || !this.near(b, d.def.pos)) b.engaged = null;
    }
    for (const d of this.devices.values()) {
      if (d.def.kind !== "safe" || d.done) continue;
      const n = this.bodies.filter((b) => b.engaged === d.def.id).length;
      if (!n) continue;
      d.progress += n * TICK;
      if (d.progress >= (d.def.time ?? 20)) {
        d.done = true;
        for (const b of this.bodies) if (b.engaged === d.def.id) b.engaged = null;
        const it = d.def.loot ? this.items.get(d.def.loot) : null;
        if (it) it.free = true;
        this.events.push({ kind: "opened", id: d.def.id });
      }
    }
    // chats end when the talker walks off
    for (const b of this.bodies) {
      if (!b.engaged?.startsWith("chat:")) continue;
      const n = this.npc(b.engaged.slice(5));
      if (!n || n.mode !== "chat" || n.target !== b.id || b.status !== "active" || flat(n.pos, b.pos) > 2.4) {
        b.engaged = null;
        if (n && n.mode === "chat" && n.target === b.id) this.resume(n);
      }
    }
    // carried things go where their carrier goes
    for (const it of this.items.values()) if (it.carrier !== null) {
      const b = this.bodies[it.carrier];
      it.pos = [b.pos[0], b.pos[1] + 1.0, b.pos[2]];
    }
  }

  private isHot(b: Body) {
    return !!b.carrying && !this.items.get(b.carrying)!.def.key;
  }

  private checkExit() {
    const ex = this.def.exit;
    for (const b of this.bodies) {
      if (b.status !== "active" || !b.carrying) continue;
      if (flat(b.pos, ex.pos) > ex.r) continue;
      const it = this.items.get(b.carrying)!;
      if (it.def.key) continue;
      it.escaped = true;
      it.carrier = null;
      b.carrying = null;
      this.events.push({ kind: "escaped", item: it.def.id, body: b.id });
      if (it.def.main && this.status === "running") {
        this.wonAt = this.tick;
        this.finish("won");
      }
    }
  }

  /** ★ won · ★★ with at most par echoes · ★★★ also by the time goal or with the bonus */
  stars(): number {
    if (this.status !== "won") return 0;
    const echoes = this.bodies.length - 1;
    let s = 1;
    if (echoes <= this.def.par) s++;
    const bonus = [...this.items.values()].some((i) => i.def.bonus && i.escaped);
    if (s === 2 && (bonus || this.wonAt * TICK <= this.def.timeGoal)) s++;
    return s;
  }

  // ------------------------------------------------------------------ people

  private compilePatrol(patrol: [string, number][]) {
    const legs: Leg[] = [];
    const sp = (id: string) => {
      const s = this.env.spots[id];
      if (!s) throw new Error(`${this.def.id}: patrol spot ${id} unknown`);
      return s;
    };
    for (let i = 0; i < patrol.length; i++) {
      const [id, wait] = patrol[i];
      const s = sp(id);
      const yaw = ((s.yaw ?? 0) * Math.PI) / 180;
      if (wait > 0) legs.push({ kind: "stand", dur: wait, pos: s.pos, yaw });
      if (patrol.length > 1) {
        const next = patrol[(i + 1) % patrol.length][0];
        const path = this.env.router.route(id, next).map((x) => sp(x).pos);
        const cum = [0];
        for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + flat(path[k - 1], path[k]));
        const len = cum[cum.length - 1];
        if (len > 0.01) legs.push({ kind: "walk", dur: len / GUARD_WALK, pos: s.pos, yaw, path, cum });
      }
    }
    if (!legs.length) throw new Error(`${this.def.id}: empty patrol`);
    return { legs, period: legs.reduce((a, l) => a + l.dur, 0) };
  }

  patrolPose(npc: string, t: number): { pos: Vec3; yaw: number; moving: boolean } {
    const p = this.patrols.get(npc)!;
    t = ((t % p.period) + p.period) % p.period;
    for (const l of p.legs) {
      if (t > l.dur) {
        t -= l.dur;
        continue;
      }
      if (l.kind === "stand") return { pos: [...l.pos], yaw: l.yaw, moving: false };
      const d = (t / l.dur) * l.cum![l.cum!.length - 1];
      let k = 1;
      while (k < l.path!.length - 1 && l.cum![k] < d) k++;
      const a = l.path![k - 1], b = l.path![k];
      const f = (d - l.cum![k - 1]) / (l.cum![k] - l.cum![k - 1] || 1);
      return { pos: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], yaw: Math.atan2(b[0] - a[0], b[2] - a[2]), moving: true };
    }
    const l = p.legs[p.legs.length - 1];
    return { pos: [...(l.path ? l.path[l.path.length - 1] : l.pos)], yaw: l.yaw, moving: false };
  }

  /** Nearest waypoint, preferring the same room. */
  private nearestSpot(p: Vec3): string {
    const room = roomAt(this.env.rooms, p);
    let best = "", bd = Infinity;
    for (const [id, s] of Object.entries(this.env.spots)) {
      if (id.startsWith("evac")) continue;
      const d = flat(s.pos, p) + (roomAt(this.env.rooms, s.pos) === room ? 0 : 100) + Math.abs(s.pos[1] - p[1]) * 2;
      if (d < bd || (d === bd && id < best)) (bd = d), (best = id);
    }
    return best;
  }

  /** Waypoint path between two arbitrary points (skips straight there inside one room). */
  pathTo(from: Vec3, to: Vec3): Vec3[] {
    if (roomAt(this.env.rooms, from) === roomAt(this.env.rooms, to) && Math.abs(from[1] - to[1]) < 0.5) return [[...to]];
    const a = this.nearestSpot(from), b = this.nearestSpot(to);
    const ids = this.env.router.route(a, b);
    return [...ids.map((id) => [...this.env.spots[id].pos] as Vec3), [...to]];
  }

  private walk(n: Npc, speed: number) {
    let step = speed * TICK;
    n.moving = false;
    while (step > 1e-6 && n.path.length) {
      const t = n.path[0];
      const d = flat(n.pos, t);
      if (d < 1e-6) {
        n.pos = [...t];
        n.path.shift();
        continue;
      }
      n.yaw = Math.atan2(t[0] - n.pos[0], t[2] - n.pos[2]);
      n.moving = true;
      if (d <= step) {
        n.pos = [...t];
        n.path.shift();
        step -= d;
      } else {
        const f = step / d;
        n.pos = [n.pos[0] + (t[0] - n.pos[0]) * f, n.pos[1] + (t[1] - n.pos[1]) * f, n.pos[2] + (t[2] - n.pos[2]) * f];
        step = 0;
      }
    }
    return n.path.length === 0;
  }

  private face(n: Npc, p: Vec3) {
    if (flat(n.pos, p) > 0.05) n.yaw = Math.atan2(p[0] - n.pos[0], p[2] - n.pos[2]);
  }

  /** back to what they were doing */
  private resume(n: Npc) {
    n.target = undefined;
    n.lookAt = undefined;
    if (!n.guard) {
      n.mode = "hold";
      n.until = Infinity;
      n.path = flat(n.pos, n.home.pos) > 0.1 ? this.pathTo(n.pos, n.home.pos) : [];
      n.yaw = n.home.yaw;
      return;
    }
    n.mode = "return";
    n.path = this.pathTo(n.pos, this.patrolPose(n.npc, n.patrolT).pos);
  }

  private canSee(n: Npc, p: Vec3) {
    if (roomAt(this.env.rooms, n.pos) !== roomAt(this.env.rooms, p)) return false;
    if (Math.abs(n.pos[1] - p[1]) > 2) return false;
    const dx = p[0] - n.pos[0], dz = p[2] - n.pos[2];
    const d = Math.hypot(dx, dz);
    if (d > (this.dark ? DARK_SIGHT : SIGHT)) return false;
    if (d < 1.2) return true;
    return (Math.sin(n.yaw) * dx + Math.cos(n.yaw) * dz) / d > CONE;
  }

  /** Why a guard would care about this body: a crime or loot (alarm), or being somewhere private (suspicion). */
  private concern(b: Body): "alarm" | "suspicious" | null {
    if (b.status !== "active") return null;
    if (b.wanted || this.isHot(b) || this.tick < b.crimeUntil) return "alarm";
    if (b.engaged && !b.engaged.startsWith("chat:")) return "alarm"; // safe-cracking
    const r = roomAt(this.env.rooms, b.pos);
    if (r && this.def.restricted?.includes(r)) return "suspicious";
    return null;
  }

  private chase(n: Npc, b: Body, shoutedBy?: string) {
    if (n.mode === "chat" && n.target !== undefined) this.bodies[n.target].engaged = null;
    n.mode = "chase";
    n.target = b.id;
    n.awareness = "alarmed";
    n.lostFor = 0;
    n.path = this.pathTo(n.pos, b.pos);
    b.wanted = true;
    this.events.push({ kind: "alarm", npc: n.npc, body: b.id });
    this.events.push({ kind: "say", npc: shoutedBy ?? n.npc, line: shoutedBy ? "Help! Security!" : b.echo ? "Oi! Stop right there!" : "Oi! You!" });
  }

  private updateNpcs() {
    for (const n of this.npcs) {
      n.running = false;
      if (n.mode === "ko") {
        n.moving = false;
        if (this.tick >= n.until) {
          n.awareness = "suspicious";
          this.resume(n);
        }
        continue;
      }
      switch (n.mode) {
        case "patrol": {
          n.patrolT += TICK;
          const p = this.patrolPose(n.npc, n.patrolT);
          n.moving = p.moving;
          n.pos = p.pos;
          n.yaw = p.yaw;
          break;
        }
        case "return":
          if (this.walk(n, GUARD_WALK)) {
            if (n.guard) n.mode = "patrol";
            else (n.mode = "hold"), (n.yaw = n.home.yaw);
          }
          break;
        case "go":
          if (this.walk(n, GUARD_WALK * 1.4)) {
            n.mode = "hold";
            if (n.lookAt) this.face(n, n.lookAt);
          }
          n.running = n.moving;
          if (this.tick >= n.until) this.resume(n);
          break;
        case "hold":
          if (n.path.length) this.walk(n, GUARD_WALK);
          else n.moving = false;
          if (n.guard && this.tick >= n.until) this.resume(n);
          break;
        case "look":
          n.moving = false;
          if (n.lookAt) this.face(n, n.lookAt);
          if (this.tick >= n.until) this.resume(n);
          break;
        case "chat": {
          n.moving = false;
          const b = n.target !== undefined ? this.bodies[n.target] : null;
          if (b) this.face(n, b.pos);
          break;
        }
        case "chase": {
          const b = this.bodies[n.target!];
          if (!b || b.status !== "active") {
            n.awareness = "suspicious";
            this.resume(n);
            break;
          }
          if (this.tick % 10 === 0) n.path = this.pathTo(n.pos, b.pos);
          this.walk(n, GUARD_RUN);
          n.running = true;
          const d = flat(n.pos, b.pos);
          if (d < CATCH && Math.abs(n.pos[1] - b.pos[1]) < 1.2) {
            this.catchBody(b, n.npc);
            n.awareness = "suspicious";
            this.resume(n);
            break;
          }
          n.lostFor = d > LOSE_DIST ? n.lostFor + 1 : 0;
          if (n.lostFor > LOSE_TICKS) {
            n.awareness = "suspicious";
            b.wanted = false;
            this.events.push({ kind: "say", npc: n.npc, line: "Blast. Lost them." });
            this.resume(n);
          }
          break;
        }
      }
      this.perceive(n);
    }
  }

  private perceive(n: Npc) {
    if (n.mode === "chat" || n.mode === "look" || n.mode === "chase" || n.mode === "ko") return;
    let worst: { b: Body; c: "alarm" | "suspicious" } | null = null;
    for (const b of this.bodies) {
      const c = this.concern(b);
      if (!c || !this.canSee(n, b.pos)) continue;
      if (!worst || (c === "alarm" && worst.c !== "alarm")) worst = { b, c };
    }
    if (!n.guard) {
      // guests don't chase: they shout for the nearest free guard
      if (worst?.c === "alarm" && !n.shouted) {
        const g = this.npcs.filter((x) => x.guard && x.mode !== "ko" && x.mode !== "chase" && x.mode !== "chat").sort((a, b) => flat(a.pos, worst!.b.pos) - flat(b.pos, worst!.b.pos))[0];
        n.awareness = "alarmed";
        n.shouted = true;
        if (g) this.chase(g, worst.b, n.npc);
      }
      return;
    }
    if (!worst) {
      if (n.susFor > 0 && --n.susFor === 0 && n.awareness === "suspicious") n.awareness = "calm";
      return;
    }
    if (worst.c === "alarm") return this.chase(n, worst.b);
    n.awareness = "suspicious";
    n.susFor += 2;
    if (n.mode === "patrol") n.patrolT -= TICK; // stops to stare
    this.face(n, worst.b.pos);
    if (n.susFor >= SUSPICIOUS_TICKS * 2) {
      this.events.push({ kind: "say", npc: n.npc, line: "You're not meant to be in here!" });
      this.chase(n, worst.b);
    }
  }

  private catchBody(b: Body, by: string) {
    if (b.carrying) {
      const it = this.items.get(b.carrying)!;
      it.carrier = null;
      it.pos = [b.pos[0], b.pos[1] + 0.05, b.pos[2]];
      b.carrying = null;
    }
    b.status = "caught";
    b.engaged = null;
    b.moving = false;
    this.events.push({ kind: "caught", body: b.id, by });
    this.events.push({ kind: "say", npc: by, line: b.echo ? "Got one!" : "Gotcha." });
    if (!b.echo) this.finish("caught");
  }

  /** A short digest of everything that matters, for determinism tests. */
  hash(): string {
    const r = (v: number) => v.toFixed(3);
    return [
      this.tick, this.status,
      ...this.bodies.map((b) => `${b.status}${b.carrying ?? ""}${r(b.pos[0])},${r(b.pos[2])}`),
      ...this.npcs.map((n) => `${n.npc}${n.mode}${r(n.pos[0])},${r(n.pos[2])}`),
      ...[...this.items.values()].map((i) => `${i.def.id}${i.escaped}${i.carrier}`),
    ].join("|");
  }
}

const CHAT_LINES = ["Oh! Well, I suppose I've a minute…", "Have we met? You've a familiar face.", "Lovely party, isn't it? Bit stuffy.", "Don't tell the butler I'm chatting."];
