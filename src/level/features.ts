// Room set pieces beyond the wall modules: the foyer's grand staircase and
// landing, floor medallions and rugs, the library's gallery, ladders, reading
// tables with banker's lamps, a globe, the fire bell. All world-space, merged
// into the room's Kit like everything else.
import { Mesh, MeshBuilder, Vector3, Scene } from "@babylonjs/core";
import { Kit, Frame } from "../kit/kit";
import type { LightSpot } from "../kit/modules";

type V2 = [number, number];
type V3 = [number, number, number];

export interface FeatureDefs {
  /** square floor medallion with its own texture (e.g. the foyer star) */
  inlay?: { material: string; size: number; center: V2 };
  rug?: { size: V2; center: V2; rotY?: number };
  /** straight flight rising toward +z between x0..x1 */
  stair?: { x0: number; x1: number; zFoot: number; zTop: number; rise: number; railX: number };
  /** upper landing: floor slab at y with a balustrade along railZ (gap over the stair head) */
  landing?: { bounds: [number, number, number, number]; y: number; railZ: number; gap: V2; columns?: V2[] };
  /** big hanging chandeliers (no shadowed spot: lit by a ring of cheap lights) */
  bigChandeliers?: { pos: V2; drop: number; scale: number; model: string }[];
  /** walk-on-looking gallery running along a wall (decorative) */
  mezzanine?: { from: V2; to: V2; y: number; depth: number };
  ladders?: { pos: V2; rotY: number; h: number }[];
  readingTables?: { pos: V2; rotY: number; len: number }[];
  globe?: V2;
  firebell?: { pos: V3; rotY: number };
  /** decorative ceiling sunburst around a chandelier rose */
  ceilingSun?: { center: V2; radius: number };
  /** round marble pedestal table (a foyer centrepiece) */
  centreTable?: { pos: V2; radius: number };
  floorLamps?: V2[];
}

