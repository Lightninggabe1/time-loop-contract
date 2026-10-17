// Browser front-end for the Session: NPC actors, doors, blackouts, the
// chandelier, chases, and the HUD. All rules live in Session; this file only
// shows them and feeds player input back.
import { Scene, Vector3, Matrix, TransformNode, Quaternion, ParticleSystem, Color4, Color3, Mesh, MeshBuilder, StandardMaterial } from "@babylonjs/core";
import { Session, Offer, TalkOption } from "./session";
import { test } from "../core/conditions";
import { NpcActor } from "../characters/npc";
import { npcs, npcMeta, board, contracts, perks, interactions, anchorNames, leadTargets } from "../content";
import { LocalStorage } from "../core/storage";
import { formatTime } from "../core/clock";
import type { Vec3 } from "../core/schedule";
import type { Output } from "../core/world";
import type { BuiltWing } from "../level/build";
import type { Doors } from "../level/doors";
import type { Player } from "../player/player";
import type { Input } from "../player/input";
import type { Lighting } from "../render/lighting";
import { GameUI } from "../ui/game-ui";
import { closestPoint, pathTo } from "../nav/navmesh";
import { Audio } from "../audio/audio";

const CHASE_SPEED = 4.6; // m/s — slower than a sprint, faster than a stroll

const offers0 = (s: Session) => s.offers();

export class GameClient {
  readonly session = new Session(new LocalStorage());
  readonly actors = new Map<string, NpcActor>();
  readonly audio = new Audio();
  ui: GameUI;
  private chandelier: TransformNode | null = null;
  private chandelierFall = -1;
  private lightsOut = false;
  private baseIntensity = new Map<object, number>();
  private chasePos: Vector3 | null = null;
  private chasePath: Vector3[] = [];
  private chaseRepath = 0;
  private farFor = 0;
  private bubbles = new Map<string, { text: string; until: number }>();
  private markers = new Map<string, Mesh>();
  private markerMat: StandardMaterial | null = null;
  private paused = false;
  private ready = false;
  private talkNpc: string | null = null;
  private talkReply: string | null = null;
  private ignoreInteractUntil = 0;
  private painting: { pivot: TransformNode; open: number; dir: number } | null = null;

  constructor(
    private scene: Scene,
    private room: BuiltWing,
    private doors: Doors,
    private player: Player,
    private input: Input,
    private lighting: Lighting,
  ) {
    this.ui = new GameUI({
      onAct: (id) => this.act(id),
      onWait: () => this.wait(),
      onHint: () => this.hint(),
      onAgain: () => this.restart(),
      onBuy: (id) => {
        const ok = this.session.loop.buyPerk(id);
        this.ui.renderEnd(this.session.ended!, this.session.meta, perks);
        return ok;
      },
      onPause: (p) => {
        this.paused = p;
        this.player.enabled = !p;
        if (!p) {
          // the key that closed an overlay must not also act in the world
          this.input.read();
          this.ignoreInteractUntil = performance.now() + 300;
        }
      },
    });
    this.session.start();
    this.applyPerks();
  }

  /** Load the cast in the background (the room is already playable). */
  async loadCast() {
    const w = this.session.world;
    await Promise.all(
      npcs.map(async (n) => {
        const a = new NpcActor(this.scene, n.id);
        await a.init(w.npcPose(n.id));
        this.lighting.addDynamic(a.meshes);
        this.actors.set(n.id, a);
      }),
    );
    // the chandelier that hangs over the stage steps (the one on the rope)
    // animate the instance's top-level node (world space), not a scaled child
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
  }

  get isReady() {
    return this.ready;
  }

  private applyPerks() {
    this.player.sprintSpeed = 6.2 * (1 + this.session.loop.mod("sprint"));
  }

  // ---------------------------------------------------------------- per frame

  private endShown = false;

