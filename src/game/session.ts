// The game rules, independent of rendering. The Babylon front-end and the
// test bot both drive this. Deterministic given the same inputs.
import { LoopManager, LoopSummary, EndReason, Meta } from "../core/loop";
import { World, Awareness, Output } from "../core/world";
import { Storage } from "../core/storage";
import { test } from "../core/conditions";
import { contractStatus, ContractStatus } from "../core/contracts";
import { Vec3 } from "../core/schedule";
import { RATE, LOOP_END, LOOP_START } from "../core/clock";
import * as C from "../content";

export interface PlayerState {
  pos: Vec3; // feet
  yaw?: number;
}

export interface Offer {
  id: string; // interaction id, or "chat:<npc>", "punch:<npc>", "door:<id>"
  label: string;
  dist: number;
  npc?: string;
  anchor?: string;
  crime?: boolean;
}

/** One line in the conversation menu. */
export interface TalkOption {
  id: string; // "ask:<npc>:<topic>" or an interaction id
  label: string;
  kind: "ask" | "move" | "locked";
  note?: string; // why a move is greyed out
}

export interface ActResult {
  ok: boolean;
  witnessed: string[]; // npc ids who saw a crime
  message?: string;
}

const SECURITY = new Set(["brock", "hobbs", "hale"]);

export class Session {
  readonly loop: LoopManager;
  world!: World;
  player: PlayerState = { pos: [0, 0, -12.5] };
  elapsed = 0; // real seconds this loop
  chase: { by: string; since: number } | null = null;
  private observed = new Set<string>();
  private outputs: Output[] = [];
  private doneContracts = new Set<string>();
  private asked = new Set<string>();
  private greets = 0;
  ended: LoopSummary | null = null;
  /** anchors: interactable world positions (from spots.json, mirrored by the level) */
  readonly anchors: Record<string, Vec3>;
  readonly rooms: Record<string, [number, number, number, number]>;
  readonly doorIds: string[];

  constructor(storage: Storage, anchors?: Record<string, Vec3>) {
    this.loop = new LoopManager(C.content, storage);
    this.anchors = anchors ?? C.anchors;
    this.rooms = C.roomBounds;
    this.doorIds = Object.keys(this.anchors).filter((a) => a.startsWith("door.")).map((a) => a.slice(5));
  }

  get meta(): Meta {
    return this.loop.meta;
  }
  get minute() {
    return this.world.minute;
  }

  start() {
    this.world = this.loop.startLoop();
    this.elapsed = 0;
    this.chase = null;
    this.observed.clear();
    this.doneContracts.clear();
    this.asked.clear();
    this.ended = null;
    this.outputs = this.world.drain();
    this.player = { pos: [...C.spawn.pos] as Vec3, yaw: 0 };
  }

  roomAt(p: Vec3): string | null {
    for (const [id, b] of Object.entries(this.rooms)) if (p[0] >= b[0] - 0.3 && p[0] <= b[2] + 0.3 && p[2] >= b[1] - 0.3 && p[2] <= b[3] + 0.3) return id;
    return null;
  }

  /** Advance real time (seconds). Returns UI outputs produced. */
  tick(dt: number, player?: PlayerState): Output[] {
    if (this.ended) return [];
    if (player) this.player = player;
    this.elapsed += dt;
    const minute = Math.min(LOOP_END, LOOP_START + this.elapsed * RATE);
    const w = this.world;
    // dynamic flags derived from the player
    const room = this.roomAt(this.player.pos);
    if (room) w.flags[`visited.${room}`] = true;
    w.flags["player.room"] = room ?? "";
    for (const n of C.npcs) {
      const d = this.dist(n.id);
      w.flags[`player.near.${n.id}`] = d < 4;
    }
    w.advance(minute);
    this.observe();
    this.awareness();
    this.checkContracts();
    if (minute >= LOOP_END) this.end("midnight");
    const out = [...this.outputs, ...w.drain()];
    this.outputs = [];
    return out;
  }

  /** Skip ahead (pocket watch): only when nothing is chasing you. */
  wait(minutes: number) {
    if (this.chase) return false;
    this.elapsed += minutes / RATE;
    return true;
  }

