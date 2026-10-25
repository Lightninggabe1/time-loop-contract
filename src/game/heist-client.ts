// Browser front-end for the heist sim: steps the Round at a fixed 30 Hz,
// feeds it the player, and shows everything it says — echoes, guards and
// guests, doors, loot, blackouts, the chandelier — plus the HUD and the cards
// between rounds. All rules live in src/core/heist/; this file only shows them.
import {
  Scene, Vector3, Matrix, TransformNode, Quaternion, ParticleSystem, Color4, Color3, Mesh, MeshBuilder, StandardMaterial,
} from "@babylonjs/core";
import { Round, Track, Act, Npc, Body, RoundEvent } from "../core/heist/round";
import { Crew } from "../core/heist/crew";
import { TICK, ROUND_SECONDS } from "../core/heist/defs";
import { heists, env } from "../content/heists";
import { NpcActor } from "../characters/npc";
import { LocalStorage } from "../core/storage";
import type { NpcPose, Vec3 } from "../core/schedule";
import type { BuiltWing } from "../level/build";
import type { Doors } from "../level/doors";
import type { Player } from "../player/player";
import type { Input } from "../player/input";
import type { Lighting } from "../render/lighting";
import { HeistUI, ECHO_COLORS, CrewChip } from "../ui/heist-ui";
import { Audio } from "../audio/audio";

const MAX_ECHOES = 6;
const EYE = 1.62;

export class HeistClient {
  readonly crew = new Crew(new LocalStorage("tlc."), heists);
  readonly audio = new Audio();
  readonly ui: HeistUI;
  round!: Round;
  heistId: string;
  private npcActors = new Map<string, NpcActor>();
  private echoActors: NpcActor[] = [];
  private echoRings: Mesh[] = [];
  private itemMeshes = new Map<string, Mesh>();
  private plateMeshes = new Map<string, Mesh>();
  private acc = 0;
  private pending: Act[] = [];
  private paused = true;
  private ready = false;
  private shown = false; // the end card for this round
  private bubbles = new Map<string, { text: string; until: number }>();
  private lightsOut = false;
  private baseIntensity = new Map<object, number>();
  private chandelier: TransformNode | null = null;
  private chandelierFall = -1;
  private painting: { pivot: TransformNode; open: number; dir: number } | null = null;
  private ignoreInteractUntil = 0;
  private lastPos = new Map<number, Vec3>();

  constructor(
    private scene: Scene,
    private room: BuiltWing,
    private doors: Doors,
    private player: Player,
    private input: Input,
    private lighting: Lighting,
  ) {
    this.heistId = this.crew.current;
    this.ui = new HeistUI({
      onAct: (i) => this.actOffer(i),
      onRewind: () => this.rewind(),
      onHint: () => this.hint(),
      onPause: (p) => {
        this.paused = p;
        this.player.enabled = !p;
        if (!p) {
          this.input.read(); // the key that closed a card must not also act in the world
          this.ignoreInteractUntil = performance.now() + 300;
        }
      },
      onStart: () => this.ui.hideCard(),
      onKeep: (slot) => {
        this.crew.keep(this.heistId, this.round.recording(), slot ?? undefined);
        this.newRound(true);
      },
      onRedo: () => this.newRound(true),
      onClearCrew: () => {
        this.crew.clear(this.heistId);
        this.newRound(false);
      },
      onPick: (id) => this.pick(id),
    });
    this.newRound(false, true);
  }

  get def() {
    return this.crew.heist(this.heistId);
  }
  get isReady() {
    return this.ready;
  }

  /** Load this heist's people in the background (the room is already playable). */
  async loadCast() {
    await this.ensureActors();
    // the chandelier over the stage steps (the one on the rope)
    let best: TransformNode | null = null, bd = Infinity;
    for (const t of this.scene.transformNodes) {
      if (!t.name.startsWith("Chandelier_02")) continue;
      let top: TransformNode = t;
      while (top.parent && top.parent instanceof TransformNode) top = top.parent as TransformNode;
      const d = Vector3.Distance(top.getAbsolutePosition(), new Vector3(2.8, 5, 8.8));
      if (d < bd) (bd = d), (best = top);
    }
    this.chandelier = best;
    this.hingePainting();
    this.ready = true;
    this.placeAll(0, true);
  }