export interface FeatureCtx {
  kit: Kit;
  scene: Scene;
  H: number;
  lights: LightSpot[];
  anchors: Record<string, { pos: Vector3; normal: Vector3 }>;
  place(model: string, pos: Vector3, rotY: number, scale: number): void;
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
const deg = (d?: number) => ((d ?? 0) * Math.PI) / 180;

export function buildFeatures(c: FeatureCtx, F: FeatureDefs) {
  const k = c.kit;
  if (F.inlay) {
    const { size, center, material } = F.inlay;
    const g = MeshBuilder.CreateGround("inlay", { width: size, height: size }, c.scene);
    k.add(material, g, v(center[0], 0.004, center[1]), { keepUV: true, shadow: false });
  }
  if (F.rug) {
    const { size, center } = F.rug;
    const g = MeshBuilder.CreateGround("rug", { width: size[0], height: size[1] }, c.scene);
    k.add("rug", g, v(center[0], 0.012, center[1]), { keepUV: true, shadow: false, rotY: deg(F.rug.rotY) });
  }
  if (F.stair) stair(c, F.stair);
  if (F.landing) landing(c, F.landing);
  for (const ch of F.bigChandeliers ?? []) bigChandelier(c, ch);
  if (F.mezzanine) mezzanine(c, F.mezzanine);
  for (const l of F.ladders ?? []) ladder(c, l);
  for (const t of F.readingTables ?? []) readingTable(c, t);
  if (F.globe) globe(c, F.globe);
  if (F.firebell) firebell(c, F.firebell);
  if (F.ceilingSun) ceilingSun(c, F.ceilingSun);
  if (F.centreTable) centreTable(c, F.centreTable);
  for (const p of F.floorLamps ?? []) floorLamp(c, p);
}

function centreTable(c: FeatureCtx, t: NonNullable<FeatureDefs["centreTable"]>) {
  const k = c.kit, [x, z] = t.pos, r = t.radius;
  k.cyl("marbleBlack", v(x, 0.82, z), 0.06, r * 2, { tess: 48, collide: true });
  k.cyl("goldSolid", v(x, 0.78, z), 0.03, r * 2 + 0.04, { tess: 48, shadow: false });
  k.cyl("goldSolid", v(x, 0.42, z), 0.72, 0.24, { tess: 24, top: 0.34 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    k.box("goldSolid", v(x + Math.sin(a) * 0.32, 0.25, z + Math.cos(a) * 0.32), v(0.08, 0.5, 0.5), { rotY: a, rotX: 0.5 });
  }
  k.cyl("marbleBlack", v(x, 0.04, z), 0.08, 1.0, { tess: 32 });
  // tall emerald vase
  const prof = [v(0, 0, 0), v(0.16, 0, 0), v(0.2, 0.12, 0), v(0.13, 0.4, 0), v(0.1, 0.55, 0), v(0.16, 0.66, 0), v(0.17, 0.68, 0)];
  k.add("emeraldLacquer", MeshBuilder.CreateLathe("vase", { shape: prof, tessellation: 28 }, c.scene), v(x, 0.85, z), {});
  k.add("goldSolid", MeshBuilder.CreateTorus("vr", { diameter: 0.33, thickness: 0.025, tessellation: 28 }, c.scene), v(x, 1.53, z), { shadow: false });
}

function floorLamp(c: FeatureCtx, [x, z]: V2) {
  const k = c.kit;
  k.cyl("brass", v(x, 0.03, z), 0.06, 0.4, { tess: 24 });
  k.cyl("brass", v(x, 0.8, z), 1.5, 0.035, { tess: 10, shadow: false });
  const shade = MeshBuilder.CreateCylinder("fls", { height: 0.36, diameterTop: 0.34, diameterBottom: 0.5, tessellation: 24, cap: Mesh.NO_CAP, sideOrientation: Mesh.DOUBLESIDE }, c.scene);
  k.add("linen", shade, v(x, 1.66, z), { shadow: false });
  k.add("lampGlow", MeshBuilder.CreateSphere("flb", { diameter: 0.12, segments: 8 }, c.scene), v(x, 1.6, z), { shadow: false });
  c.lights.push({ pos: v(x, 1.45, z), kind: "lamp" });
}

// ---------------------------------------------------------------- staircase

function stair(c: FeatureCtx, s: NonNullable<FeatureDefs["stair"]>) {
  const k = c.kit;
  const run = s.zTop - s.zFoot, n = Math.round(s.rise / 0.172), tread = run / n, riser = s.rise / n;
  const w = s.x1 - s.x0, cx = (s.x0 + s.x1) / 2;
  for (let i = 0; i < n; i++) {
    const z = s.zFoot + tread * (i + 0.5), top = riser * (i + 1);
    // solid marble flight (stone stairs against the wall), cream treads with a black nosing
    k.box("marbleCream", v(cx, top / 2, z), v(w, top, tread), {});
    k.box("marbleBlack", v(cx, top - 0.02, z - tread / 2 + 0.03), v(w + 0.02, 0.045, 0.07), { shadow: false });
    // burgundy runner with brass stair rods
    k.box("velvet", v(cx + 0.1, top + 0.006, z + 0.02), v(w * 0.62, 0.012, tread - 0.03), { shadow: false });
    k.box("velvet", v(cx + 0.1, top - riser / 2, z - tread / 2 - 0.004), v(w * 0.62, riser, 0.012), { shadow: false });
    k.cyl("brass", v(cx + 0.1, top + 0.02, z - tread / 2 + 0.02), w * 0.66, 0.022, { rotZ: Math.PI / 2, tess: 8, shadow: false });
  }
  // stringer on the open side
  const len = Math.hypot(run, s.rise), pitch = Math.atan2(s.rise, run);
  const sx = s.x1 + 0.08;
  k.box("marbleBlack", v(sx, s.rise / 2 - 0.12, s.zFoot + run / 2), v(0.16, 0.5, len), { rotX: -pitch });
  k.box("goldSolid", v(sx + 0.085, s.rise / 2 + 0.1, s.zFoot + run / 2), v(0.012, 0.04, len), { rotX: -pitch, shadow: false });
  // balusters + walnut handrail
  const railH = 0.95;
  for (let i = 0; i < n; i += 1) {
    const z = s.zFoot + tread * (i + 0.5), top = riser * (i + 1);
    const b = MeshBuilder.CreateCylinder("bal", { height: railH, diameterTop: 0.035, diameterBottom: 0.05, tessellation: 8 }, c.scene);
    k.add("goldSolid", b, v(s.railX, top + railH / 2, z), { shadow: false });
  }
  k.box("walnut", v(s.railX, s.rise / 2 + railH + 0.12, s.zFoot + run / 2), v(0.09, 0.07, len + 0.3), { rotX: -pitch });
  // newel post at the foot
  k.box("marbleBlack", v(s.railX, 0.6, s.zFoot - 0.1), v(0.3, 1.2, 0.3), { collide: true });
  k.cyl("goldSolid", v(s.railX, 1.28, s.zFoot - 0.1), 0.16, 0.24, { tess: 16 });
  const lampY = 1.62;
  k.add("lampGlow", MeshBuilder.CreateSphere("newel", { diameter: 0.26, segments: 12 }, c.scene), v(s.railX, lampY, s.zFoot - 0.1), { shadow: false });
  c.lights.push({ pos: v(s.railX + 0.4, lampY, s.zFoot - 0.5), kind: "lamp" });
  // walkable ramp + solid fill underneath (nobody walks under the flight)
  k.colliders.push({ center: v(cx, s.rise / 2 - 0.1, s.zFoot + run / 2), size: v(w, 0.2, len + 0.1), rotY: 0, rotX: -pitch });
  const segs = 4;
  for (let i = 1; i < segs; i++) {
    const z0 = s.zFoot + (run * i) / segs, z1 = s.zFoot + (run * (i + 1)) / segs;
    const h = (s.rise * i) / segs - 0.35;
    k.colliders.push({ center: v(cx, h / 2, (z0 + z1) / 2), size: v(w, h, z1 - z0), rotY: 0 });
  }
  // the open side gets a tall invisible rail so nobody steps off mid-flight
  k.colliders.push({ center: v(s.railX + 0.1, s.rise / 2 + 1.2, s.zFoot + run / 2 + 0.6), size: v(0.12, 2.4, len), rotY: 0, rotX: -pitch });
}

function landing(c: FeatureCtx, L: NonNullable<FeatureDefs["landing"]>) {
  const k = c.kit;
  const [x0, z0, x1, z1] = L.bounds, w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  k.box("parquet", v(cx, L.y - 0.01, cz), v(w, 0.02, d), { tile: 2.2 });
  k.box("plaster", v(cx, L.y - 0.22, cz), v(w, 0.4, d), { collide: true });
  // front edge: marble fascia with gold bands
  k.box("marbleBlack", v(cx, L.y - 0.22, L.railZ - 0.03), v(w, 0.46, 0.08), {});
  for (const dy of [-0.4, -0.02]) k.box("goldSolid", v(cx, L.y + dy, L.railZ - 0.075), v(w, 0.04, 0.02), { shadow: false });
  // balustrade with a gap where the stair arrives
  const railH = 1.0;
  const runs: V2[] = [[x0, L.gap[0]], [L.gap[1], x1]].filter(([a, b]) => b - a > 0.2) as V2[];
  for (const [a, b] of runs) {
    const len = b - a, mx = (a + b) / 2;
    k.box("walnut", v(mx, L.y + railH, L.railZ + 0.1), v(len, 0.08, 0.12), {});
    k.box("marbleBlack", v(mx, L.y + 0.06, L.railZ + 0.1), v(len, 0.12, 0.16), {});
    for (let x = a + 0.12; x < b - 0.05; x += 0.16) {
      const bal = MeshBuilder.CreateCylinder("lb", { height: railH - 0.1, diameterTop: 0.035, diameterBottom: 0.05, tessellation: 8 }, c.scene);
      k.add("goldSolid", bal, v(x, L.y + 0.07 + (railH - 0.1) / 2, L.railZ + 0.1), { shadow: false });
    }
    k.colliders.push({ center: v(mx, L.y + 1.2, L.railZ + 0.1), size: v(len, 2.4, 0.2), rotY: 0 });
  }
  // underside: plaster soffit with a gold-trimmed edge and down-lights
  k.box("goldSolid", v(cx, L.y - 0.45, L.railZ + 0.25), v(w, 0.03, 0.04), { shadow: false });
  for (let x = x0 + 2; x < x1 - 1; x += 4) {
    k.cyl("lampGlow", v(x, L.y - 0.43, cz), 0.02, 0.22, { tess: 16, shadow: false });
    c.lights.push({ pos: v(x, L.y - 0.9, cz), kind: "lamp" });
  }
  for (const [px, pz] of L.columns ?? []) {
    k.box("marbleBlack", v(px, 0.3, pz), v(0.55, 0.6, 0.55), { collide: true });
    k.cyl("marbleCream", v(px, (L.y - 0.4) / 2 + 0.3, pz), L.y - 0.4 - 0.6, 0.42, { tess: 20, collide: true });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      k.box("goldSolid", v(px + Math.sin(a) * 0.212, (L.y - 0.4) / 2 + 0.3, pz + Math.cos(a) * 0.212), v(0.02, L.y - 1.6, 0.02), { rotY: a, shadow: false });
    }
    k.box("goldSolid", v(px, L.y - 0.45, pz), v(0.62, 0.12, 0.62), {});
  }
}

// ---------------------------------------------------------------- lighting fixtures

function bigChandelier(c: FeatureCtx, ch: NonNullable<FeatureDefs["bigChandeliers"]>[number]) {
  const k = c.kit, [x, z] = ch.pos, y = c.H - ch.drop;
  c.place(ch.model, v(x, y, z), 0, ch.scale);
  k.cyl("goldSolid", v(x, (y + c.H) / 2 + 0.9, z), c.H - y - 1.6, 0.045, { tess: 8, shadow: false });
  k.add("goldSolid", MeshBuilder.CreateTorus("rose", { diameter: 1.8, thickness: 0.14, tessellation: 40 }, c.scene), v(x, c.H - 0.04, z), { shadow: false });
  // a ring of cheap lights around the crystal + one up-light for the ceiling
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    c.lights.push({ pos: v(x + Math.sin(a) * 1.4, y + 0.6, z + Math.cos(a) * 1.4), kind: "lamp" });
  }
  c.lights.push({ pos: v(x, y - 1.4, z), kind: "lamp" });
  c.lights.push({ pos: v(x, c.H - 1.2, z), kind: "cove" });
}