  update(dt: number) {
    if (this.session.ended && !this.endShown) this.endScreen();
    if (this.paused || this.session.ended) {
      this.input.read(); // swallow input while overlays are up
      return;
    }
    const cam = this.player.camera.position;
    const feet: Vec3 = [cam.x, cam.y - 1.62, cam.z];
    const outs = this.session.tick(dt, { pos: feet, yaw: this.player.yaw });
    for (const o of outs) this.output(o);
    if (this.session.ended) {
      this.endScreen();
      return;
    }
    const w = this.session.world;
    // NPCs
    for (const [id, a] of this.actors) {
      const pose = w.npcPose(id);
      if (this.session.chase?.by === id) this.chaseStep(a, dt, cam);
      else a.place(pose, dt);
      a.setAwareness(w.awareness[id] ?? "calm");
    }
    // doors follow world flags; staff and guests have keys, so a door swings open while one walks through
    for (const d of this.room.doors) {
      const p = d.pivots[0].position;
      let npcNear = false;
      for (const a of this.actors.values()) if (Math.hypot(p.x - a.position.x, p.z - a.position.z) < 2.0) npcNear = true;
      const open = (w.flags[`door.${d.spec.id}.open`] !== false && !w.flags[`door.${d.spec.id}.locked`]) || npcNear;
      this.doors.setOpen(d.spec.id, open);
    }
    this.updateMarkers(offers0(this.session));
    this.swingPainting(dt, !!w.flags["painting.open"]);
    this.blackout(!!w.flags["lights.out"]);
    if (w.flags["chandelier.dropped"] && this.chandelierFall < 0) this.chandelierFall = 0;
    this.animateChandelier(dt);
    // input
    const s = this.input.peekEdges();
    const offers = this.rankByView(this.session.offers());
    this.ui.setOffers(offers.slice(0, 3));
    if (s.interact && offers[0] && performance.now() > this.ignoreInteractUntil) this.act(offers[0].id);
    if (s.item) this.wait();
    if (s.board) this.ui.toggleBoard(board, w.ctx);
    for (let i = 0; i < 3; i++) if (s.number === i + 1 && offers[i]) this.act(offers[i].id);
    if (s.punch) {
      const p = offers.find((o) => o.id.startsWith("punch:"));
      if (p) this.act(p.id);
    }
    // sound
    const roomId = this.room.roomOf(cam)?.id ?? null;
    const singing = w.minute >= 22 * 60 && w.minute < 22 * 60 + 18 && !w.flags["song.cancelled"];
    this.audio.setMusic(w.flags["lights.out"] ? "none" : singing ? "song" : "band");
    this.audio.setRoom(roomId, Math.hypot(cam.x, cam.z - 11.5), !!w.flags["lights.out"]);
    // HUD
    const t = formatTime(w.minute);
    this.ui.setClock(t.hm, t.ampm, this.room.roomOf(cam)?.name ?? "The Grounds");
    this.ui.setTracker(this.session.contractStatus(), this.session.meta.loop, board.lead(w.ctx), w.flags);
    this.updateBubbles();
    this.updateTags(offers[0]);
    this.updatePin();
  }

  private output(o: Output) {
    if (o.kind === "say" && o.npc === this.talkNpc && this.ui.talking) this.talkReply = o.line;
    else if (o.kind === "say") this.bubbles.set(o.npc, { text: o.line, until: performance.now() + 4200 });
    else if (o.kind === "toast") this.ui.toast(o.text);
    else if (o.kind === "learn") {
      const d = board.get(o.intel);
      this.ui.toast(`Noted: ${d.title}`, "intel");
      this.audio.play("noted", 0.35);
    }
  }

  private updateBubbles() {
    const now = performance.now();
    const view = this.scene.getTransformMatrix();
    const vp = this.scene.activeCamera!.viewport.toGlobal(this.scene.getEngine().getRenderWidth(), this.scene.getEngine().getRenderHeight());
    const scale = this.scene.getEngine().getHardwareScalingLevel();
    const out: { id: string; x: number; y: number; text: string; name: string }[] = [];
    for (const [id, b] of this.bubbles) {
      if (now > b.until) {
        this.bubbles.delete(id);
        continue;
      }
      const a = this.actors.get(id);
      if (!a) continue;
      const head = a.position.add(new Vector3(0, 2.05, 0));
      const cam = this.player.camera;
      const toHead = head.subtract(cam.position);
      if (Vector3.Dot(toHead, cam.getForwardRay().direction) < 0.2 || toHead.length() > 16) continue;
      const p = Vector3.Project(head, Matrix.Identity(), view, vp);
      out.push({ id, x: p.x * scale, y: p.y * scale, text: b.text, name: npcMeta[id].name });
    }
    this.ui.setBubbles(out);
  }