  private loading = new Map<string, Promise<NpcActor>>();
  private actor(key: string, model: string) {
    let p = this.loading.get(key);
    if (!p) {
      const hidden: NpcPose = { pos: [0, -50, 0], yaw: 0, act: "idle", spot: "", entry: 0, moving: false };
      const a = new NpcActor(this.scene, key, model);
      p = a.init(hidden).then(() => {
        this.lighting.addDynamic(a.meshes);
        return a;
      });
      this.loading.set(key, p);
    }
    return p;
  }

  /** Only the people this heist needs, and only as many echoes as it can have:
   *  phones run out of GPU memory with everyone loaded at once. */
  private async ensureActors() {
    const def = this.def;
    const ids = [...def.guards.map((g) => g.npc), ...(def.guests ?? []).map((g) => g.npc)];
    await Promise.all([
      ...ids.map(async (id) => this.npcActors.set(id, await this.actor(id, id))),
      ...Array.from({ length: Math.min(MAX_ECHOES, def.cap) }, async (_, i) => {
        if (this.echoActors[i]) return;
        const a = await this.actor(`echo${i}`, "fixer");
        a.root.setEnabled(false);
        this.echoActors[i] = a;
        // a coloured ring at their feet
        const ring = MeshBuilder.CreateTorus(`echo_ring${i}`, { diameter: 0.9, thickness: 0.05, tessellation: 40 }, this.scene);
        const m = new StandardMaterial(`echo_ring_m${i}`, this.scene);
        m.disableLighting = true;
        m.emissiveColor = Color3.FromHexString(ECHO_COLORS[i]);
        m.alpha = 0.85;
        ring.material = m;
        ring.isPickable = false;
        ring.parent = a.root;
        ring.position.y = 0.03;
        this.echoRings[i] = ring;
      }),
    ]);
    this.placeAll(0, true);
  }

  // ---------------------------------------------------------------- rounds

  private newRound(keepCard: boolean, briefing = false) {
    const def = this.def;
    this.round = new Round(def, env, this.crew.echoes(this.heistId));
    this.acc = 0;
    this.pending = [];
    this.shown = false;
    this.bubbles.clear();
    this.lastPos.clear();
    const sp = def.spawn.pos;
    this.player.setPose(new Vector3(sp[0], sp[1], sp[2]), (def.spawn.yaw * Math.PI) / 180);
    this.resetSetPieces();
    this.buildProps();
    if (this.ready) void this.ensureActors().catch((e) => console.error("cast failed", e));
    this.placeAll(0, true);
    for (const e of this.round.drain()) this.event(e);
    this.audio.setMusic("band");
    this.ui.hideCard();
    if (briefing || (!keepCard && this.round.bodies.length === 1)) this.ui.briefing(def, this.round.bodies.length - 1, this.crew.stars(def.id));
  }

  private pick(id: string): void {
    if (id === "") {
      return this.ui.heistList(heists.map((h) => ({ def: h, stars: this.crew.stars(h.id), open: this.crew.unlocked(h.id) })));
    }
    if (id === "next") {
      const next = heists.find((h) => h.n === this.def.n + 1);
      if (!next) return this.pick("");
      id = next.id;
    }
    this.heistId = id;
    this.crew.current = id;
    this.newRound(false, true);
  }

  rewind() {
    if (this.round.status !== "running" || this.ui.open) return;
    this.round.endEarly();
  }

  hint() {
    const r = this.round, n = r.bodies.length;
    const tip = this.def.tips?.[String(n)] ?? this.def.tips?.["*"];
    this.ui.toast(tip ?? "Watch what the guards do, then give them something else to do.", "intel");
  }

  // ---------------------------------------------------------------- per frame