  private dist(npc: string) {
    const p = this.world.npcPose(npc).pos;
    return Math.hypot(p[0] - this.player.pos[0], p[2] - this.player.pos[2]) + Math.abs(p[1] - this.player.pos[1]) * 0.5;
  }

  /** Overhear / notice things automatically. */
  private observe() {
    const w = this.world;
    for (const r of C.observeRules) {
      const key = `${r.intel}|${r.npc}|${r.tag ?? ""}`;
      if (this.observed.has(key)) continue;
      const pose = w.npcPose(r.npc);
      if (pose.override?.state === "ko") continue;
      if (r.tag && pose.tag !== r.tag) continue;
      if (r.tag && pose.moving) continue;
      if (this.dist(r.npc) > r.radius) continue;
      if (this.roomAt(pose.pos) !== this.roomAt(this.player.pos)) continue;
      this.observed.add(key);
      this.outputs.push({ kind: "say", npc: r.npc, line: r.line });
      w.learn(r.intel);
    }
    for (const r of C.lookRules) {
      if (w.intel.has(r.intel)) continue;
      const a = this.anchors[r.anchor];
      if (!a) continue;
      if (Math.hypot(a[0] - this.player.pos[0], a[2] - this.player.pos[2]) < r.radius) w.learn(r.intel);
    }
  }

  /** Who can see the player right now (simple cone + range, same room, conscious). */
  witnesses(): string[] {
    const w = this.world, me = this.player.pos, myRoom = this.roomAt(me);
    const out: string[] = [];
    const dark = !!w.flags["lights.out"];
    for (const n of C.npcs) {
      const pose = w.npcPose(n.id);
      if (pose.override?.state === "ko") continue;
      if (this.roomAt(pose.pos) !== myRoom) continue;
      const dx = me[0] - pose.pos[0], dz = me[2] - pose.pos[2];
      const d = Math.hypot(dx, dz);
      const range = dark ? 2.2 : 7;
      if (d > range) continue;
      const fwd = [Math.sin(pose.yaw), Math.cos(pose.yaw)];
      const cos = d < 1.2 ? 1 : (fwd[0] * dx + fwd[1] * dz) / d;
      if (cos > Math.cos((70 * Math.PI) / 180)) out.push(n.id);
    }
    return out;
  }

  private awareness() {
    const w = this.world;
    const studyLocked = !!w.flags["door.study.locked"];
    const inStudy = this.roomAt(this.player.pos) === "study";
    for (const n of C.npcs) {
      const cur = w.awareness[n.id];
      if (cur === "alarmed") continue;
      let next: Awareness = "calm";
      if (inStudy && studyLocked && this.witnesses().includes(n.id) && !w.flags["has.jacket"]) next = "suspicious";
      w.awareness[n.id] = next;
    }
  }

  private alarm(witnesses: string[]) {
    const w = this.world;
    for (const id of witnesses) w.awareness[id] = "alarmed";
    if (!witnesses.length || this.chase) return;
    // security responds; Brock comes running if a guest shouts
    const by = witnesses.find((id) => SECURITY.has(id)) ?? (w.npcPose("brock").override?.state === "ko" ? null : "brock");
    if (!by) return;
    this.chase = { by, since: this.world.minute };
    w.overrides[by] = { state: "chasing" };
    this.outputs.push({ kind: "say", npc: witnesses[0], line: witnesses[0] === by ? "Oi! You!" : "Help! Security!" });
  }

  /** Lose the chaser (front-end calls this when the player gets away). */
  escape() {
    if (!this.chase) return;
    delete this.world.overrides[this.chase.by];
    for (const id of Object.keys(this.world.awareness)) this.world.awareness[id] = "suspicious";
    this.chase = null;
    this.outputs.push({ kind: "toast", text: "You lost him. Keep your head down." });
  }

  caught() {
    this.end("caught");
  }

  // ---------------------------------------------------------------- interactions

  private anchorDist(id: string) {
    const a = this.anchors[id];
    if (!a) return Infinity;
    // things up to ~3.2 m high (the painting over the safe) are within reach
    return Math.hypot(a[0] - this.player.pos[0], a[2] - this.player.pos[2]) + Math.max(0, Math.abs(a[1] - (this.player.pos[1] + 1.2)) - 2) * 0.5;
  }