function ceilingSun(c: FeatureCtx, s: NonNullable<FeatureDefs["ceilingSun"]>) {
  const k = c.kit, [x, z] = s.center, y = c.H - 0.012;
  const rays = 32;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const len = i % 2 ? s.radius * 0.7 : s.radius;
    k.box("goldSolid", v(x + Math.sin(a) * (len / 2 + 1.0), y, z + Math.cos(a) * (len / 2 + 1.0)), v(0.07, 0.02, len - 1.0), { rotY: a, shadow: false });
  }
  for (const r of [1.3, s.radius + 1.1]) k.add("goldSolid", MeshBuilder.CreateTorus("sunring", { diameter: r * 2, thickness: 0.06, tessellation: 64 }, c.scene), v(x, y, z), { shadow: false });
}

// ---------------------------------------------------------------- library

function mezzanine(c: FeatureCtx, m: NonNullable<FeatureDefs["mezzanine"]>) {
  const k = c.kit;
  const a = v(m.from[0], 0, m.from[1]), b = v(m.to[0], 0, m.to[1]);
  const dir = b.subtract(a), len = dir.length();
  dir.normalize();
  const f: Frame = Kit.frame(a, Math.atan2(-dir.z, dir.x));
  const D = m.depth, y = m.y;
  k.box("walnut", v(len / 2, y - 0.12, D / 2), v(len, 0.24, D), {}, f);
  k.box("libraryFloor", v(len / 2, y + 0.005, D / 2), v(len, 0.01, D), { shadow: false }, f);
  k.box("goldSolid", v(len / 2, y - 0.2, D + 0.005), v(len, 0.03, 0.02), { shadow: false }, f);
  // brass rail with slim balusters
  k.box("brass", v(len / 2, y + 0.98, D - 0.05), v(len, 0.05, 0.05), {}, f);
  k.box("brass", v(len / 2, y + 0.5, D - 0.05), v(len, 0.02, 0.02), { shadow: false }, f);
  for (let x = 0.15; x < len - 0.1; x += 0.3) k.box("brass", v(x, y + 0.5, D - 0.05), v(0.02, 0.96, 0.02), { shadow: false }, f);
  // fluted walnut posts down to the floor + brackets
  for (let x = 1.2; x < len - 0.6; x += 3.0) {
    k.box("walnut", v(x, y / 2, D - 0.18), v(0.22, y, 0.22), { collide: true }, f);
    k.box("goldSolid", v(x, y - 0.32, D - 0.18), v(0.26, 0.05, 0.26), { shadow: false }, f);
    k.box("goldSolid", v(x, 0.12, D - 0.18), v(0.28, 0.24, 0.28), {}, f);
  }
  // little lamps under the gallery light the lower shelves
  for (let x = 2.7; x < len - 1; x += 3.0) {
    k.cyl("lampGlow", v(x, y - 0.25, D * 0.5), 0.02, 0.16, { tess: 12, shadow: false }, f);
    c.lights.push({ pos: Kit.toWorld(f, v(x, y - 0.7, D * 0.6)), kind: "lamp" });
  }
}

