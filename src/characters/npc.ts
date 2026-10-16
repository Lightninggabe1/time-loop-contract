// NPC actors: a dressed character instance driven by the deterministic world.
// Position/facing come from World.npcPose(); this file only renders it.
import {
  Scene, AssetContainer, LoadAssetContainerAsync, AnimatorAvatar, AnimationGroup, TransformNode, Vector3,
  Quaternion, MeshBuilder, StandardMaterial, RawTexture, Texture, Color3, Constants, Mesh, PhysicsBody,
  PhysicsMotionType, PhysicsShapeCapsule, AbstractMesh, PBRMaterial,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { UAL_TO_UBC } from "./retarget";
import type { Activity, NpcPose } from "../core/schedule";
import type { Awareness, NpcOverride } from "../core/world";

/** Gameplay clip → source clip in the Universal Animation Library. */
const CLIPS = {
  idle: "Idle_Loop",
  talk: "Idle_Talking_Loop",
  walk: "Walk_Formal_Loop",
  run: "Sprint_Loop",
  sit: "Sitting_Idle_Loop",
  sitTalk: "Sitting_Talking_Loop",
  dance: "Dance_Loop",
  work: "Interact",
  punch: "Punch_Cross",
  hit: "Hit_Chest",
  ko: "Death01",
  pickup: "PickUp_Table",
} as const;
export type Clip = keyof typeof CLIPS;

const ACT_CLIP: Record<Activity | "walk", Clip> = {
  idle: "idle", talk: "talk", drink: "talk", dance: "dance", sit: "sit", work: "work", play: "idle", smoke: "idle", walk: "walk",
};

let animLib: Promise<AssetContainer> | null = null;
const npcLib = new Map<string, Promise<AssetContainer>>();

function lib(scene: Scene) {
  animLib ??= LoadAssetContainerAsync("./assets/characters/anim/AnimationLibrary_Godot_Standard.glb", scene).then((c) => {
    // the library's own mannequin is never shown
    for (const g of c.animationGroups) g.stop();
    return c;
  });
  return animLib;
}

function iconTexture(scene: Scene, kind: Awareness) {
  const S = 64, d = new Uint8Array(S * S * 4);
  const col = kind === "alarmed" ? [235, 64, 52] : [242, 178, 60];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const dx = x - S / 2 + 0.5, dy = y - S / 2 + 0.5, r = Math.hypot(dx, dy) / (S / 2);
      let a = r < 0.92 ? 1 : r < 1 ? (1 - r) / 0.08 : 0;
      // glyph: "!" (alarmed) or "?" (suspicious), drawn from simple shapes
      let ink = false;
      if (kind === "alarmed") ink = (Math.abs(dx) < 4 && dy > -20 && dy < 6) || Math.hypot(dx, dy - 14) < 4.5;
      else {
        const rr = Math.hypot(dx, dy + 6);
        ink = (rr > 7 && rr < 14 && !(dx < 0 && dy > -6)) || (Math.abs(dx) < 3.5 && dy > 1 && dy < 9) || Math.hypot(dx, dy - 15) < 4;
      }
      const c = ink ? [24, 16, 14] : col;
      d.set([c[0], c[1], c[2], Math.round(a * 255)], i);
    }
  const t = RawTexture.CreateRGBATexture(d, S, S, scene, true, true, Texture.TRILINEAR_SAMPLINGMODE);
  t.hasAlpha = true;
  return t;
}

let blobTex: RawTexture | null = null;
function blobTexture(scene: Scene) {
  if (blobTex) return blobTex;
  const S = 64, d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const r = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2);
      const a = Math.max(0, 1 - r) ** 1.6;
      d.set([0, 0, 0, Math.round(a * 200)], (y * S + x) * 4);
    }
  blobTex = RawTexture.CreateRGBATexture(d, S, S, scene, true, false, Texture.BILINEAR_SAMPLINGMODE);
  blobTex.hasAlpha = true;
  return blobTex;
}

export class NpcActor {
  root!: TransformNode;
  private groups: Partial<Record<Clip, AnimationGroup>> = {};
  private current: Clip | null = null;
  private fading: { from: AnimationGroup; t: number } | null = null;
  private yaw = 0;
  private icon!: Mesh;
  private iconMats: Record<Awareness, StandardMaterial | null> = { calm: null, suspicious: null, alarmed: null };
  private body!: PhysicsBody;
  readonly meshes: AbstractMesh[] = [];
  oneShot: { clip: Clip; until: number } | null = null;

  constructor(readonly scene: Scene, readonly id: string) {}

