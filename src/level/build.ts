// Assembles a room from its JSON layout using the modular kit + CC0 models.
import {
  Scene, Vector3, Mesh, MeshBuilder, AbstractMesh, AssetContainer, LoadAssetContainerAsync,
  PBRMaterial, TransformNode, InstancedMesh, Quaternion, Matrix,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { Kit, Frame, Collider } from "../kit/kit";
import * as M from "../kit/modules";
import { mat } from "../art/materials";
import { Palette } from "../art/palette";

export interface Layout {
  id: string;
  name: string;
  size: [number, number, number];
  floor: { material: string; danceFloor?: { material: string; size: [number, number]; center: [number, number] } };
  walls: { id: string; from: [number, number]; to: [number, number]; modules: { type: string; w: number; [k: string]: unknown }[] }[];
  ceiling: { beamsZ: number[]; beamsX: number[] };
  chandeliers: [number, number][];
  tables: [number, number][];
  champagneTower?: [number, number];
  props: { model: string; pos: [number, number, number]; rotY?: number; scale?: number; plinth?: boolean }[];
  spawn: { pos: [number, number, number]; yaw: number };
  shots: { name: string; pos: [number, number, number]; target: [number, number, number] }[];
}

export interface BuiltRoom {
  root: TransformNode;
  casters: AbstractMesh[];
  colliders: Collider[];
  lights: M.LightSpot[];
  chandeliers: Vector3[]; // world position of each chandelier's light centre
  windows: M.ModuleCtx["windows"];
  clock?: M.ModuleCtx["clock"];
  clockHands: { hour: Mesh; minute: Mesh } | null;
  candles: Vector3[];
}

const models = new Map<string, Promise<AssetContainer>>();
function model(scene: Scene, id: string) {
  let p = models.get(id);
  if (!p) {
    p = LoadAssetContainerAsync(`./assets/models/${id}.glb`, scene).then((c) => {
      for (const m of c.materials) {
        const pm = m as PBRMaterial;
        pm.maxSimultaneousLights = 8;
        const n = m.name.toLowerCase();
        if (n === "chandelier_02") {
          // shades glow softly from within
          pm.emissiveTexture = pm.albedoTexture;
          pm.emissiveColor = Palette.glowWarm.scale(0.55);
        }
        if (n.includes("bulb") || n.includes("lamps_")) {
          pm.emissiveColor = Palette.glowWarm;
          pm.emissiveIntensity = 5;
        }
        if (n.includes("flame")) {
          pm.emissiveColor = Palette.candle;
          pm.emissiveIntensity = 6;
        }
      }
      return c;
    });
    models.set(id, p);
  }
  return p;
}

/** Instance a model: returns its root node, positioned. */
async function place(scene: Scene, id: string, pos: Vector3, rotY = 0, scale = 1, casters?: AbstractMesh[]) {
  const c = await model(scene, id);
  const inst = c.instantiateModelsToScene((n) => n, false, { doNotInstantiate: false });
  const root = inst.rootNodes[0] as TransformNode;
  root.position.copyFrom(pos);
  root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), rotY);
  root.scaling.scaleInPlace(scale);
  for (const m of root.getChildMeshes()) {
    if (!(m instanceof InstancedMesh)) m.receiveShadows = true;
    m.isPickable = false;
    if (casters) casters.push(m);
  }
  return root;
}