function ladder(c: FeatureCtx, l: NonNullable<FeatureDefs["ladders"]>[number]) {
  const k = c.kit, f: Frame = Kit.frame(v(l.pos[0], 0, l.pos[1]), deg(l.rotY));
  // leans against the shelf (local -z), feet out into the room
  const lean = 0.28, len = Math.hypot(l.h, lean);
  const tilt = Math.atan2(lean, l.h);
  for (const sx of [-0.24, 0.24]) k.box("walnut", v(sx, l.h / 2, lean / 2), v(0.05, len, 0.07), { rotX: -tilt }, f);
  for (let y = 0.3; y < l.h - 0.1; y += 0.3) k.cyl("brass", v(0, y, lean * (1 - y / l.h)), 0.48, 0.03, { rotZ: Math.PI / 2, tess: 8, shadow: false }, f);
  // brass rail hook at the top and wheels at the bottom
  k.box("brass", v(0, l.h + 0.04, -0.02), v(0.6, 0.03, 0.05), { shadow: false }, f);
  for (const sx of [-0.24, 0.24]) k.cyl("brass", v(sx, 0.05, lean), 0.04, 0.1, { rotZ: Math.PI / 2, tess: 12, shadow: false }, f);
}

function readingTable(c: FeatureCtx, t: NonNullable<FeatureDefs["readingTables"]>[number]) {
  const k = c.kit, f: Frame = Kit.frame(v(t.pos[0], 0, t.pos[1]), deg(t.rotY));
  const L = t.len, W = 1.1;
  k.box("walnut", v(0, 0.76, 0), v(L, 0.07, W), { collide: true }, f);
  k.box("leather", v(0, 0.797, 0), v(L - 0.3, 0.004, W - 0.3), { shadow: false }, f);
  k.box("goldSolid", v(0, 0.735, W / 2 + 0.005), v(L, 0.02, 0.012), { shadow: false }, f);
  k.box("goldSolid", v(0, 0.735, -W / 2 - 0.005), v(L, 0.02, 0.012), { shadow: false }, f);
  for (const sx of [-1, 1]) {
    k.box("walnut", v(sx * (L / 2 - 0.25), 0.36, 0), v(0.14, 0.72, W - 0.2), { collide: true }, f);
    k.box("walnut", v(sx * (L / 2 - 0.25), 0.05, 0), v(0.3, 0.1, W - 0.1), {}, f);
  }
  k.box("walnut", v(0, 0.15, 0), v(L - 0.5, 0.06, 0.1), {}, f);
  // banker's lamps: brass stem, green cased-glass shade, warm pool on the leather
  const lamps = Math.max(1, Math.round(L / 1.6));
  for (let i = 0; i < lamps; i++) {
    const x = -L / 2 + (L / lamps) * (i + 0.5);
    k.cyl("brass", v(x, 0.81, 0), 0.03, 0.2, { tess: 16 }, f);
    k.cyl("brass", v(x, 0.95, -0.02), 0.28, 0.025, { tess: 8, shadow: false }, f);
    const shade = MeshBuilder.CreateCylinder("shade", { height: 0.36, diameter: 0.17, tessellation: 20, arc: 0.5, cap: Mesh.CAP_ALL }, c.scene);
    k.add("bankerShade", shade, v(x, 1.11, 0.0), { rotZ: Math.PI / 2, rotX: Math.PI / 2, shadow: false }, f);
    k.cyl("lampGlow", v(x, 1.07, 0.0), 0.3, 0.05, { rotZ: Math.PI / 2, tess: 8, shadow: false }, f);
    c.lights.push({ pos: Kit.toWorld(f, v(x, 1.0, 0.05)), kind: "green" });
  }
  // a few books and an open one
  k.box("bookRed", v(L / 2 - 0.5, 0.83, -0.2), v(0.26, 0.05, 0.19), { rotY: 0.2, shadow: false }, f);
  k.box("bookGreen", v(L / 2 - 0.48, 0.875, -0.21), v(0.24, 0.04, 0.17), { rotY: -0.1, shadow: false }, f);
  k.box("bookTan", v(-L / 2 + 0.6, 0.808, 0.15), v(0.42, 0.012, 0.3), { rotY: 0.15, shadow: false }, f);
}