  update(dt: number) {
    if (this.round.status !== "running") {
      this.input.read();
      if (!this.shown) this.endCard();
      this.placeAll(dt);
      return;
    }
    if (this.paused) {
      this.input.read(); // swallow input while cards are up
      this.placeAll(dt);
      return;
    }
    // input → actions
    const s = this.input.peekEdges();
    const offers = this.rankedOffers();
    this.ui.setOffers(offers.slice(0, 3).map((o) => ({ label: o.label, risky: o.verb === "punch" })));
    if (s.interact && offers[0] && performance.now() > this.ignoreInteractUntil) this.actOffer(0);
    for (let i = 0; i < 3; i++) if (s.number === i + 1 && offers[i]) this.actOffer(i);
    if (s.punch) {
      const i = offers.findIndex((o) => o.verb === "punch");
      if (i >= 0) this.actOffer(i);
    }
    if (s.item) this.rewind();
    // fixed-step sim
    this.acc += Math.min(dt, 0.25);
    const cam = this.player.camera.position;
    const feet: Vec3 = [cam.x, cam.y - EYE, cam.z];
    while (this.acc >= TICK && this.round.status === "running") {
      this.acc -= TICK;
      this.round.step(feet, this.player.yaw, this.pending);
      this.pending = [];
      for (const e of this.round.drain()) this.event(e);
    }
    this.placeAll(dt);
    this.audio.setRoom(this.room.roomOf(cam)?.id ?? null, Math.hypot(cam.x, cam.z - 11.5), this.round.dark);
    this.ui.setTimer(this.round.left, ROUND_SECONDS);
    this.ui.setPanel(this.def, this.round.bodies.length, this.chips(), this.goal());
    this.updateBubbles();
    this.updateTags(offers[0]);
  }

  private chips(): CrewChip[] {
    return this.round.bodies.map((b) => (b.echo ? { slot: b.id, status: b.status, label: b.reason ?? `Echo ${b.id + 1}` } : { slot: b.id, status: "you" as const, label: "You" }));
  }

  /** The next thing to do, in a few words. */
  private goal() {
    const r = this.round;
    const main = [...r.items.values()].find((i) => i.def.main)!;
    if (main.carrier !== null) return `Get the ${main.def.label} to the ${r.def.exit.label.toLowerCase()}`;
    if (!main.free) return r.def.goal;
    return `Grab the ${main.def.label}`;
  }

  private rankedOffers() {
    const cam = this.player.camera, fwd = cam.getForwardRay().direction;
    return this.round.offers().map((o, i) => {
      let s = o.dist;
      if (o.pos) {
        const to = new Vector3(o.pos[0], o.pos[1] + (o.verb === "chat" || o.verb === "punch" ? 1.4 : 0), o.pos[2]).subtract(cam.position);
        s = o.dist * (1.7 - Vector3.Dot(to.normalize(), fwd));
      }
      return { o, s, i };
    }).sort((a, b) => (a.o.target && a.o.target === b.o.target ? a.i - b.i : a.s - b.s)).map((x) => x.o);
  }

  private actOffer(i: number) {
    const o = this.rankedOffers()[i];
    if (!o) return;
    this.pending.push({ verb: o.verb, target: o.target });
    if (o.verb === "punch") {
      this.ui.flash();
      this.audio.play(Math.random() < 0.5 ? "punch" : "punch2", 0.8);
    } else this.audio.play("click", 0.3);
  }

  // ---------------------------------------------------------------- events

  private event(e: RoundEvent) {
    const r = this.round;
    const who = (b: number) => (b === r.player.id ? "You" : `Echo ${b + 1}`);
    switch (e.kind) {
      case "say":
        this.bubbles.set(e.npc, { text: e.line, until: performance.now() + 3200 });
        break;
      case "toast":
        this.ui.toast(e.text, e.tone);
        break;
      case "stall":
        this.ui.toast(`Echo ${e.body + 1} is stuck: ${e.reason}`, "warn");
        break;
      case "caught":
        if (e.body !== r.player.id) this.ui.toast(`Echo ${e.body + 1} got nabbed!`, "warn");
        this.audio.play("seen", 0.5, 0.8);
        break;
      case "alarm":
        if (e.body === r.player.id) this.ui.toast(`${env.names[e.npc]} is after you — run!`, "warn");
        this.audio.play("seen", 0.5);
        break;
      case "ko":
        this.npcActors.get(e.npc)?.gesture("hit");
        if (e.by !== r.player.id) this.audio.play("punch", 0.6);
        break;
      case "device":
        if (e.device === "blackout") this.audio.play("switch", 0.8);
        if (e.device === "chandelier") this.chandelierFall = 0;
        if (e.device === "bell") this.audio.alarmBell();
        if (e.device === "announce") this.fireworks();
        if (e.device === "noise") this.ui.toast("A record crackles into life.");
        break;
      case "opened":
        this.ui.toast("Click. The safe swings open.", "good");
        this.audio.play("open", 0.6, 0.8);
        break;
      case "take":
        if (e.body === r.player.id) this.audio.play("noted", 0.4);
        break;
      case "escaped":
        this.ui.toast(`${who(e.body)} got the ${r.items.get(e.item)!.def.label} out!`, "good");
        break;
      case "end":
        if (e.status === "won") this.audio.play("fanfare", 0.7);
        else if (e.status === "timeup") this.audio.midnight();
        break;
    }
  }