export async function buildRoom(scene: Scene, L: Layout): Promise<BuiltRoom> {
  const [W, H, D] = L.size;
  const kit = new Kit(scene, L.id);
  const lights: M.LightSpot[] = [];
  const windows: M.ModuleCtx["windows"] = [];
  let clock: M.ModuleCtx["clock"];

  // ---------- floor ----------
  kit.box(L.floor.material, new Vector3(0, -0.1, 0), new Vector3(W + 1, 0.2, D + 1), { collide: true, uvOffset: [2, 2] });
  const df = L.floor.danceFloor;
  if (df) {
    const [dw, dd] = df.size, [dx, dz] = df.center;
    kit.box(df.material, new Vector3(dx, 0.006, dz), new Vector3(dw, 0.012, dd), {});
    const b = 0.08;
    kit.box("goldSolid", new Vector3(dx, 0.008, dz - dd / 2 - b / 2), new Vector3(dw + 2 * b, 0.016, b), { shadow: false });
    kit.box("goldSolid", new Vector3(dx, 0.008, dz + dd / 2 + b / 2), new Vector3(dw + 2 * b, 0.016, b), { shadow: false });
    kit.box("goldSolid", new Vector3(dx - dw / 2 - b / 2, 0.008, dz), new Vector3(b, 0.016, dd), { shadow: false });
    kit.box("goldSolid", new Vector3(dx + dw / 2 + b / 2, 0.008, dz), new Vector3(b, 0.016, dd), { shadow: false });
  }

  // ---------- walls ----------
  for (const wall of L.walls) {
    const a = new Vector3(wall.from[0], 0, wall.from[1]);
    const b = new Vector3(wall.to[0], 0, wall.to[1]);
    const dir = b.subtract(a);
    const len = dir.length();
    dir.normalize();
    const f: Frame = Kit.frame(a, Math.atan2(-dir.z, dir.x));
    const inward = Kit.toWorld({ origin: Vector3.Zero(), rotY: f.rotY }, new Vector3(0, 0, 1));
    if (Vector3.Dot(inward, a.scale(-1)) <= 0) throw new Error(`Wall ${wall.id} faces outward`);
    const ctx: M.ModuleCtx = { kit, f, lights, windows, mirrorMat: wall.id === "east" ? "mirrorLive" : "mirror" };
    let x = 0;
    for (const mod of wall.modules) {
      switch (mod.type) {
        case "panel": M.panel(ctx, x, mod.w, { sconce: !!mod.sconce }); break;
        case "pilaster": M.pilaster(ctx, x, mod.w); break;
        case "window": M.windowModule(ctx, x, mod.w); break;
        case "mirror": M.mirror(ctx, x, mod.w); break;
        case "door": M.door(ctx, x, mod.w, mod as { opening?: number; height?: number }); break;
        case "stage": M.stage(ctx, x, mod.w); break;
        default: throw new Error(`Unknown module ${mod.type}`);
      }
      x += mod.w;
    }
    if (Math.abs(x - len) > 0.01) throw new Error(`Wall ${wall.id}: modules ${x} ≠ length ${len}`);
    M.cornice(ctx, len);
    if (ctx.clock) clock = ctx.clock;
    // night sky backdrop outside windows
    if (wall.modules.some((m) => m.type === "window")) {
      const sky = MeshBuilder.CreatePlane("sky", { width: len + 24, height: 16 }, scene);
      sky.position.copyFrom(Kit.toWorld(f, new Vector3(len / 2, 6, -9)));
      sky.rotation.y = f.rotY + Math.PI;
      sky.material = mat("nightSky");
      sky.isPickable = false;
    }
  }

  // ---------- ceiling ----------
  kit.box("plaster", new Vector3(0, H + 0.15, 0), new Vector3(W + 1, 0.3, D + 1), {});
  for (const z of L.ceiling.beamsZ) {
    kit.box("plaster", new Vector3(0, H - 0.25, z), new Vector3(W, 0.5, 0.55), {});
    kit.box("goldSolid", new Vector3(0, H - 0.51, z), new Vector3(W, 0.03, 0.6), { shadow: false });
  }
  for (const xb of L.ceiling.beamsX) {
    kit.box("plaster", new Vector3(xb, H - 0.25, 0), new Vector3(0.55, 0.5, D), {});
    kit.box("goldSolid", new Vector3(xb, H - 0.51, 0), new Vector3(0.6, 0.03, D), { shadow: false });
  }
  // coffer inlays: thin gold squares in each coffer
  const zs = [-D / 2, ...L.ceiling.beamsZ, D / 2];
  const xs = [-W / 2, ...L.ceiling.beamsX, W / 2];
  for (let i = 0; i < zs.length - 1; i++) {
    for (let j = 0; j < xs.length - 1; j++) {
      const cz = (zs[i] + zs[i + 1]) / 2, cx = (xs[j] + xs[j + 1]) / 2;
      const sz = zs[i + 1] - zs[i] - 1.4, sx = xs[j + 1] - xs[j] - 1.4;
      if (sz < 0.5 || sx < 0.5) continue;
      kit.box("cofferPaint", new Vector3(cx, H - 0.005, cz), new Vector3(xs[j + 1] - xs[j] - 0.56, 0.01, zs[i + 1] - zs[i] - 0.56), { shadow: false });
      for (const [ox, oz, w, d] of [[0, -sz / 2, sx, 0.05], [0, sz / 2, sx, 0.05], [-sx / 2, 0, 0.05, sz], [sx / 2, 0, 0.05, sz]] as const) {
        kit.box("goldSolid", new Vector3(cx + ox, H - 0.015, cz + oz), new Vector3(w, 0.02, d), { shadow: false });
      }
    }
  }

  // ---------- chandeliers ----------
  const chand: Vector3[] = [];
  const casters: AbstractMesh[] = [];
  const asyncJobs: Promise<unknown>[] = [];
  for (const [cx, cz] of L.chandeliers) {
    const s = 3.6;
    const top = H - 0.9;
    const pos = new Vector3(cx, top - 0.91 * s, cz);
    asyncJobs.push(place(scene, "Chandelier_02", pos, 0, s));
    kit.cyl("goldSolid", new Vector3(cx, top + 0.5, cz), 1.0, 0.06, { shadow: false });
    const med = MeshBuilder.CreateTorus("med", { diameter: 2.6, thickness: 0.18, tessellation: 48 }, scene);
    kit.add("goldSolid", med, new Vector3(cx, H - 0.02, cz), { shadow: false });
    const glow = MeshBuilder.CreateTorus("glw", { diameter: 2.1, thickness: 0.06, tessellation: 48 }, scene);
    kit.add("coveGlow", glow, new Vector3(cx, H - 0.03, cz), { shadow: false });
    kit.cyl("goldSolid", new Vector3(cx, H - 0.04, cz), 0.06, 0.7, { shadow: false });
    if (cx >= 0) chand.push(new Vector3(0, top - 0.55 * s, cz));
  }

  // ---------- tables ----------
  const candles: Vector3[] = [];
  for (const [tx, tz] of L.tables) {
    kit.cyl("linen", new Vector3(tx, 0.385, tz), 0.75, 1.98, { top: 1.84, tess: 40, collide: true });
    kit.cyl("linen", new Vector3(tx, 0.765, tz), 0.03, 1.86, { tess: 40 });
    kit.cyl("goldSolid", new Vector3(tx, 0.05, tz), 0.02, 2.0, { tess: 40, shadow: false });
    // place settings: gold chargers + plates
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const px = tx + Math.sin(a) * 0.66, pz = tz + Math.cos(a) * 0.66;
      kit.cyl("goldSolid", new Vector3(px, 0.785, pz), 0.012, 0.3, { tess: 24, shadow: false });
      kit.cyl("linen", new Vector3(px, 0.795, pz), 0.012, 0.24, { tess: 24, shadow: false });
      const ca = a + 0.0;
      asyncJobs.push(place(scene, "dining_chair_02", new Vector3(tx + Math.sin(ca) * 1.3, 0, tz + Math.cos(ca) * 1.3), ca + Math.PI, 1.05, casters));
    }
    asyncJobs.push(place(scene, "brass_candleholders", new Vector3(tx, 0.78, tz), 0.4, 0.55));
    asyncJobs.push(place(scene, "brass_goblets", new Vector3(tx + 0.35, 0.78, tz - 0.25), 1.2, 0.9));
    candles.push(new Vector3(tx, 1.35, tz));
  }

  // ---------- champagne tower ----------
  if (L.champagneTower) champagneTower(kit, new Vector3(L.champagneTower[0], 0, L.champagneTower[1]));

  // ---------- props ----------
  for (const p of L.props) {
    const pos = new Vector3(...p.pos);
    if (p.plinth) {
      kit.box("marbleBlack", new Vector3(pos.x, pos.y / 2, pos.z), new Vector3(0.6, pos.y, 0.6), { collide: true });
      kit.box("goldSolid", new Vector3(pos.x, pos.y - 0.02, pos.z), new Vector3(0.66, 0.04, 0.66), {});
    }
    asyncJobs.push(place(scene, p.model, pos, ((p.rotY ?? 0) * Math.PI) / 180, p.scale ?? 1, casters));
    if (!p.plinth) kit.colliders.push({ center: pos.add(new Vector3(0, 0.5, 0)), size: new Vector3(0.9, 1, 0.9).scale(p.scale ?? 1), rotY: 0 });
  }
  // balloons by the stage
  balloons(kit, new Vector3(-6.8, 0, 12.6));
  balloons(kit, new Vector3(6.8, 0, 12.6));

  // ---------- clock hands ----------
  let clockHands: BuiltRoom["clockHands"] = null;
  if (clock) {
    const mk = (len: number, wid: number) => {
      const m = MeshBuilder.CreateBox("hand", { width: wid, height: len, depth: 0.02 }, scene);
      m.setPivotMatrix(Matrix.Translation(0, len / 2 - 0.08, 0), false);
      m.material = mat("lacquer");
      m.position.copyFrom(clock!.center.add(clock!.normal.scale(0.04)));
      m.rotationQuaternion = Quaternion.FromLookDirectionLH(clock!.normal.scale(-1), Vector3.Up());
      return m;
    };
    clockHands = { hour: mk(clock.radius * 0.5, 0.07), minute: mk(clock.radius * 0.78, 0.045) };
  }

  await Promise.all(asyncJobs);
  const built = kit.finish();
  casters.push(...built.casters);
  for (const m of scene.meshes) if (m.name.startsWith("Chandelier")) m.receiveShadows = false;

  return { root: kit.root, casters, colliders: kit.colliders, lights, chandeliers: chand, windows, clock, clockHands, candles };
}