function globe(c: FeatureCtx, p: V2) {
  const k = c.kit, [x, z] = p;
  k.cyl("walnut", v(x, 0.05, z), 0.1, 0.6, { tess: 24 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    k.box("walnut", v(x + Math.sin(a) * 0.2, 0.42, z + Math.cos(a) * 0.2), v(0.05, 0.75, 0.05), { rotY: a, rotX: 0.25 * Math.cos(a), rotZ: -0.25 * Math.sin(a) });
  }
  k.add("walnut", MeshBuilder.CreateTorus("hz", { diameter: 0.86, thickness: 0.05, tessellation: 40 }, c.scene), v(x, 0.82, z), {});
  k.add("emeraldLacquer", MeshBuilder.CreateSphere("globe", { diameter: 0.7, segments: 24 }, c.scene), v(x, 0.92, z), {});
  k.add("brass", MeshBuilder.CreateTorus("mer", { diameter: 0.78, thickness: 0.02, tessellation: 40 }, c.scene), v(x, 0.92, z), { rotX: Math.PI / 2, rotY: 0.4, shadow: false });
  // gold "continents": a few raised patches
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9; i++) {
    const th = rnd() * Math.PI * 2, ph = (rnd() - 0.5) * 2.2;
    const n = v(Math.cos(ph) * Math.sin(th), Math.sin(ph), Math.cos(ph) * Math.cos(th));
    const blob = MeshBuilder.CreateSphere("land", { diameter: 0.12 + rnd() * 0.1, segments: 6 }, c.scene);
    blob.scaling.y = 0.25;
    blob.bakeCurrentTransformIntoVertices();
    const q = Math.atan2(n.x, n.z), pt = -Math.asin(n.y);
    k.add("goldSolid", blob, v(x, 0.92, z).add(n.scale(0.345)), { rotY: q, rotX: pt + Math.PI / 2, shadow: false });
  }
}