  private endCard() {
    this.shown = true;
    const r = this.round, def = this.def;
    if (r.status === "won") this.crew.won(def.id, r.stars());
    const n = r.bodies.length;
    this.ui.roundOver(def, {
      status: r.status,
      round: n,
      echoes: n - 1,
      tip: def.tips?.[String(n)] ?? def.tips?.["*"],
      stars: r.stars(),
      seconds: r.wonAt * TICK,
    });
  }

  // ---------------------------------------------------------------- showing the sim

  private pose(n: Npc): NpcPose & { override?: { state: "ko" | "chasing" | "distracted" } } {
    return {
      pos: n.pos, yaw: n.yaw, act: n.mode === "chat" ? "talk" : "idle", spot: "", entry: 0, moving: n.moving,
      override: n.mode === "ko" ? { state: "ko" } : n.running && n.moving ? { state: "chasing" } : undefined,
    };
  }

  private placeAll(dt: number, snap = false) {
    if (!this.ready) return;
    const r = this.round;
    const here = new Set(r.npcs.map((n) => n.npc));
    for (const [id, a] of this.npcActors) {
      a.root.setEnabled(here.has(id));
      const n = r.npc(id);
      if (!n) continue;
      a.place(this.pose(n), dt, snap);
      a.setAwareness(n.awareness);
    }
    r.bodies.forEach((b) => {
      if (!b.echo) return;
      const a = this.echoActors[b.id];
      if (!a) return;
      a.root.setEnabled(b.status !== "out");
      a.place(this.echoPose(b, dt), dt, snap);
      a.setAwareness(b.status === "stalled" ? "suspicious" : "calm");
    });
    for (let i = r.bodies.length - 1; i < MAX_ECHOES; i++) this.echoActors[i]?.root.setEnabled(false);
    // doors: the heist's doors follow the sim; the others stand open
    for (const d of this.room.doors) {
      const s = r.doors.get(d.spec.id);
      this.doors.setOpen(d.spec.id, s ? s.open : d.spec.id !== "upstairs");
    }
    // loot and plates
    for (const [id, m] of this.itemMeshes) {
      const it = r.items.get(id)!;
      const mine = it.carrier === r.player.id;
      m.setEnabled(it.free && !it.escaped && !mine);
      m.position.set(it.pos[0], it.pos[1] + (it.carrier === null ? 0.08 + Math.sin(performance.now() / 400) * 0.03 : 0.2), it.pos[2]);
      m.rotation.y += dt * 1.2;
    }
    for (const [id, m] of this.plateMeshes) {
      const on = r.devices.get(id)!.done;
      (m.material as StandardMaterial).emissiveColor = on ? new Color3(0.45, 0.32, 0.1) : new Color3(0.06, 0.04, 0.01);
    }
    const safe = [...r.devices.values()].find((d) => d.def.kind === "safe");
    this.swingPainting(dt, !!safe && (safe.done || r.bodies.some((b) => b.engaged === safe.def.id)));
    this.blackout(r.dark);
    this.animateChandelier(dt);
  }

  private echoPose(b: Body, dt: number): NpcPose & { override?: { state: "ko" | "chasing" } } {
    const last = this.lastPos.get(b.id);
    const speed = last && dt > 0 ? Math.hypot(b.pos[0] - last[0], b.pos[2] - last[2]) / dt : 0;
    this.lastPos.set(b.id, [...b.pos]);
    return {
      pos: b.pos, yaw: b.yaw, act: b.engaged ? "work" : "idle", spot: "", entry: 0, moving: b.moving,
      override: b.status === "caught" ? { state: "ko" } : b.moving && speed > 4.2 ? { state: "chasing" } : undefined,
    };
  }