function champagneTower(kit: Kit, at: Vector3) {
  const k = kit;
  k.cyl("lacquer", at.add(new Vector3(0, 0.45, 0)), 0.9, 1.5, { tess: 40, collide: true, top: 1.4 });
  k.cyl("goldSolid", at.add(new Vector3(0, 0.91, 0)), 0.03, 1.56, { tess: 40 });
  k.cyl("goldSolid", at.add(new Vector3(0, 0.25, 0)), 0.04, 1.54, { tess: 40, shadow: false });
  const prof = [
    new Vector3(0.0, 0, 0), new Vector3(0.035, 0, 0), new Vector3(0.008, 0.01, 0), new Vector3(0.006, 0.075, 0),
    new Vector3(0.02, 0.085, 0), new Vector3(0.06, 0.11, 0), new Vector3(0.066, 0.125, 0),
  ];
  const sp = 0.135;
  let y = 0.93;
  for (let n = 4; n >= 1; n--) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const p = at.add(new Vector3((i - (n - 1) / 2) * sp, y, (j - (n - 1) / 2) * sp));
        const g = MeshBuilder.CreateLathe("cp", { shape: prof, tessellation: 18, sideOrientation: Mesh.DOUBLESIDE }, k.scene);
        k.add("crystal", g, p, { shadow: false });
        const liq = MeshBuilder.CreateCylinder("lq", { height: 0.025, diameterTop: 0.1, diameterBottom: 0.06, tessellation: 18 }, k.scene);
        k.add("champagne", liq, p.add(new Vector3(0, 0.105, 0)), { shadow: false });
      }
    }
    y += 0.128;
  }
  // bottle on top
  k.cyl("emeraldLacquer", at.add(new Vector3(0, y + 0.13, 0)), 0.26, 0.085, { tess: 16 });
  k.cyl("emeraldLacquer", at.add(new Vector3(0, y + 0.31, 0)), 0.12, 0.03, { tess: 12, top: 0.026 });
  k.cyl("goldSolid", at.add(new Vector3(0, y + 0.36, 0)), 0.06, 0.034, { tess: 12 });
}

function balloons(kit: Kit, at: Vector3) {
  const cols = ["goldSolid", "lacquer", "goldSolid", "linen", "burgundyLacquer", "goldSolid", "lacquer"];
  let seed = Math.abs(at.x * 31 + at.z * 17);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9; i++) {
    const p = at.add(new Vector3((rnd() - 0.5) * 1.4, 2.6 + rnd() * 1.6, (rnd() - 0.5) * 1.0));
    const b = MeshBuilder.CreateSphere("bl", { diameter: 0.42, segments: 12 }, kit.scene);
    b.scaling.y = 1.18;
    b.bakeCurrentTransformIntoVertices();
    kit.add(cols[i % cols.length], b, p, {});
    const str = p.y - 0.25 - 1.0;
    kit.cyl("linen", new Vector3((p.x + at.x) / 2, 1.0 + str / 2, (p.z + at.z) / 2), str, 0.006, { tess: 3, shadow: false });
  }
  kit.cyl("goldSolid", at.add(new Vector3(0, 0.5, 0)), 1.0, 0.3, { tess: 16, collide: true, top: 0.18 });
}