  /** Context actions available where the player stands, nearest first. */
  offers(): Offer[] {
    const w = this.world, out: Offer[] = [];
    for (const it of C.interactions) {
      if (it.talk) continue; // social moves live in the conversation menu
      if (it.when && !test(it.when, w.ctx)) continue;
      let d = Infinity;
      if (it.target.npc) {
        const pose = w.npcPose(it.target.npc);
        if (pose.override?.state === "ko" && !it.id.startsWith("ledger.")) continue;
        if (it.npcTag && (!pose.tag || !it.npcTag.includes(pose.tag) || pose.moving)) continue;
        d = this.dist(it.target.npc);
        if (d > 2.4) continue;
      } else if (it.target.anchor) {
        d = this.anchorDist(it.target.anchor);
        if (d > 2.4) continue;
      }
      out.push({ id: it.id, label: it.label, dist: d, npc: it.target.npc, anchor: it.target.anchor, crime: it.crime });
    }
    // generic: chat / punch the nearest conscious NPC
    let best: string | null = null, bd = 2.2;
    for (const n of C.npcs) {
      const pose = w.npcPose(n.id);
      if (pose.override?.state === "ko") continue;
      const d = this.dist(n.id);
      if (d < bd) (bd = d), (best = n.id);
    }
    if (best) {
      const name = C.npcMeta[best].short;
      if (!this.chase) out.push({ id: `talk:${best}`, label: `Talk to ${name}${this.hasMove(best) ? " ❝" : ""}`, dist: bd + 0.01, npc: best });
      out.push({ id: `punch:${best}`, label: `Punch ${name}`, dist: bd + 0.02, npc: best, crime: true });
    }
    // doors you can open/close (unlocked ones)
    for (const d of this.doorIds) {
      const dd = this.anchorDist(`door.${d}`);
      if (dd > 2.0) continue;
      if (w.flags[`door.${d}.locked`]) continue;
      const open = w.flags[`door.${d}.open`] !== false;
      out.push({ id: `door:${d}`, label: open ? "Close the door" : "Open the door", dist: dd + 0.05, anchor: `door.${d}` });
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  // ---------------------------------------------------------------- conversation

  /** Does this person have a social move ready for you right now? (shown as ❝ on the prompt) */
  hasMove(npc: string) {
    return this.talkOptions(npc).some((o) => o.kind === "move");
  }

  /** A greeting line; varies each time you start a conversation. */
  greet(npc: string) {
    const lines = C.barks[npc] ?? C.barks.default;
    return lines[this.greets++ % lines.length];
  }

  /** The conversation menu for one person: social moves first, then questions not yet asked. */
  talkOptions(npc: string): TalkOption[] {
    const w = this.world, out: TalkOption[] = [];
    const pose = w.npcPose(npc);
    for (const it of C.interactions) {
      if (!it.talk || it.target.npc !== npc) continue;
      const ready = (!it.when || test(it.when, w.ctx)) && (!it.npcTag || (!!pose.tag && it.npcTag.includes(pose.tag) && !pose.moving));
      const shown = ready || test(it.show ?? it.when ?? true, w.ctx);
      if (!shown) continue;
      out.push(ready ? { id: it.id, label: it.label, kind: "move" } : { id: it.id, label: it.label, kind: "locked", note: it.notYet });
    }
    for (const t of C.talk[npc] ?? []) {
      if (this.asked.has(`${npc}:${t.id}`)) continue;
      if (t.when && !test(t.when, w.ctx)) continue;
      // a tip about something you already know isn't worth asking
      if (!t.learn && t.tip && w.intel.has(t.tip)) continue;
      out.push({ id: `ask:${npc}:${t.id}`, label: t.ask, kind: "ask" });
    }
    return out;
  }

  private ask(npc: string, topicId: string): ActResult {
    const w = this.world;
    const t = (C.talk[npc] ?? []).find((x) => x.id === topicId);
    if (!t || this.asked.has(`${npc}:${topicId}`) || (t.when && !test(t.when, w.ctx))) return { ok: false, witnessed: [] };
    this.asked.add(`${npc}:${topicId}`);
    this.outputs.push({ kind: "say", npc, line: t.line });
    if (t.learn) w.learn(t.learn);
    if (t.tip && !w.intel.has(t.tip) && !w.flags[`tip.${t.tip}`]) {
      w.flags[`tip.${t.tip}`] = true;
      this.outputs.push({ kind: "toast", text: `New lead: ${C.board.get(t.tip).hint}` });
    }
    return { ok: true, witnessed: [] };
  }

  perform(id: string): ActResult {
    const w = this.world;
    if (id.startsWith("ask:")) {
      const [, npc, topic] = id.split(":");
      return this.ask(npc, topic);
    }
    if (id.startsWith("talk:")) return { ok: true, witnessed: [] }; // the front-end opens the menu
    if (id.startsWith("punch:")) return this.punch(id.slice(6));
    if (id.startsWith("door:")) {
      const d = id.slice(5);
      w.apply([{ set: `door.${d}.open`, value: w.flags[`door.${d}.open`] === false }]);
      return { ok: true, witnessed: [] };
    }
    const it = C.interactions.find((x) => x.id === id);
    if (!it) return { ok: false, witnessed: [], message: "Nothing to do." };
    const tagOk = !it.npcTag || !it.target.npc || ((p) => !!p.tag && it.npcTag!.includes(p.tag) && !p.moving)(w.npcPose(it.target.npc));
    if ((it.when && !test(it.when, w.ctx)) || !tagOk) {
      if (it.notYet) this.outputs.push({ kind: "toast", text: it.notYet });
      return { ok: false, witnessed: [], message: it.notYet };
    }
    if (it.requires && !test(it.requires, w.ctx)) {
      if (it.denied) this.outputs.push({ kind: "toast", text: it.denied });
      return { ok: false, witnessed: [], message: it.denied };
    }
    const seen = it.crime ? this.witnesses().filter((n) => n !== it.target.npc) : [];
    w.apply(it.do);
    if (seen.length) this.alarm(seen);
    this.checkContracts();
    return { ok: true, witnessed: seen };
  }

  /** Comic knockout. Loud, and anyone watching will shout. */
  punch(npc: string): ActResult {
    const w = this.world;
    const seen = this.witnesses().filter((n) => n !== npc);
    w.apply([{ npc, override: { state: "ko", until: Math.min(LOOP_END, w.minute + 75) } }]);
    if (this.roomAt(this.player.pos) === "ballroom" && w.minute >= 21 * 60 + 30 && w.minute < 22 * 60) w.apply([{ set: "brawl" }]);
    if (npc === "calloway" && w.flags["ledger.carried"] && !w.flags["has.ledger"]) w.apply([{ set: "has.ledger" }, { set: "c1.loud" }, { set: "ledger.carried", value: false }]);
    if (this.chase?.by === npc) {
      delete w.overrides[npc];
      w.overrides[npc] = { state: "ko", until: Math.min(LOOP_END, w.minute + 75), pos: [...w.npcPose(npc).pos] };
      this.chase = null;
    }
    this.outputs.push({ kind: "say", npc, line: ["Oof!", "Ow! My monocle!", "Not the face!", "Unhand— oof."][Math.floor(w.minute) % 4] });
    if (seen.length) this.alarm(seen);
    this.checkContracts();
    return { ok: true, witnessed: seen };
  }

  // ---------------------------------------------------------------- contracts & loop end

  /** Contracts on offer this loop (later ones unlock as you go). */
  contractStatus(): ContractStatus[] {
    const ctx = this.world.ctx;
    return C.contracts.filter((c) => !c.unlock || test(c.unlock, ctx)).map((c) => contractStatus(c, ctx));
  }

  private checkContracts() {
    for (const st of this.contractStatus()) {
      if (st.complete && !this.doneContracts.has(st.contract.id)) {
        this.doneContracts.add(st.contract.id);
        this.outputs.push({ kind: "toast", text: `Contract complete: ${st.contract.title} (${st.complete.title})` });
      }
    }
  }

  lead() {
    return C.board.lead(this.world.ctx);
  }

  end(reason: EndReason) {
    if (this.ended) return this.ended;
    this.ended = this.loop.endLoop(reason);
    return this.ended;
  }
}