  /** Simple, readable stand-ins for the loot and the plates (per heist). */
  private buildProps() {
    for (const m of this.itemMeshes.values()) m.dispose();
    for (const m of this.plateMeshes.values()) m.dispose();
    this.itemMeshes.clear();
    this.plateMeshes.clear();
    const mat = (name: string, c: string, emis = 0.25) => {
      const m = new StandardMaterial(name, this.scene);
      m.diffuseColor = Color3.FromHexString(c);
      m.emissiveColor = Color3.FromHexString(c).scale(emis);
      m.specularColor = new Color3(0.9, 0.9, 0.9);
      m.specularPower = 64;
      return m;
    };
    for (const it of this.round.items.values()) {
      let m: Mesh;
      const id = it.def.id;
      if (id === "ruby") {
        m = MeshBuilder.CreatePolyhedron(`loot_${id}`, { type: 1, size: 0.09 }, this.scene);
        m.material = mat("loot_ruby", "#C8102E", 0.35);
      } else if (id === "pearls") {
        // a loop of beads
        const beads = Array.from({ length: 18 }, (_, k) => {
          const b = MeshBuilder.CreateSphere(`bead${k}`, { diameter: 0.026, segments: 6 }, this.scene);
          const a = (k / 18) * Math.PI * 2;
          b.position.set(Math.cos(a) * 0.09, 0, Math.sin(a) * 0.11);
          return b;
        });
        m = Mesh.MergeMeshes(beads, true)!;
        m.name = `loot_${id}`;
        m.material = mat("loot_pearls", "#EDE6D8", 0.12);
      } else {
        m = MeshBuilder.CreateBox(`loot_${id}`, { width: 0.32, height: 0.12, depth: 0.22 }, this.scene);
        m.material = mat(`loot_${id}`, it.def.key ? "#E2B25C" : "#5A3A22", 0.3);
      }
      m.isPickable = false;
      this.lighting.addDynamic([m]);
      this.itemMeshes.set(id, m);
    }
    for (const d of this.round.devices.values()) {
      if (d.def.kind !== "plate") continue;
      const m = MeshBuilder.CreateCylinder(`plate_${d.def.id}`, { diameter: (d.def.r ?? 0.8) * 2, height: 0.03, tessellation: 48 }, this.scene);
      m.position.set(d.def.pos[0], d.def.pos[1] + 0.015, d.def.pos[2]);
      const pm = mat(`plate_m_${d.def.id}`, "#8A6424", 0.1);
      pm.specularColor = new Color3(0.25, 0.2, 0.12);
      m.material = pm;
      m.isPickable = false;
      this.lighting.addDynamic([m]);
      this.plateMeshes.set(d.def.id, m);
    }
  }

  // ---------------------------------------------------------------- labels

  private screen(v: Vector3) {
    const engine = this.scene.getEngine();
    const vp = this.scene.activeCamera!.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const p = Vector3.Project(v, Matrix.Identity(), this.scene.getTransformMatrix(), vp);
    const k = engine.getHardwareScalingLevel();
    return { x: p.x * k, y: p.y * k };
  }

  private visible(p: Vector3, range: number) {
    const cam = this.player.camera;
    const to = p.subtract(cam.position);
    const d = to.length();
    return d < range && Vector3.Dot(to.scale(1 / d), cam.getForwardRay().direction) > 0.3;
  }

  private updateTags(primary?: { target?: string }) {
    const r = this.round, list: { key: string; x: number; y: number; text: string; cls: string; color?: string }[] = [];
    for (const b of r.bodies) {
      if (!b.echo || b.status === "out") continue;
      const p = new Vector3(b.pos[0], b.pos[1] + 2.05, b.pos[2]);
      if (!this.visible(p, 30)) continue;
      const q = this.screen(p);
      list.push({ key: `e${b.id}`, ...q, text: `${b.id + 1}${b.status === "stalled" ? " ?" : b.status === "caught" ? " ✕" : ""}`, cls: "echo", color: ECHO_COLORS[b.id % 6] });
    }
    for (const n of r.npcs) {
      if (this.bubbles.has(n.npc) || n.mode === "ko") continue;
      const p = new Vector3(n.pos[0], n.pos[1] + 2.0, n.pos[2]);
      if (!this.visible(p, n.guard ? 12 : 7)) continue;
      list.push({ key: n.npc, ...this.screen(p), text: env.names[n.npc] ?? n.npc, cls: (n.guard ? "guard" : "") + (primary?.target === n.npc ? " focus" : "") });
    }
    for (const d of r.devices.values()) {
      if (d.def.kind === "plate" || (d.used && d.def.kind !== "safe") || (d.def.kind === "safe" && d.done)) continue;
      const p = new Vector3(d.def.pos[0], d.def.pos[1] + 0.35, d.def.pos[2]);
      if (!this.visible(p, 8)) continue;
      const pct = d.def.kind === "safe" && d.progress > 0 ? ` ${Math.round((100 * d.progress) / (d.def.time ?? 20))}%` : "";
      list.push({ key: `d${d.def.id}`, ...this.screen(p), text: `${d.def.label.replace(/^(Crack|Pull|Put|Light|Cut|Ring) (the |a )?/i, "")}${pct}`, cls: "thing" + (primary?.target === d.def.id ? " focus" : "") });
    }
    for (const it of r.items.values()) {
      if (!it.free || it.carrier !== null || it.escaped) continue;
      const p = new Vector3(it.pos[0], it.pos[1] + 0.35, it.pos[2]);
      if (!this.visible(p, 12)) continue;
      list.push({ key: `i${it.def.id}`, ...this.screen(p), text: `${it.def.label[0].toUpperCase()}${it.def.label.slice(1)}`, cls: "thing loot" + (primary?.target === it.def.id ? " focus" : "") });
    }
    const ex = r.def.exit.pos, hot = r.player.carrying !== null;
    const ep = new Vector3(ex[0], ex[1] + 1.4, ex[2]);
    if (hot && this.visible(ep, 60)) list.push({ key: "exit", ...this.screen(ep), text: `⇥ ${r.def.exit.label}`, cls: "exit" });
    this.ui.setTags(list);
  }