  /** Gold glints over usable things nearby (anchors only; people have bubbles). */
  private updateMarkers(all: Offer[]) {
    const s = this.session;
    const anchorsAvail = new Set<string>();
    for (const it of interactions) {
      if (!it.target.anchor) continue;
      if (it.when && !test(it.when, s.world.ctx)) continue;
      anchorsAvail.add(it.target.anchor);
    }
    void all;
    const me = s.player.pos;
    if (!this.markerMat) {
      const m = new StandardMaterial("marker", this.scene);
      m.disableLighting = true;
      m.emissiveColor = new Color3(1.0, 0.78, 0.38);
      m.alpha = 0.85;
      this.markerMat = m;
    }
    const t = performance.now() / 1000;
    for (const [id, p] of Object.entries(s.anchors)) {
      if (id.startsWith("door.")) continue;
      const near = Math.hypot(p[0] - me[0], p[2] - me[2]) < 7 && anchorsAvail.has(id);
      let m = this.markers.get(id);
      if (!m && near) {
        m = MeshBuilder.CreatePlane(`marker_${id}`, { size: 0.14 }, this.scene);
        m.rotation.z = Math.PI / 4;
        m.billboardMode = Mesh.BILLBOARDMODE_ALL;
        m.material = this.markerMat;
        m.isPickable = false;
        m.position.set(p[0], p[1] + 0.35, p[2]);
        if (id === "safe") m.setEnabled(false);
        this.markers.set(id, m);
      }
      if (m) {
        m.setEnabled(near && id !== "safe"); // the painting has its label; a glint on the canvas looks like a bug
        m.position.y = p[1] + 0.35 + Math.sin(t * 2.4 + p[0]) * 0.04;
        m.scaling.setAll(0.8 + 0.25 * Math.sin(t * 4 + p[2]));
      }
    }
  }

  // ---------------------------------------------------------------- actions

  act(id: string) {
    if (id.startsWith("talk:")) return this.openTalk(id.slice(5));
    const r = this.session.perform(id);
    const npc = id.startsWith("punch:") ? id.slice(6) : null;
    if (npc) {
      this.actors.get(npc)?.gesture("hit");
      this.ui.flash();
      this.audio.play(Math.random() < 0.5 ? "punch" : "punch2", 0.8);
    }
    if (id === "fuse.pull") this.audio.play("switch", 0.8);
    if (id.startsWith("door:")) this.audio.play("open", 0.4);
    if (r.ok && !npc && !id.startsWith("ask:") && !id.startsWith("door:")) this.audio.play("click", 0.3);
    if (r.witnessed.length) {
      this.ui.toast("You were seen!", "warn");
      this.audio.play("seen", 0.5);
    }
    for (const o of this.session.tick(0)) this.output(o);
  }

  // ---------------------------------------------------------------- conversation

  private openTalk(npc: string) {
    this.talkNpc = npc;
    this.audio.play("click", 0.25);
    this.showTalk(this.session.greet(npc));
  }

  private showTalk(line: string, note = false) {
    const npc = this.talkNpc!;
    const m = npcMeta[npc];
    this.ui.showTalk(m.name, m.role, line, this.session.talkOptions(npc), (o) => this.pickTalk(o), note);
  }

  private pickTalk(o: TalkOption | null) {
    if (!o) {
      this.talkNpc = null;
      this.ui.closeTalk();
      return;
    }
    if (o.kind === "locked") return this.showTalk(o.note ?? "Not now.", true);
    this.talkReply = null;
    this.act(o.id);
    this.showTalk(this.talkReply ?? "...");
  }

  wait() {
    if (this.session.wait(10)) this.ui.toast("You check your pocket watch. Ten minutes pass.");
    else this.ui.toast("Not now — you're being chased!", "warn");
  }