function firebell(c: FeatureCtx, b: NonNullable<FeatureDefs["firebell"]>) {
  const k = c.kit, f: Frame = Kit.frame(v(b.pos[0], 0, b.pos[2]), deg(b.rotY));
  const y = b.pos[1];
  // red board, big brass gong bell, pull-handle on a chain, a little "FIRE" plate
  k.box("fireRed", v(0, y, 0.03), v(0.5, 0.78, 0.06), {}, f);
  k.box("brass", v(0, y, 0.065), v(0.54, 0.82, 0.01), { shadow: false }, f);
  const bell = MeshBuilder.CreateSphere("bell", { diameter: 0.36, segments: 16, slice: 0.5 }, c.scene);
  k.add("brass", bell, v(0, y + 0.18, 0.12), { rotX: -Math.PI / 2 }, f);
  k.cyl("lacquer", v(0, y + 0.18, 0.16), 0.08, 0.05, { rotX: Math.PI / 2, tess: 12 }, f);
  k.box("brass", v(0, y - 0.18, 0.1), v(0.012, 0.3, 0.012), { shadow: false }, f);
  k.cyl("fireRed", v(0, y - 0.36, 0.1), 0.12, 0.05, { tess: 12 }, f);
  k.box("goldSolid", v(0, y - 0.28, 0.07), v(0.22, 0.07, 0.01), { shadow: false }, f);
  c.anchors.firebell = { pos: Kit.toWorld(f, v(0, y - 0.1, 0.3)), normal: Kit.toWorld({ origin: Vector3.Zero(), rotY: f.rotY }, v(0, 0, 1)) };
}