  async init(start: NpcPose) {
    const scene = this.scene;
    let p = npcLib.get(this.id);
    if (!p) npcLib.set(this.id, (p = LoadAssetContainerAsync(`./assets/characters/npc/${this.id}.gltf`, scene)));
    const [c, anims] = await Promise.all([p, lib(scene)]);
    // keep original node names: retargeting matches bones by name
    const inst = c.instantiateModelsToScene((n) => n, false);
    // the glTF root carries the handedness conversion; never touch it — we move a parent instead
    const gltfRoot = inst.rootNodes[0] as TransformNode;
    this.root = new TransformNode(`npc_${this.id}`, scene);
    this.root.rotationQuaternion = Quaternion.Identity();
    gltfRoot.parent = this.root;
    for (const m of this.root.getChildMeshes()) {
      m.isPickable = false;
      m.receiveShadows = true;
      const mat = m.material as PBRMaterial | null;
      if (mat) {
        mat.maxSimultaneousLights = 8;
        // sheen + clustered lights breaks the WebGPU (WGSL) shader in Babylon 9.31;
        // satin/velvet keep their look through roughness instead
        if (mat.sheen?.isEnabled) {
          mat.sheen.isEnabled = false;
          mat.roughness = Math.max(0.25, (mat.roughness ?? 0.5) - 0.08);
        }
      }
      this.meshes.push(m);
    }
    const avatar = new AnimatorAvatar(`${this.id}_avatar`, gltfRoot, false, false);
    avatar.showWarnings = false;
    for (const [k, name] of Object.entries(CLIPS) as [Clip, string][]) {
      const src = anims.animationGroups.find((g) => g.name === name);
      if (!src) continue;
      const g = avatar.retargetAnimationGroup(src, { mapNodeNames: UAL_TO_UBC, animationGroupName: `${this.id}_${k}`, fixRootPosition: false });
      g.stop();
      g.loopAnimation = !["punch", "hit", "ko", "pickup", "work"].includes(k);
      this.groups[k] = g;
    }
    // blob contact shadow
    const blob = MeshBuilder.CreateGround(`${this.id}_blob`, { width: 0.9, height: 0.9 }, scene);
    const bm = new StandardMaterial(`${this.id}_blobm`, scene);
    bm.diffuseTexture = blobTexture(scene);
    bm.useAlphaFromDiffuseTexture = true;
    bm.disableLighting = true;
    bm.emissiveColor = Color3.Black();
    bm.diffuseColor = Color3.Black();
    bm.alpha = 0.55;
    bm.disableDepthWrite = true;
    blob.material = bm;
    blob.position.y = 0.012;
    blob.parent = this.root;
    blob.isPickable = false;
    // awareness icon
    this.icon = MeshBuilder.CreatePlane(`${this.id}_icon`, { size: 0.26 }, scene);
    this.icon.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.icon.parent = this.root;
    this.icon.position.y = 2.12;
    this.icon.isPickable = false;
    this.icon.setEnabled(false);
    for (const k of ["suspicious", "alarmed"] as const) {
      const m = new StandardMaterial(`${this.id}_icon_${k}`, scene);
      m.diffuseTexture = iconTexture(scene, k);
      m.useAlphaFromDiffuseTexture = true;
      m.emissiveColor = Color3.White();
      m.disableLighting = true;
      m.alphaMode = Constants.ALPHA_COMBINE;
      this.iconMats[k] = m;
    }
    // kinematic capsule so the player bumps into people
    const shape = new PhysicsShapeCapsule(new Vector3(0, 0.35, 0), new Vector3(0, 1.45, 0), 0.3, scene);
    this.body = new PhysicsBody(this.root, PhysicsMotionType.ANIMATED, false, scene);
    this.body.shape = shape;
    this.body.disablePreStep = false;
    this.place(start, 0, true);
    this.play(ACT_CLIP[start.act]);
  }

  play(clip: Clip, fade = 0.25) {
    if (this.current === clip) return;
    const next = this.groups[clip] ?? this.groups.idle!;
    const prev = this.current ? this.groups[this.current] : null;
    if (this.fading) {
      this.fading.from.stop();
      this.fading = null;
    }
    next.start(next.loopAnimation, 1, next.from, next.to);
    next.weight = prev ? 0 : 1;
    if (prev && fade > 0) this.fading = { from: prev, t: 0 };
    else prev?.stop();
    this.current = clip;
  }

  setAwareness(a: Awareness) {
    const m = this.iconMats[a];
    this.icon.setEnabled(!!m);
    if (m) this.icon.material = m;
  }

  /** Apply the world's pose. `dt` real seconds. */
  place(pose: NpcPose & { override?: NpcOverride }, dt: number, snap = false) {
    const [x, y, z] = pose.pos;
    this.root.position.set(x, y, z);
    let target = pose.yaw;
    if (snap) this.yaw = target;
    else {
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 8);
    }
    this.root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), this.yaw);
    // clip choice: overrides win, then one-shots, then the schedule activity
    const o = pose.override?.state;
    let clip: Clip = pose.moving ? "walk" : ACT_CLIP[pose.act];
    if (o === "ko") clip = "ko";
    else if (o === "chasing" || o === "fleeing") clip = "run";
    else if (o === "distracted") clip = "talk";
    if (this.oneShot) {
      if (performance.now() < this.oneShot.until) clip = this.oneShot.clip;
      else this.oneShot = null;
    }
    this.play(clip);
    if (this.fading) {
      this.fading.t += dt / 0.25;
      const k = Math.min(1, this.fading.t);
      this.groups[this.current!]!.weight = k;
      this.fading.from.weight = 1 - k;
      if (k >= 1) {
        this.fading.from.stop();
        this.fading = null;
      }
    }
  }

  /** Play a non-looping clip once on top of the schedule (punch, hit, pickup…). */
  gesture(clip: Clip) {
    const g = this.groups[clip];
    if (!g) return;
    const secs = (g.to - g.from) / 60;
    this.oneShot = { clip, until: performance.now() + secs * 1000 };
    this.play(clip, 0.1);
  }

  get position() {
    return this.root.position;
  }
}