  hint() {
    const lead = board.lead(this.session.world.ctx);
    this.ui.toast(lead ? `Lead: ${lead.hint}` : "You know everything worth knowing. Now act on it.", "intel");
  }

  // ---------------------------------------------------------------- readability helpers

  private offerPos(o: Offer): Vector3 | null {
    if (o.npc) return this.actors.get(o.npc)?.position.add(new Vector3(0, 1.4, 0)) ?? null;
    const a = o.anchor && this.session.anchors[o.anchor];
    return a ? new Vector3(a[0], a[1], a[2]) : null;
  }

  /** Whatever you're looking at comes first (then nearest). */
  private rankByView(offers: Offer[]) {
    const cam = this.player.camera, fwd = cam.getForwardRay().direction;
    const score = (o: Offer) => {
      const p = this.offerPos(o);
      if (!p) return o.dist;
      const to = p.subtract(cam.position);
      const dot = Vector3.Dot(to.normalize(), fwd);
      return o.dist * (1.7 - dot);
    };
    const scored = offers.map((o, i) => ({ o, s: score(o), i }));
    // keep talk/punch on one person together and in their usual order
    return scored.sort((a, b) => (a.o.npc && a.o.npc === b.o.npc ? a.i - b.i : a.s - b.s)).map((x) => x.o);
  }

  private screen(v: Vector3) {
    const engine = this.scene.getEngine();
    const vp = this.scene.activeCamera!.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const p = Vector3.Project(v, Matrix.Identity(), this.scene.getTransformMatrix(), vp);
    const k = engine.getHardwareScalingLevel();
    const view = Vector3.TransformCoordinates(v, this.scene.getViewMatrix());
    return { x: p.x * k, y: p.y * k, ahead: view.z > 0.2, view };
  }

  /** Name tags: people nearby (gold ❝ when you have a move to make, • when they have something to tell you) and usable things. */
  private updateTags(primary?: Offer) {
    const s = this.session, w = s.world, cam = this.player.camera;
    const fwd = cam.getForwardRay().direction;
    const list: { key: string; x: number; y: number; text: string; cls: string }[] = [];
    const visible = (p: Vector3, range: number) => {
      const to = p.subtract(cam.position);
      const d = to.length();
      return d < range && Vector3.Dot(to.scale(1 / d), fwd) > 0.35;
    };
    for (const [id, a] of this.actors) {
      if (this.bubbles.has(id) || w.npcPose(id).override?.state === "ko") continue;
      const p = a.position.add(new Vector3(0, 2.0, 0));
      if (!visible(p, 7)) continue;
      const q = this.screen(p);
      const opts = s.talkOptions(id);
      const cls = opts.some((o) => o.kind === "move") ? "move" : opts.some((o) => o.kind === "ask") ? "fresh" : "";
      list.push({ key: id, x: q.x, y: q.y, text: npcMeta[id].short, cls: cls + (primary?.npc === id ? " focus" : "") });
    }
    const avail = new Set(interactions.filter((it) => it.target.anchor && !it.talk && (!it.when || test(it.when, w.ctx))).map((it) => it.target.anchor!));
    for (const [id, a] of Object.entries(s.anchors)) {
      if (!avail.has(id) || !anchorNames[id]) continue;
      const p = new Vector3(a[0], a[1] + (id === "safe" ? 0.82 : 0.28), a[2]); // above the frame, not on the canvas
      if (!visible(p, 6)) continue;
      const q = this.screen(p);
      list.push({ key: `a:${id}`, x: q.x, y: q.y, text: id === "safe" && w.flags["painting.open"] ? "Wall safe" : anchorNames[id], cls: "thing" + (primary?.anchor === id ? " focus" : "") });
    }
    this.ui.setTags(list);
  }