  private updateBubbles() {
    const now = performance.now(), out: { id: string; x: number; y: number; text: string; name: string }[] = [];
    for (const [id, b] of this.bubbles) {
      if (now > b.until) {
        this.bubbles.delete(id);
        continue;
      }
      const a = this.npcActors.get(id);
      if (!a) continue;
      const head = a.position.add(new Vector3(0, 2.05, 0));
      if (!this.visible(head, 16)) continue;
      out.push({ id, ...this.screen(head), text: b.text, name: env.names[id] ?? id });
    }
    this.ui.setBubbles(out);
  }

  // ---------------------------------------------------------------- set pieces

  private resetSetPieces() {
    this.chandelierFall = -1;
    if (this.chandelier) {
      const c = this.chandelier as unknown as { _y0?: number; _crashed?: boolean };
      if (c._y0 !== undefined) this.chandelier.position.y = c._y0;
      c._crashed = false;
      this.chandelier.rotationQuaternion = Quaternion.Identity();
    }
    this.blackout(false, true);
    if (this.painting) (this.painting.open = 0), (this.painting.pivot.rotation.y = 0);
  }

  /** The sunset painting in the study swings out on a hinge to reveal the safe. */
  private hingePainting() {
    const p = this.room.props.painting;
    const a = this.room.anchors.safe;
    if (!p || !a) return;
    p.computeWorldMatrix(true);
    const { min, max } = p.getHierarchyBoundingVectors(true);
    const n = a.normal.clone();
    n.y = 0;
    n.normalize();
    const side = Vector3.Cross(Vector3.Up(), n).normalize();
    const half = (Math.abs(side.x) * (max.x - min.x) + Math.abs(side.z) * (max.z - min.z)) / 2;
    const center = min.add(max).scale(0.5);
    const pivot = new TransformNode("painting_hinge", this.scene);
    pivot.position.copyFrom(center.add(side.scale(half)));
    p.setParent(pivot);
    const off = center.subtract(pivot.position);
    const test1 = Vector3.TransformCoordinates(off, Matrix.RotationY(1.2));
    const dir = Vector3.Dot(test1.subtract(off), n) > 0 ? 1 : -1;
    this.painting = { pivot, open: 0, dir };
  }

  private swingPainting(dt: number, open: boolean) {
    const p = this.painting;
    if (!p) return;
    const target = open ? 1 : 0;
    if (p.open === target) return;
    if (open && p.open === 0) this.audio.play("open", 0.5, 0.7);
    p.open = open ? Math.min(1, p.open + dt * 1.6) : 0;
    const e = 1 - Math.pow(1 - p.open, 3);
    p.pivot.rotation.y = p.dir * 1.85 * e;
  }

