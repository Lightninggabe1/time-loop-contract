// Assembles the wing (several rooms) from its JSON layout using the modular
// kit + CC0 models. Each room gets its own Kit, so its static geometry is
// merged per material per room and frustum-culls as a unit.
import {
  Scene, Vector3, Mesh, MeshBuilder, AbstractMesh, AssetContainer, LoadAssetContainerAsync,
  PBRMaterial, TransformNode, InstancedMesh, Quaternion, Matrix, Texture, Color3,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { Kit, Frame, Collider } from "../kit/kit";
import * as M from "../kit/modules";
import { mat } from "../art/materials";
import { Palette } from "../art/palette";

type V2 = [number, number];
type V3 = [number, number, number];

export interface PropDef { model: string; pos: V3; rotY?: number; scale?: number; plinth?: boolean; id?: string; light?: M.LightSpot["kind"] }
export interface WallDef { id: string; from: V2; to: V2; mirrorMat?: string; modules: { type: string; w: number; [k: string]: unknown }[] }
export interface RoomDef {
  id: string;
  name: string;
  style: string;
  bounds: [number, number, number, number]; // x0, z0, x1, z1
  outdoor?: boolean;
  floor: { material: string; uvOffset?: V2; danceFloor?: { material: string; size: V2; center: V2 } };
  ceiling: { type: "coffered" | "beams" | "plain" | "none"; beamsZ?: number[]; beamsX?: number[]; material?: string; beamMat?: string };
  walls: WallDef[];
  chandeliers?: V2[];
  pendants?: { model: string; pos: V3; scale: number; drop: number }[];
  lamps?: V2[];
  island?: { pos: V2; size: V2 };
  tables?: V2[];
  champagneTower?: V2;
  balloons?: V2[];
  props: PropDef[];
  furniture?: { type: "desk"; pos: V3; rotY?: number; id?: string }[];
  painting?: { model: string; anchor: string; scale: number };
  spill?: V3[];
  garden?: { groundY: number; trees: V2[]; shrubs: V2[]; statue: V2; lamps: V2[] };
}
export interface WingDef {
  id: string;
  rooms: RoomDef[];
  spawn: { pos: V3; yaw: number };
  shots: { name: string; pos: V3; target: V3 }[];
}

export interface BuiltDoor {
  spec: M.DoorSpec;
  pivots: TransformNode[];
  colliders: Collider[];
}

export interface BuiltWing {
  casters: AbstractMesh[];
  colliders: Collider[];
  lights: M.LightSpot[];
  chandeliers: Vector3[];
  windows: M.ModuleCtx["windows"];
  clock?: M.ModuleCtx["clock"];
  clockHands: { hour: Mesh; minute: Mesh } | null;
  candles: Vector3[];
  doors: BuiltDoor[];
  anchors: Record<string, { pos: Vector3; normal: Vector3 }>;
  props: Record<string, TransformNode>;
  roomMeshes: Record<string, AbstractMesh[]>;
  roomOf(p: Vector3): RoomDef | null;
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
        if (n === "chandelier_02" || n.startsWith("basecolor_classic_chandelier")) {
          pm.emissiveTexture = pm.albedoTexture;
          pm.emissiveColor = Palette.glowWarm.scale(0.55);
        }
        if (n.includes("bulb") || n.includes("lamps_")) {
          pm.emissiveColor = Palette.glowWarm;
          pm.emissiveIntensity = 5;
        }
        if (n.includes("canvas")) {
          pm.albedoTexture = new Texture("./assets/textures/gen_painting/diff.webp", scene);
          pm.albedoColor = Color3.White();
        }
        if (n === "armchair_01") pm.albedoColor = Color3.FromHexString("#3F6B55").toLinearSpace(); // palette emerald over the fabric texture
        // glTF transmission spawns an extra opaque-scene render pass (costly, and it
        // collides with the clustered-light pass on WebGPU): use plain alpha glass
        if (pm.subSurface?.isRefractionEnabled || pm.subSurface?.isTranslucencyEnabled) {
          pm.subSurface.isRefractionEnabled = false;
          pm.subSurface.isTranslucencyEnabled = false;
          pm.alpha = Math.min(pm.alpha, 0.35);
          pm.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
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

async function place(scene: Scene, id: string, pos: Vector3, rotY = 0, scale = 1, casters?: AbstractMesh[], sink?: AbstractMesh[]) {
  const c = await model(scene, id);
  const inst = c.instantiateModelsToScene((n) => n, false, { doNotInstantiate: false });
  const root = inst.rootNodes[0] as TransformNode;
  root.position.copyFrom(pos);
  root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), rotY);
  root.scaling.scaleInPlace(scale);
  for (const m of root.getChildMeshes()) {
    if (!(m instanceof InstancedMesh)) m.receiveShadows = true;
    m.isPickable = false;
    casters?.push(m);
    sink?.push(m);
  }
  return root;
}

const deg = (d?: number) => ((d ?? 0) * Math.PI) / 180;

export async function buildWing(scene: Scene, W: WingDef): Promise<BuiltWing> {
  const out: BuiltWing = {
    casters: [], colliders: [], lights: [], chandeliers: [], windows: [], clockHands: null, candles: [], doors: [],
    anchors: {}, props: {}, roomMeshes: {},
    roomOf: (p) => W.rooms.find((r) => p.x >= r.bounds[0] - 0.3 && p.x <= r.bounds[2] + 0.3 && p.z >= r.bounds[1] - 0.3 && p.z <= r.bounds[3] + 0.3) ?? null,
  };
  const jobs: Promise<unknown>[] = [];
  const doorSpecs: M.DoorSpec[] = [];

  const onlyRooms = new URLSearchParams(globalThis.location?.search ?? "").get("rooms")?.split(",");
  for (const R of W.rooms) {
    if (onlyRooms && !onlyRooms.includes(R.id)) continue;
    const kit = new Kit(scene, R.id);
    const st = M.STYLES[R.style];
    const [x0, z0, x1, z1] = R.bounds;
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const sink: AbstractMesh[] = (out.roomMeshes[R.id] = []);
    const ctxBase = { kit, st, room: R.id, lights: out.lights, windows: out.windows, doors: doorSpecs, anchors: out.anchors };

    // floor
    kit.box(R.floor.material, new Vector3(cx, -0.1, cz), new Vector3(w + 1, 0.2, d + 1), { collide: true, uvOffset: R.floor.uvOffset });
    const df = R.floor.danceFloor;
    if (df) {
      const [dw, dd] = df.size, [dx, dz] = df.center, b = 0.08;
      kit.box(df.material, new Vector3(dx, 0.006, dz), new Vector3(dw, 0.012, dd), {});
      kit.box("goldSolid", new Vector3(dx, 0.008, dz - dd / 2 - b / 2), new Vector3(dw + 2 * b, 0.016, b), { shadow: false });
      kit.box("goldSolid", new Vector3(dx, 0.008, dz + dd / 2 + b / 2), new Vector3(dw + 2 * b, 0.016, b), { shadow: false });
      kit.box("goldSolid", new Vector3(dx - dw / 2 - b / 2, 0.008, dz), new Vector3(b, 0.016, dd), { shadow: false });
      kit.box("goldSolid", new Vector3(dx + dw / 2 + b / 2, 0.008, dz), new Vector3(b, 0.016, dd), { shadow: false });
    }

    // walls
    for (const wall of R.walls) {
      const a = new Vector3(wall.from[0], 0, wall.from[1]);
      const b = new Vector3(wall.to[0], 0, wall.to[1]);
      const dir = b.subtract(a);
      const len = dir.length();
      dir.normalize();
      const f: Frame = Kit.frame(a, Math.atan2(-dir.z, dir.x));
      const inward = Kit.toWorld({ origin: Vector3.Zero(), rotY: f.rotY }, new Vector3(0, 0, 1));
      const toCentre = new Vector3(cx - (a.x + b.x) / 2, 0, cz - (a.z + b.z) / 2);
      if (Vector3.Dot(inward, toCentre) <= 0) throw new Error(`${R.id}/${wall.id} faces outward`);
      const ctx: M.ModuleCtx = { ...ctxBase, f, mirrorMat: wall.mirrorMat };
      let x = 0;
      for (const mod of wall.modules) {
        const o = mod as Record<string, unknown>;
        switch (mod.type) {
          case "panel": M.panel(ctx, x, mod.w, { sconce: !!o.sconce }); break;
          case "pilaster": M.pilaster(ctx, x, mod.w); break;
          case "window": M.windowModule(ctx, x, mod.w); break;
          case "mirror": M.mirror(ctx, x, mod.w); break;
          case "door": M.door(ctx, x, mod.w, o as Parameters<typeof M.door>[3]); break;
          case "stage": M.stage(ctx, x, mod.w); break;
          case "shelves": M.shelves(ctx, x, mod.w, { seed: o.seed as number }); break;
          case "fireplace": M.fireplace(ctx, x, mod.w); break;
          case "safe": M.safePanel(ctx, x, mod.w); break;
          case "counter": M.counter(ctx, x, mod.w, { stove: !!o.stove, fuse: !!o.fuse }); break;
          case "balustrade": M.balustrade(ctx, x, mod.w); break;
          default: throw new Error(`Unknown module ${mod.type}`);
        }
        x += mod.w;
      }
      if (Math.abs(x - len) > 0.01) throw new Error(`${R.id}/${wall.id}: modules ${x.toFixed(2)} ≠ length ${len.toFixed(2)}`);
      if (!R.outdoor) M.cornice(ctx, len);
      if (ctx.clock) out.clock = ctx.clock;
    }

    // ceiling
    const H = st.H, ce = R.ceiling;
    if (ce.type !== "none") kit.box(ce.material ?? "plaster", new Vector3(cx, H + 0.15, cz), new Vector3(w + 1, 0.3, d + 1), {});
    if (ce.type === "coffered") {
      for (const z of ce.beamsZ ?? []) {
        kit.box("plaster", new Vector3(cx, H - 0.25, z), new Vector3(w, 0.5, 0.55), {});
        kit.box("goldSolid", new Vector3(cx, H - 0.51, z), new Vector3(w, 0.03, 0.6), { shadow: false });
      }
      for (const xb of ce.beamsX ?? []) {
        kit.box("plaster", new Vector3(xb, H - 0.25, cz), new Vector3(0.55, 0.5, d), {});
        kit.box("goldSolid", new Vector3(xb, H - 0.51, cz), new Vector3(0.6, 0.03, d), { shadow: false });
      }
      const zs = [z0, ...(ce.beamsZ ?? []), z1], xs = [x0, ...(ce.beamsX ?? []), x1];
      for (let i = 0; i < zs.length - 1; i++)
        for (let j = 0; j < xs.length - 1; j++) {
          const ccz = (zs[i] + zs[i + 1]) / 2, ccx = (xs[j] + xs[j + 1]) / 2;
          const sz = zs[i + 1] - zs[i] - 1.4, sx = xs[j + 1] - xs[j] - 1.4;
          if (sz < 0.5 || sx < 0.5) continue;
          kit.box("cofferPaint", new Vector3(ccx, H - 0.005, ccz), new Vector3(xs[j + 1] - xs[j] - 0.56, 0.01, zs[i + 1] - zs[i] - 0.56), { shadow: false });
          for (const [ox, oz, bw, bd] of [[0, -sz / 2, sx, 0.05], [0, sz / 2, sx, 0.05], [-sx / 2, 0, 0.05, sz], [sx / 2, 0, 0.05, sz]] as const)
            kit.box("goldSolid", new Vector3(ccx + ox, H - 0.015, ccz + oz), new Vector3(bw, 0.02, bd), { shadow: false });
        }
    } else if (ce.type === "beams") {
      for (const xb of ce.beamsX ?? []) kit.box(ce.beamMat ?? "walnut", new Vector3(xb, H - 0.15, cz), new Vector3(0.3, 0.3, d), {});
      kit.box(ce.beamMat ?? "walnut", new Vector3(cx, H - 0.1, cz), new Vector3(w, 0.2, 0.25), {});
    }

    // ballroom chandeliers (pairs share one shadowed spot on the centre line)
    for (const [ccx, ccz] of R.chandeliers ?? []) {
      const s = 3.6, top = H - 0.9;
      jobs.push(place(scene, "Chandelier_02", new Vector3(ccx, top - 0.91 * s, ccz), 0, s, undefined, sink));
      kit.cyl("goldSolid", new Vector3(ccx, top + 0.5, ccz), 1.0, 0.06, { shadow: false });
      kit.add("goldSolid", MeshBuilder.CreateTorus("med", { diameter: 2.6, thickness: 0.18, tessellation: 48 }, scene), new Vector3(ccx, H - 0.02, ccz), { shadow: false });
      kit.add("coveGlow", MeshBuilder.CreateTorus("glw", { diameter: 2.1, thickness: 0.06, tessellation: 48 }, scene), new Vector3(ccx, H - 0.03, ccz), { shadow: false });
      kit.cyl("goldSolid", new Vector3(ccx, H - 0.04, ccz), 0.06, 0.7, { shadow: false });
      if (ccx >= 0) out.chandeliers.push(new Vector3(0, top - 0.55 * s, ccz));
    }
    // smaller hanging fittings (study)
    for (const p of R.pendants ?? []) {
      const y = H - p.drop;
      jobs.push(place(scene, p.model, new Vector3(p.pos[0], y, p.pos[2]), 0, p.scale, undefined, sink));
      kit.cyl("goldSolid", new Vector3(p.pos[0], (y + H) / 2, p.pos[2]), H - y, 0.03, { shadow: false });
      out.lights.push({ pos: new Vector3(p.pos[0], y - 0.4, p.pos[2]), kind: "lamp" });
    }
    // kitchen pendant lamps (procedural enamel shades)
    for (const [lx, lz] of R.lamps ?? []) {
      const y = H - 1.3;
      kit.cyl("goldSolid", new Vector3(lx, (y + H) / 2, lz), H - y, 0.02, { shadow: false });
      kit.add("lacquer", MeshBuilder.CreateCylinder("shade", { height: 0.3, diameterTop: 0.12, diameterBottom: 0.55, tessellation: 24 }, scene), new Vector3(lx, y, lz), { shadow: false });
      kit.add("lampGlow", MeshBuilder.CreateSphere("bulb", { diameter: 0.14, segments: 8 }, scene), new Vector3(lx, y - 0.14, lz), { shadow: false });
      out.lights.push({ pos: new Vector3(lx, y - 0.3, lz), kind: "lamp" });
    }
    if (R.island) {
      const [ix, iz] = R.island.pos, [iw, idp] = R.island.size;
      kit.box("cabinetCream", new Vector3(ix, 0.44, iz), new Vector3(iw, 0.88, idp), { collide: true });
      kit.box("butcherBlock", new Vector3(ix, 0.9, iz), new Vector3(iw + 0.08, 0.06, idp + 0.08), {});
      kit.box("brass", new Vector3(ix, 0.1, iz), new Vector3(iw + 0.02, 0.04, idp + 0.02), { shadow: false });
    }

    // tables
    for (const [tx, tz] of R.tables ?? []) {
      kit.cyl("linen", new Vector3(tx, 0.385, tz), 0.75, 1.98, { top: 1.84, tess: 40, collide: true });
      kit.cyl("linen", new Vector3(tx, 0.765, tz), 0.03, 1.86, { tess: 40 });
      kit.cyl("goldSolid", new Vector3(tx, 0.05, tz), 0.02, 2.0, { tess: 40, shadow: false });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const px = tx + Math.sin(a) * 0.66, pz = tz + Math.cos(a) * 0.66;
        kit.cyl("goldSolid", new Vector3(px, 0.785, pz), 0.012, 0.3, { tess: 24, shadow: false });
        kit.cyl("linen", new Vector3(px, 0.795, pz), 0.012, 0.24, { tess: 24, shadow: false });
        jobs.push(place(scene, "dining_chair_02", new Vector3(tx + Math.sin(a) * 1.3, 0, tz + Math.cos(a) * 1.3), a + Math.PI, 1.05, out.casters, sink));
      }
      jobs.push(place(scene, "brass_candleholders", new Vector3(tx, 0.78, tz), 0.4, 0.55, undefined, sink));
      jobs.push(place(scene, "brass_goblets", new Vector3(tx + 0.35, 0.78, tz - 0.25), 1.2, 0.9, undefined, sink));
      out.candles.push(new Vector3(tx, 1.35, tz));
    }
    if (R.champagneTower) champagneTower(kit, new Vector3(R.champagneTower[0], 0, R.champagneTower[1]));
    for (const [bx, bz] of R.balloons ?? []) balloons(kit, new Vector3(bx, 0, bz));

    // procedural furniture
    for (const fu of R.furniture ?? []) {
      const f: Frame = Kit.frame(new Vector3(...fu.pos), deg(fu.rotY));
      if (fu.type === "desk") {
        kit.box("walnut", new Vector3(0, 0.76, 0), new Vector3(1.9, 0.06, 0.95), { collide: true }, f);
        kit.box("leather", new Vector3(0, 0.792, 0), new Vector3(1.5, 0.006, 0.6), { shadow: false }, f);
        kit.box("goldSolid", new Vector3(0, 0.735, 0.478), new Vector3(1.92, 0.025, 0.02), { shadow: false }, f);
        for (const sx of [-1, 1]) {
          kit.box("walnut", new Vector3(sx * 0.68, 0.37, 0), new Vector3(0.5, 0.74, 0.88), { collide: true }, f);
          for (const y of [0.18, 0.42, 0.62]) {
            kit.box("walnutPanel", new Vector3(sx * 0.68, y, 0.445), new Vector3(0.44, 0.18, 0.012), { shadow: false }, f);
            kit.box("brass", new Vector3(sx * 0.68, y, 0.455), new Vector3(0.12, 0.018, 0.018), { shadow: false }, f);
          }
        }
        kit.box("walnutPanel", new Vector3(0, 0.66, -0.4), new Vector3(0.86, 0.16, 0.04), {}, f);
        out.anchors[fu.id ?? "desk"] = { pos: Kit.toWorld(f, new Vector3(0, 0.85, 0)), normal: Kit.toWorld({ origin: Vector3.Zero(), rotY: f.rotY }, new Vector3(0, 0, 1)) };
      }
    }

    // props
    for (const p of R.props) {
      const pos = new Vector3(...p.pos);
      if (p.plinth) {
        kit.box("marbleBlack", new Vector3(pos.x, pos.y / 2, pos.z), new Vector3(0.6, pos.y, 0.6), { collide: true });
        kit.box("goldSolid", new Vector3(pos.x, pos.y - 0.02, pos.z), new Vector3(0.66, 0.04, 0.66), {});
      }
      const job = place(scene, p.model, pos, deg(p.rotY), p.scale ?? 1, out.casters, sink).then((root) => {
        if (p.id) out.props[p.id] = root;
      });
      jobs.push(job);
      if (!p.plinth && pos.y < 0.2) {
        const s = p.scale ?? 1;
        kit.colliders.push({ center: pos.add(new Vector3(0, 0.5, 0)), size: new Vector3(0.8 * s, 1, 0.8 * s), rotY: 0 });
      }
      if (p.light) out.lights.push({ pos: pos.add(new Vector3(0, p.light === "garden" ? 2.6 * (p.scale ?? 1) : 0.45, 0)), kind: p.light });
    }
    if (R.painting) {
      const a = out.anchors[R.painting.anchor];
      if (a) {
        const yaw = Math.atan2(a.normal.x, a.normal.z) + Math.PI; // frame model faces -z
        jobs.push(place(scene, R.painting.model, a.pos.add(a.normal.scale(-0.02)), yaw, R.painting.scale, undefined, sink).then((root) => (out.props.painting = root)));
      }
    }

    for (const sp of R.spill ?? []) out.lights.push({ pos: new Vector3(...sp), kind: "lamp" });

    // garden below the balcony
    if (R.garden) {
      const g = R.garden, gy = g.groundY;
      kit.box("lawn", new Vector3(-48, gy - 0.1, 0), new Vector3(64, 0.2, 90), { shadow: false, tile: 6 });
      kit.box("facade", new Vector3(-13.25, gy / 2, 0), new Vector3(5.5, -gy, 12.4), { shadow: false }); // terrace plinth
      // stylised cypress topiaries (formal 1920s garden), cheap and on-palette
      for (const [tx, tz] of g.trees) {
        const hgt = 7 + ((Math.abs(tx * 7 + tz * 3)) % 5);
        kit.cyl("walnut", new Vector3(tx, gy + 0.6, tz), 1.2, 0.35, { tess: 8, shadow: false });
        const cone = MeshBuilder.CreateCylinder("cyp", { height: hgt, diameterTop: 0.1, diameterBottom: hgt * 0.32, tessellation: 14 }, scene);
        kit.add("hedge", cone, new Vector3(tx, gy + 1.0 + hgt / 2, tz), { shadow: false });
      }
      for (const [sx, sz] of g.shrubs) jobs.push(place(scene, (sx + sz) % 2 ? "shrub_01" : "shrub_03", new Vector3(sx, gy, sz), deg(sz * 50), 1.6, undefined, sink));
      kit.box("stone", new Vector3(g.statue[0], gy + 0.6, g.statue[1]), new Vector3(1.4, 1.2, 1.4), {});
      jobs.push(place(scene, "horse_statue_01", new Vector3(g.statue[0], gy + 1.2, g.statue[1]), deg(90), 8.0, undefined, sink));
      for (const [lx, lz] of g.lamps) {
        jobs.push(place(scene, "street_lamp_01", new Vector3(lx, gy, lz), 0, 0.9, undefined, sink));
        out.lights.push({ pos: new Vector3(lx, gy + 3.0, lz), kind: "garden" });
      }
    }

    const built = kit.finish();
    out.casters.push(...built.casters);
    sink.push(...built.meshes);
    out.colliders.push(...kit.colliders);
  }

  // sky dome around the whole wing (seen through every window and from the balcony)
  const sky = MeshBuilder.CreateSphere("sky", { diameter: 300, segments: 32, sideOrientation: Mesh.BACKSIDE }, scene);
  sky.material = mat("skyDome");
  sky.isPickable = false;

  // doors
  for (const spec of doorSpecs) {
    const pivots: TransformNode[] = [];
    const colliders: Collider[] = [];
    spec.hinge.forEach((h, i) => {
      const pivot = new TransformNode(`door_${spec.id}_${i}`, scene);
      pivot.position.copyFrom(h);
      pivot.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), spec.rotY);
      const sx = i === 0 ? 1 : -1; // leaf extends from its hinge toward the opening centre
      const leaf = MeshBuilder.CreateBox(`leaf_${spec.id}_${i}`, { width: spec.leafW - 0.02, height: spec.height - 0.02, depth: 0.07 }, scene);
      leaf.position.set((sx * spec.leafW) / 2, spec.height / 2, 0);
      leaf.parent = pivot;
      leaf.material = mat("walnut");
      leaf.receiveShadows = true;
      if (spec.glazed) {
        for (let r = 0; r < 4; r++) {
          const pane = MeshBuilder.CreatePlane(`pane_${spec.id}_${i}_${r}`, { width: spec.leafW - 0.26, height: (spec.height - 0.9) / 4 - 0.1 }, scene);
          pane.position.set((sx * spec.leafW) / 2, 0.75 + ((spec.height - 0.9) / 4) * (r + 0.5), 0.037);
          pane.rotation.y = Math.PI;
          pane.parent = pivot;
          pane.material = mat("glass");
        }
      } else {
        for (const dx of [-0.22, 0.22]) {
          const inlay = MeshBuilder.CreateBox("inlay", { width: 0.02, height: spec.height * 0.6, depth: 0.075 }, scene);
          inlay.position.set((sx * spec.leafW) / 2 + dx * spec.leafW, spec.height * 0.55, 0);
          inlay.parent = pivot;
          inlay.material = mat("goldSolid");
        }
      }
      const knob = MeshBuilder.CreateSphere("knob", { diameter: 0.07, segments: 8 }, scene);
      knob.position.set(sx * (spec.leafW - 0.1), 1.05, 0.06);
      knob.parent = pivot;
      knob.material = mat("brass");
      pivots.push(pivot);
      colliders.push({ center: Vector3.TransformCoordinates(new Vector3((sx * spec.leafW) / 2, spec.height / 2, 0), Matrix.RotationY(spec.rotY)).add(h), size: new Vector3(spec.leafW, spec.height, 0.12), rotY: spec.rotY });
    });
    out.doors.push({ spec, pivots, colliders });
  }

  // clock hands
  if (out.clock) {
    const clock = out.clock;
    const mk = (len: number, wid: number) => {
      const m = MeshBuilder.CreateBox("hand", { width: wid, height: len, depth: 0.02 }, scene);
      m.setPivotMatrix(Matrix.Translation(0, len / 2 - 0.08, 0), false);
      m.material = mat("lacquer");
      m.position.copyFrom(clock.center.add(clock.normal.scale(0.04)));
      m.rotationQuaternion = Quaternion.FromLookDirectionLH(clock.normal.scale(-1), Vector3.Up());
      return m;
    };
    out.clockHands = { hour: mk(clock.radius * 0.5, 0.07), minute: mk(clock.radius * 0.78, 0.045) };
  }

  await Promise.all(jobs);
  for (const m of scene.meshes) if (m.name.startsWith("Chandelier")) m.receiveShadows = false;
  return out;
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
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const p = at.add(new Vector3((i - (n - 1) / 2) * sp, y, (j - (n - 1) / 2) * sp));
        k.add("crystal", MeshBuilder.CreateLathe("cp", { shape: prof, tessellation: 18, sideOrientation: Mesh.DOUBLESIDE }, k.scene), p, { shadow: false });
        k.add("champagne", MeshBuilder.CreateCylinder("lq", { height: 0.025, diameterTop: 0.1, diameterBottom: 0.06, tessellation: 18 }, k.scene), p.add(new Vector3(0, 0.105, 0)), { shadow: false });
      }
    y += 0.128;
  }
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