  /** The Lead marker: points at whoever (or whatever) the current Lead is about. */
  private updatePin() {
    const w = this.session.world;
    const lead = board.lead(w.ctx);
    const t = lead && leadTargets[lead.intel.id];
    let pos: Vector3 | null = null;
    if (t?.npc) {
      const a = this.actors.get(t.npc);
      if (a && w.npcPose(t.npc).override?.state !== "ko") pos = a.position.add(new Vector3(0, 2.3, 0));
    } else if (t?.anchor) {
      const a = this.session.anchors[t.anchor];
      if (a) pos = new Vector3(a[0], a[1] + 0.6, a[2]);
    }
    if (!pos || !lead) return this.ui.setPin(null);
    const cam = this.player.camera.position;
    const dist = Math.hypot(pos.x - cam.x, pos.z - cam.z);
    const q = this.screen(pos);
    const W = innerWidth, H = innerHeight, m = 48, mx = 96; // mx: room for the label beside the arrow
    const onScreen = q.ahead && q.x > mx && q.x < W - mx && q.y > m + 30 && q.y < H - m;
    if (onScreen) return this.ui.setPin({ x: q.x, y: q.y, edge: false, angle: 0, text: lead.intel.title, dist });
    // off screen: slide to the edge in the target's direction
    let dx = q.view.x, dy = -q.view.y;
    if (!q.ahead && Math.abs(dx) < 1e-3) dx = 1;
    if (!q.ahead) dy = Math.max(dy, 0.25 * Math.abs(dx)); // behind you: keep it low on the screen
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const tt = Math.min((W / 2 - mx) / Math.max(Math.abs(dx), 1e-3), (H / 2 - m - 20) / Math.max(Math.abs(dy), 1e-3));
    this.ui.setPin({ x: W / 2 + dx * tt, y: H / 2 + dy * tt + 20, edge: true, angle: Math.atan2(dy, dx) - Math.PI / 2, text: lead.intel.title, dist });
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
    // swing outwards into the room, whichever way that is
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

  // ---------------------------------------------------------------- chase

  private chaseStep(a: NpcActor, dt: number, cam: Vector3) {
    const target = new Vector3(cam.x, 0, cam.z);
    this.chasePos ??= a.position.clone();
    this.chaseRepath -= dt;
    if (this.chaseRepath <= 0) {
      this.chasePath = pathTo(this.chasePos, target);
      this.chaseRepath = 0.4;
    }
    let step = CHASE_SPEED * dt;
    while (step > 0 && this.chasePath.length) {
      const n = this.chasePath[0];
      const d = Vector3.Distance(new Vector3(this.chasePos.x, 0, this.chasePos.z), new Vector3(n.x, 0, n.z));
      if (d <= step) {
        this.chasePos.set(n.x, n.y, n.z);
        this.chasePath.shift();
        step -= d;
      } else {
        const dir = n.subtract(this.chasePos);
        dir.y = 0;
        dir.normalize();
        this.chasePos.addInPlace(dir.scale(step));
        step = 0;
      }
    }
    const near = closestPoint(this.chasePos);
    this.chasePos.y = near.y;
    const toP = target.subtract(this.chasePos);
    const yaw = Math.atan2(toP.x, toP.z);
    a.place({ pos: [this.chasePos.x, this.chasePos.y, this.chasePos.z], yaw, act: "walk", spot: "", entry: 0, moving: true, override: { state: "chasing" } }, dt);
    const dist = Math.hypot(toP.x, toP.z);
    if (dist < 0.9) {
      this.session.caught();
      this.chasePos = null;
      return;
    }
    this.farFor = dist > 14 ? this.farFor + dt : 0;
    if (this.farFor > 3) {
      this.session.escape();
      this.chasePos = null;
      this.farFor = 0;
    }
  }

  // ---------------------------------------------------------------- set pieces

  private blackout(on: boolean) {
    if (on === this.lightsOut) return;
    this.lightsOut = on;
    // every light we own, including the clustered ones (they are not in scene.lights)
    const all = [...this.scene.lights, ...this.scene.lights.flatMap((l) => ((l as unknown as { lights?: typeof l[] }).lights ?? []))];
    for (const l of all) {
      if (l.name.startsWith("moon") || l.getClassName() === "ClusteredLightContainer") continue;
      if (!this.baseIntensity.has(l)) this.baseIntensity.set(l, l.intensity);
      const keep = l.name.startsWith("fire") || l.name.startsWith("garden") || l.name.startsWith("candle");
      l.intensity = on && !keep ? this.baseIntensity.get(l)! * 0.02 : this.baseIntensity.get(l)!;
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
    this.ui.toast(on ? "The lights go out!" : "The lights flicker back on.", on ? "warn" : undefined);
  }

  private animateChandelier(dt: number) {
    if (this.chandelierFall < 0 || !this.chandelier || this.chandelierFall > 3) return;
    const c = this.chandelier;
    const start = this.chandelierFall === 0;
    this.chandelierFall += dt;
    if (start) (c as unknown as { _y0: number })._y0 = c.position.y;
    const y0 = (c as unknown as { _y0: number })._y0;
    const t = this.chandelierFall;
    const floorY = -0.15; // model origin sits at its base
    const fallT = Math.sqrt((2 * (y0 - floorY)) / 9.81);
    if (t < fallT) c.position.y = y0 - 0.5 * 9.81 * t * t;
    else {
      c.position.y = floorY;
      if (!(c as unknown as { _crashed?: boolean })._crashed) {
        (c as unknown as { _crashed?: boolean })._crashed = true;
        c.rotationQuaternion = Quaternion.RotationYawPitchRoll(0.3, 0.25, 0.12).multiply(c.rotationQuaternion ?? Quaternion.Identity());
        this.crystalBurst(c.position.clone());
        this.player.shake(0.6);
        this.audio.play("glass", 1.0, 0.8);
        setTimeout(() => this.audio.play("glass2", 0.8, 1.1), 120);
        this.audio.play("metal", 0.7, 0.7);
      }
    }
  }

  private crystalBurst(at: Vector3) {
    const ps = new ParticleSystem("crystals", 300, this.scene);
    ps.particleTexture = null;
    ps.createPointEmitter(new Vector3(-1, 0.5, -1), new Vector3(1, 3, 1));
    ps.emitter = at.add(new Vector3(0, 0.4, 0));
    ps.color1 = new Color4(1, 0.95, 0.8, 1);
    ps.color2 = new Color4(0.9, 0.85, 1, 1);
    ps.colorDead = new Color4(1, 1, 1, 0);
    ps.minSize = 0.02;
    ps.maxSize = 0.06;
    ps.minLifeTime = 0.6;
    ps.maxLifeTime = 1.4;
    ps.minEmitPower = 2;
    ps.maxEmitPower = 5;
    ps.gravity = new Vector3(0, -9.8, 0);
    ps.manualEmitCount = 300;
    ps.disposeOnStop = true;
    ps.targetStopDuration = 2;
    ps.start();
    // (no transient light: adding/removing lights at runtime invalidates frozen materials)
  }

  // ---------------------------------------------------------------- loop end & restart

  private endScreen() {
    const e = this.session.ended!;
    if (this.endShown) return;
    this.endShown = true;
    if (e.reason === "midnight") this.audio.midnight();
    else this.audio.play("seen", 0.6, 0.7);
    this.audio.setMusic("none");
    this.ui.renderEnd(e, this.session.meta, perks);
    document.exitPointerLock?.();
  }

  restart() {
    const t0 = performance.now();
    this.session.start();
    this.applyPerks();
    const sp = this.session.player.pos;
    this.player.setPose(new Vector3(sp[0], sp[1], sp[2]), 0);
    this.chasePos = null;
    this.chandelierFall = -1;
    if (this.chandelier) {
      const c = this.chandelier as unknown as { _y0?: number; _crashed?: boolean };
      if (c._y0 !== undefined) this.chandelier.position.y = c._y0;
      c._crashed = false;
      this.chandelier.rotationQuaternion = Quaternion.Identity();
    }
    this.blackout(false);
    this.talkNpc = null;
    this.ui.closeTalk();
    if (this.painting) (this.painting.open = 0), (this.painting.pivot.rotation.y = 0);
    for (const [id, a] of this.actors) a.place(this.session.world.npcPose(id), 0, true);
    this.ui.hideEnd();
    this.endShown = false;
    this.audio.setMusic("band");
    this.ui.intro(this.session.meta.loop, contracts.length);
    console.info(`loop reset in ${(performance.now() - t0).toFixed(0)} ms`);
  }
}