  private blackout(on: boolean, quiet = false) {
    if (on === this.lightsOut) return;
    this.lightsOut = on;
    // every light we own, including the clustered ones (they are not in scene.lights)
    const all = [...this.scene.lights, ...this.scene.lights.flatMap((l) => ((l as unknown as { lights?: typeof l[] }).lights ?? []))];
    for (const l of all) {
      if (l.name.startsWith("moon") || l.getClassName() === "ClusteredLightContainer") continue;
      const base = (l as unknown as { _tlcBase?: number })._tlcBase ?? this.baseIntensity.get(l) ?? l.intensity;
      if (!this.baseIntensity.has(l)) this.baseIntensity.set(l, base);
      const keep = /^(fire|garden|candle|moonfill)/.test(l.name);
      l.intensity = on && !keep ? base * 0.02 : base;
    }
    if (!this.baseIntensity.has(this.scene)) this.baseIntensity.set(this.scene, this.scene.environmentIntensity);
    this.scene.environmentIntensity = on ? this.baseIntensity.get(this.scene)! * 0.2 : this.baseIntensity.get(this.scene)!;
    for (const m of this.scene.materials) {
      const pm = m as unknown as { emissiveIntensity?: number; _tlcEmis?: number };
      if (pm.emissiveIntensity === undefined) continue;
      if (/sky|moon|ember|fire|candle|flame/i.test(m.name)) continue;
      pm._tlcEmis ??= pm.emissiveIntensity;
      const wasFrozen = m.isFrozen;
      if (wasFrozen) m.unfreeze();
      pm.emissiveIntensity = on ? pm._tlcEmis * 0.04 : pm._tlcEmis;
      if (wasFrozen) m.freeze();
    }
    if (!quiet) this.ui.toast(on ? "The lights go out!" : "The lights flicker back on.", on ? "warn" : undefined);
  }

  private animateChandelier(dt: number) {
    if (this.chandelierFall < 0 || !this.chandelier || this.chandelierFall > 3) return;
    const c = this.chandelier;
    const start = this.chandelierFall === 0;
    this.chandelierFall += dt;
    if (start) (c as unknown as { _y0: number })._y0 ??= c.position.y;
    const y0 = (c as unknown as { _y0: number })._y0;
    const t = this.chandelierFall;
    const floorY = -0.15;
    const fallT = Math.sqrt((2 * (y0 - floorY)) / 9.81);
    if (t < fallT) c.position.y = y0 - 0.5 * 9.81 * t * t;
    else {
      c.position.y = floorY;
      if (!(c as unknown as { _crashed?: boolean })._crashed) {
        (c as unknown as { _crashed?: boolean })._crashed = true;
        c.rotationQuaternion = Quaternion.RotationYawPitchRoll(0.3, 0.25, 0.12).multiply(c.rotationQuaternion ?? Quaternion.Identity());
        this.burst(c.position.add(new Vector3(0, 0.4, 0)), new Color4(1, 0.95, 0.8, 1), new Color4(0.9, 0.85, 1, 1), -9.8);
        this.player.shake(0.6);
        this.audio.play("glass", 1.0, 0.8);
        setTimeout(() => this.audio.play("glass2", 0.8, 1.1), 120);
        this.audio.play("metal", 0.7, 0.7);
      }
    }
  }

  private fireworks() {
    for (let i = 0; i < 4; i++)
      setTimeout(() => {
        const at = new Vector3(-24 - (i % 2) * 4, 9 + i, -4 + i * 2.5);
        const hue = [new Color4(1, 0.78, 0.35, 1), new Color4(0.4, 1, 0.75, 1), new Color4(1, 0.45, 0.55, 1), new Color4(0.6, 0.75, 1, 1)][i];
        this.burst(at, hue, new Color4(1, 1, 1, 1), -2, 7);
        this.audio.play("bell", 0.25, 2.2);
      }, i * 650);
  }

  private burst(at: Vector3, c1: Color4, c2: Color4, gravity: number, power = 4) {
    const ps = new ParticleSystem("burst", 300, this.scene);
    ps.particleTexture = null;
    ps.createSphereEmitter(0.3);
    ps.emitter = at;
    ps.color1 = c1;
    ps.color2 = c2;
    ps.colorDead = new Color4(1, 1, 1, 0);
    ps.minSize = 0.03;
    ps.maxSize = 0.08;
    ps.minLifeTime = 0.6;
    ps.maxLifeTime = 1.6;
    ps.minEmitPower = power * 0.5;
    ps.maxEmitPower = power;
    ps.gravity = new Vector3(0, gravity, 0);
    ps.manualEmitCount = 300;
    ps.disposeOnStop = true;
    ps.targetStopDuration = 2;
    ps.start();
  }
}

export type { Track };
