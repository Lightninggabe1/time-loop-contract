// Art-deco architectural modules. Each module occupies [x0, x0+w] along a
// wall frame (x along wall, y up, z into the room; wall body is z ∈ [-T, 0]).
import { Mesh, MeshBuilder, Vector3, Scene } from "@babylonjs/core";
import { Kit, Frame } from "./kit";

export const H = 9; // ceiling height
export const T = 0.5; // wall thickness
export const WAINS = 1.3; // wainscot height
export const CORNICE = 7.7; // underside of cornice

export interface LightSpot {
  pos: Vector3;
  kind: "sconce" | "candle" | "foot" | "cove" | "clock";
}

export interface ModuleCtx {
  kit: Kit;
  f: Frame;
  lights: LightSpot[];
  /** world positions of window openings (centre) with their inward normal */
  windows: { center: Vector3; normal: Vector3; width: number; bottom: number; top: number }[];
  /** world-space centre of the clock face + its normal (for the hero clock) */
  clock?: { center: Vector3; normal: Vector3; radius: number };
  /** material for mirror glass on this wall ("mirrorLive" gets planar reflections) */
  mirrorMat?: string;
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

// ---------------- common dressing ----------------

/** Structural wall slab between x0..x1, y0..y1 (plaster core, collides). */
function slab(c: ModuleCtx, x0: number, x1: number, y0: number, y1: number) {
  if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3) return;
  c.kit.box("plaster", v((x0 + x1) / 2, (y0 + y1) / 2, -T / 2), v(x1 - x0, y1 - y0, T), { collide: true }, c.f);
}

/** Baseboard + wainscot + chair rail between x0..x1. */
function wainscot(c: ModuleCtx, x0: number, x1: number) {
  const w = x1 - x0, cx = (x0 + x1) / 2;
  c.kit.box("marbleBlack", v(cx, 0.12, 0.04), v(w, 0.24, 0.08), {}, c.f);
  c.kit.box("burgundyLacquer", v(cx, WAINS / 2, 0.02), v(w, WAINS, 0.04), {}, c.f);
  c.kit.box("goldSolid", v(cx, WAINS + 0.03, 0.05), v(w, 0.07, 0.1), {}, c.f);
  // inset panel frames (thin gold strips), one per ~1.2 m
  const n = Math.max(1, Math.round(w / 1.3));
  const pw = w / n;
  for (let i = 0; i < n; i++) {
    const px0 = x0 + i * pw + 0.14, px1 = x0 + (i + 1) * pw - 0.14;
    if (px1 - px0 < 0.2) continue;
    const pcx = (px0 + px1) / 2, y0 = 0.38, y1 = WAINS - 0.16;
    c.kit.box("brass", v(pcx, y0, 0.045), v(px1 - px0, 0.025, 0.012), { shadow: false }, c.f);
    c.kit.box("brass", v(pcx, y1, 0.045), v(px1 - px0, 0.025, 0.012), { shadow: false }, c.f);
    c.kit.box("brass", v(px0, (y0 + y1) / 2, 0.045), v(0.025, y1 - y0, 0.012), { shadow: false }, c.f);
    c.kit.box("brass", v(px1, (y0 + y1) / 2, 0.045), v(0.025, y1 - y0, 0.012), { shadow: false }, c.f);
  }
}

/** Fan wallpaper on the upper wall between x0..x1, y0..y1. */
function paper(c: ModuleCtx, x0: number, x1: number, y0 = WAINS + 0.07, y1 = CORNICE) {
  if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3) return;
  c.kit.box("wallFan", v((x0 + x1) / 2, (y0 + y1) / 2, 0.006), v(x1 - x0, y1 - y0, 0.012), { shadow: false }, c.f);
}

/** Continuous stepped cornice + cove glow for a whole wall (length L). */
export function cornice(c: ModuleCtx, L: number) {
  const k = c.kit, f = c.f, cx = L / 2;
  k.box("goldSolid", v(cx, CORNICE + 0.06, 0.04), v(L, 0.12, 0.08), {}, f);
  k.box("marbleCream", v(cx, CORNICE + 0.36, 0.08), v(L, 0.48, 0.16), {}, f);
  k.box("goldSolid", v(cx, CORNICE + 0.66, 0.13), v(L, 0.12, 0.26), {}, f);
  k.box("plaster", v(cx, (CORNICE + 0.72 + H) / 2, 0.19), v(L, H - CORNICE - 0.72, 0.38), {}, f);
  // glowing cove line under the top lip
  k.box("coveGlow", v(cx, CORNICE + 0.735, 0.34), v(L, 0.03, 0.05), { shadow: false }, f);
  c.lights.push({ pos: Kit.toWorld(f, v(cx, H - 0.6, 1.2)), kind: "cove" });
}

// ---------------- sconce ----------------

function sconce(c: ModuleCtx, x: number, y: number, z: number) {
  const k = c.kit, f = c.f;
  k.box("goldSolid", v(x, y, z + 0.02), v(0.26, 0.56, 0.04), {}, f);
  k.box("goldSolid", v(x, y + 0.32, z + 0.03), v(0.14, 0.1, 0.06), {}, f);
  // fan shade: half cylinder, flat side to wall
  const shade = MeshBuilder.CreateCylinder("s", { height: 0.34, diameterTop: 0.42, diameterBottom: 0.2, tessellation: 20, arc: 0.5 }, k.scene);
  k.add("lampGlow", shade, v(x, y + 0.05, z + 0.04), { rotY: Math.PI / 2, shadow: false }, f);
  for (const i of [-1, 0, 1]) {
    const a = i * (Math.PI / 3.2);
    k.box("goldSolid", v(x + Math.sin(a) * 0.15, y + 0.05, z + 0.04 + Math.cos(a) * 0.15), v(0.016, 0.36, 0.016), { shadow: false }, f);
  }
  k.box("goldSolid", v(x, y + 0.23, z + 0.1), v(0.44, 0.025, 0.2), { shadow: false }, f);
  c.lights.push({ pos: Kit.toWorld(f, v(x, y + 0.1, z + 0.45)), kind: "sconce" });
}

// ---------------- modules ----------------

export function panel(c: ModuleCtx, x0: number, w: number, opt: { sconce?: boolean }) {
  slab(c, x0, x0 + w, 0, H);
  wainscot(c, x0, x0 + w);
  paper(c, x0, x0 + w);
  if (opt.sconce) sconce(c, x0 + w / 2, 3.3, 0.01);
}

export function pilaster(c: ModuleCtx, x0: number, w: number) {
  const k = c.kit, f = c.f, cx = x0 + w / 2;
  slab(c, x0, x0 + w, 0, H);
  const D = 0.34;
  k.box("marbleBlack", v(cx, 0.3, D / 2 + 0.03), v(w, 0.6, D + 0.06), { collide: true }, f);
  k.box("goldSolid", v(cx, 0.63, D / 2 + 0.03), v(w - 0.04, 0.06, D + 0.04), {}, f);
  k.box("marbleEmerald", v(cx, (0.66 + 6.9) / 2, D / 2), v(w - 0.2, 6.9 - 0.66, D), { collide: true }, f);
  // fluting: gold reeds
  for (const dx of [-0.22, 0, 0.22]) k.box("goldSolid", v(cx + dx, (0.9 + 6.6) / 2, D + 0.01), v(0.035, 6.6 - 0.9, 0.03), {}, f);
  // stepped (ziggurat) capital
  k.box("goldSolid", v(cx, 6.97, D / 2 + 0.02), v(w - 0.12, 0.14, D + 0.04), {}, f);
  k.box("marbleBlack", v(cx, 7.17, D / 2 + 0.04), v(w - 0.04, 0.26, D + 0.08), {}, f);
  k.box("goldSolid", v(cx, 7.38, D / 2 + 0.06), v(w + 0.06, 0.16, D + 0.12), {}, f);
  k.box("goldSolid", v(cx, 7.56, D / 2 + 0.04), v(w - 0.3, 0.2, D + 0.08), {}, f);
  sconce(c, cx, 3.4, D + 0.02);
}

export function windowModule(c: ModuleCtx, x0: number, w: number) {
  const k = c.kit, f = c.f;
  const jamb = 0.4, ox0 = x0 + jamb, ox1 = x0 + w - jamb, oy0 = WAINS, oy1 = 7.0;
  const cx = x0 + w / 2;
  // structure around the opening
  slab(c, x0, x0 + w, 0, oy0);
  slab(c, x0, x0 + w, oy1, H);
  slab(c, x0, ox0, oy0, oy1);
  slab(c, ox1, x0 + w, oy0, oy1);
  // stepped deco head: notch blocks in the top corners
  k.box("plaster", v(ox0 + 0.2, oy1 - 0.25, -T / 2), v(0.4, 0.5, T), { collide: true }, f);
  k.box("plaster", v(ox1 - 0.2, oy1 - 0.25, -T / 2), v(0.4, 0.5, T), { collide: true }, f);
  wainscot(c, x0, x0 + w);
  paper(c, x0, ox0, WAINS + 0.07, oy1);
  paper(c, ox1, x0 + w, WAINS + 0.07, oy1);
  paper(c, x0, x0 + w, oy1, CORNICE);
  // marble sill
  k.box("marbleCream", v(cx, oy0 + 0.05, -T / 2 + 0.08), v(ox1 - ox0 + 0.2, 0.1, T + 0.16), { collide: true }, f);
  // brass casing
  const cz = 0.03;
  k.box("goldSolid", v(ox0 - 0.05, (oy0 + oy1) / 2, cz), v(0.1, oy1 - oy0, 0.06), {}, f);
  k.box("goldSolid", v(ox1 + 0.05, (oy0 + oy1) / 2, cz), v(0.1, oy1 - oy0, 0.06), {}, f);
  k.box("goldSolid", v(cx, oy1 + 0.05, cz), v(ox1 - ox0 + 0.2, 0.1, 0.06), {}, f);
  // mullions (cast the window pattern on the floor)
  const mz = -T * 0.55, ow = ox1 - ox0;
  for (const t of [1 / 3, 2 / 3]) k.box("brass", v(ox0 + ow * t, (oy0 + oy1) / 2, mz), v(0.05, oy1 - oy0, 0.06), {}, f);
  for (let y = oy0 + 0.95; y < oy1 - 0.3; y += 0.95) k.box("brass", v(cx, y, mz), v(ow, 0.05, 0.06), {}, f);
  // stepped transom bars
  k.box("brass", v(cx, oy1 - 0.5, mz), v(ow - 0.8, 0.05, 0.06), {}, f);
  // glass
  const g = MeshBuilder.CreatePlane("g", { width: ow, height: oy1 - oy0 }, k.scene);
  k.add("glass", g, v(cx, (oy0 + oy1) / 2, mz - 0.04), { rotY: Math.PI, shadow: false }, f);
  // curtains + pelmet
  k.box("burgundyLacquer", v(cx, 7.38, 0.2), v(w, 0.42, 0.18), {}, f);
  k.box("goldSolid", v(cx, 7.16, 0.3), v(w, 0.05, 0.03), {}, f);
  k.add("velvet", drape(k.scene, 0.85, 7.2, 7, 0.07, 2.0, -1), v(ox0 + 0.05, 0.02, 0.17), { shadow: true }, f);
  k.add("velvet", drape(k.scene, 0.85, 7.2, 7, 0.07, 2.0, 1), v(ox1 - 0.05, 0.02, 0.17), { shadow: true }, f);
  // tie-backs
  k.box("goldSolid", v(ox0 + 0.05, 2.0, 0.24), v(0.28, 0.08, 0.1), {}, f);
  k.box("goldSolid", v(ox1 - 0.05, 2.0, 0.24), v(0.28, 0.08, 0.1), {}, f);

  const center = Kit.toWorld(f, v(cx, (oy0 + oy1) / 2, mz));
  const normal = Kit.toWorld({ origin: Vector3.Zero(), rotY: f.rotY }, v(0, 0, 1));
  c.windows.push({ center, normal, width: ow, bottom: oy0, top: oy1 });
}

export function mirror(c: ModuleCtx, x0: number, w: number) {
  const k = c.kit, f = c.f, cx = x0 + w / 2;
  slab(c, x0, x0 + w, 0, H);
  wainscot(c, x0, x0 + w);
  paper(c, x0, x0 + w);
  const mw = w - 0.9, y0 = 1.65, y1 = 6.5;
  const m = MeshBuilder.CreatePlane("m", { width: mw, height: y1 - y0 }, k.scene);
  k.add(c.mirrorMat ?? "mirror", m, v(cx, (y0 + y1) / 2, 0.035), { rotY: Math.PI, shadow: false }, f);
  k.box("lacquer", v(cx, (y0 + y1) / 2, 0.02), v(mw + 0.3, y1 - y0 + 0.3, 0.03), {}, f);
  // gold frame
  k.box("goldSolid", v(cx - mw / 2 - 0.06, (y0 + y1) / 2, 0.06), v(0.1, y1 - y0 + 0.2, 0.06), {}, f);
  k.box("goldSolid", v(cx + mw / 2 + 0.06, (y0 + y1) / 2, 0.06), v(0.1, y1 - y0 + 0.2, 0.06), {}, f);
  k.box("goldSolid", v(cx, y0 - 0.06, 0.06), v(mw + 0.22, 0.1, 0.06), {}, f);
  k.box("goldSolid", v(cx, y1 + 0.06, 0.06), v(mw + 0.22, 0.1, 0.06), {}, f);
  // stepped crest
  k.box("goldSolid", v(cx, y1 + 0.22, 0.05), v(mw * 0.7, 0.2, 0.05), {}, f);
  k.box("goldSolid", v(cx, y1 + 0.42, 0.05), v(mw * 0.4, 0.2, 0.05), {}, f);
  k.box("goldSolid", v(cx, y1 + 0.6, 0.05), v(mw * 0.15, 0.16, 0.05), {}, f);
  // deco divider lines in the mirror (bevelled strips)
  k.box("goldSolid", v(cx, y0 + (y1 - y0) * 0.62, 0.045), v(mw, 0.025, 0.012), { shadow: false }, f);
}

export function door(c: ModuleCtx, x0: number, w: number, opt: { opening?: number; height?: number }) {
  const k = c.kit, f = c.f, cx = x0 + w / 2;
  const ow = opt.opening ?? 2.4, oh = opt.height ?? 3.6;
  const ox0 = cx - ow / 2, ox1 = cx + ow / 2;
  slab(c, x0, ox0, 0, H);
  slab(c, ox1, x0 + w, 0, H);
  slab(c, ox0, ox1, oh, H);
  wainscot(c, x0, ox0 - 0.2);
  wainscot(c, ox1 + 0.2, x0 + w);
  paper(c, x0, ox0 - 0.2);
  paper(c, ox1 + 0.2, x0 + w);
  paper(c, ox0 - 0.2, ox1 + 0.2, oh + 0.3, CORNICE);
  // leaves (closed for now; collide)
  const lz = -T * 0.4;
  for (const s of [-1, 1]) {
    const lx = cx + (s * ow) / 4;
    k.box("walnut", v(lx, oh / 2, lz), v(ow / 2 - 0.01, oh, 0.08), { collide: true }, f);
    // inlay: vertical gold lines + chevron
    for (const dx of [-0.25, 0, 0.25]) k.box("goldSolid", v(lx + dx * (ow / 2.4), oh * 0.55, lz + 0.045), v(0.02, oh * 0.62, 0.01), { shadow: false }, f);
    k.box("goldSolid", v(lx, oh * 0.2, lz + 0.045), v(ow / 2 - 0.25, 0.03, 0.01), { shadow: false }, f);
    k.box("brass", v(cx + s * 0.12, oh * 0.48, lz + 0.07), v(0.04, 0.4, 0.04), {}, f);
  }
  // architrave
  k.box("goldSolid", v(ox0 - 0.1, oh / 2, 0.05), v(0.2, oh, 0.1), {}, f);
  k.box("goldSolid", v(ox1 + 0.1, oh / 2, 0.05), v(0.2, oh, 0.1), {}, f);
  k.box("marbleBlack", v(cx, oh + 0.15, 0.06), v(ow + 0.6, 0.3, 0.12), {}, f);
  k.box("goldSolid", v(cx, oh + 0.34, 0.08), v(ow + 0.8, 0.08, 0.16), {}, f);
  // sunburst transom above the door
  const r = Math.min(ow / 2, CORNICE - oh - 0.6);
  const by = oh + 0.4;
  const fan = MeshBuilder.CreateDisc("fan", { radius: r, tessellation: 40, arc: 0.5 }, k.scene);
  k.add("lacquer", fan, v(cx, by, 0.025), { rotY: Math.PI }, f);
  const rays = 13;
  for (let i = 0; i < rays; i++) {
    const a = (i / (rays - 1)) * Math.PI - Math.PI / 2;
    k.box("goldSolid", v(cx + Math.sin(a) * r * 0.55, by + Math.cos(a) * r * 0.55, 0.045), v(0.03, r * 0.8, 0.02), { rotZ: -a, shadow: false }, f);
  }
  const ring = MeshBuilder.CreateTorus("ring", { diameter: r * 2, thickness: 0.06, tessellation: 48 }, k.scene);
  k.add("goldSolid", ring, v(cx, by, 0.04), { rotX: Math.PI / 2 }, f);
  k.cyl("goldSolid", v(cx, by, 0.05), 0.04, 0.3, { rotX: Math.PI / 2 }, f);
}

export function stage(c: ModuleCtx, x0: number, w: number) {
  const k = c.kit, f = c.f, cx = x0 + w / 2;
  const SH = 0.9, SD = 4.6; // stage height & depth
  const px0 = x0 + 2, px1 = x0 + w - 2, pTop = 6.5;
  slab(c, x0, x0 + w, 0, H);
  wainscot(c, x0, px0 - 0.5);
  wainscot(c, px1 + 0.5, x0 + w);
  paper(c, x0, px0 - 0.5);
  paper(c, px1 + 0.5, x0 + w);
  paper(c, px0 - 0.5, px1 + 0.5, pTop + 0.5, CORNICE);

  // backdrop: black lacquer + rising-sun rays
  k.box("lacquer", v(cx, (SH + pTop) / 2, 0.02), v(px1 - px0, pTop - SH, 0.04), {}, f);
  const R = 5.3, by = SH;
  const rays = 21;
  for (let i = 0; i < rays; i++) {
    const a = (i / (rays - 1)) * Math.PI - Math.PI / 2;
    const len = i % 2 ? R * 0.78 : R;
    k.box("goldSolid", v(cx + Math.sin(a) * (len / 2 + 0.6), by + Math.cos(a) * (len / 2 + 0.6), 0.05), v(0.07, len - 1.2, 0.025), { rotZ: -a, shadow: false }, f);
  }
  for (const rr of [1.2, 2.6]) {
    const t = MeshBuilder.CreateTorus("t", { diameter: rr * 2, thickness: 0.06, tessellation: 64 }, k.scene);
    k.add("goldSolid", t, v(cx, by, 0.05), { rotX: Math.PI / 2 }, f);
  }

  // proscenium: stepped gold towers + header
  for (const s of [-1, 1]) {
    const tx = s < 0 ? px0 - 0.25 : px1 + 0.25;
    k.box("goldSolid", v(tx, pTop / 2, 0.25), v(0.5, pTop, 0.5), { collide: true }, f);
    k.box("marbleBlack", v(tx, pTop / 2, 0.36), v(0.3, pTop - 1.2, 0.5), {}, f);
    k.box("goldSolid", v(tx, pTop + 0.25, 0.3), v(0.7, 0.5, 0.6), {}, f);
    k.box("goldSolid", v(tx, pTop + 0.6, 0.25), v(0.45, 0.25, 0.5), {}, f);
  }
  k.box("goldSolid", v(cx, pTop + 0.12, 0.3), v(px1 - px0, 0.24, 0.5), {}, f);
  k.box("marbleBlack", v(cx, pTop + 0.36, 0.25), v(px1 - px0, 0.24, 0.42), {}, f);

  // curtains + swag valance
  k.add("velvet", drape(k.scene, 2.3, pTop - SH - 0.1, 11, 0.12, 2.1, -1), v(px0 + 1.15, SH, 0.45), {}, f);
  k.add("velvet", drape(k.scene, 2.3, pTop - SH - 0.1, 11, 0.12, 2.1, 1), v(px1 - 1.15, SH, 0.45), {}, f);
  k.add("velvet", drape(k.scene, px1 - px0, 0.9, 30, 0.1, -10, 0), v(cx, pTop - 0.85, 0.55), {}, f);
  k.box("goldSolid", v(cx, pTop - 0.86, 0.6), v(px1 - px0, 0.04, 0.04), { shadow: false }, f);

  // platform
  k.box("marbleBlack", v(cx, SH / 2, SD / 2), v(px1 - px0 + 1.4, SH, SD), { collide: true }, f);
  k.box("parquet", v(cx, SH + 0.01, SD / 2 - 0.04), v(px1 - px0 + 1.3, 0.02, SD - 0.12), { tile: 2.2 }, f);
  for (const y of [0.3, 0.62]) k.box("goldSolid", v(cx, y, SD + 0.005), v(px1 - px0 + 1.4, 0.04, 0.02), { shadow: false }, f);
  k.box("goldSolid", v(cx, SH - 0.02, SD - 0.02), v(px1 - px0 + 1.42, 0.06, 0.08), {}, f);
  // steps
  k.box("marbleBlack", v(cx, 0.15, SD + 0.45), v(4.4, 0.3, 0.9), { collide: true }, f);
  k.box("marbleBlack", v(cx, 0.45, SD + 0.22), v(4.4, 0.3, 0.45), { collide: true }, f);
  k.box("goldSolid", v(cx, 0.305, SD + 0.9), v(4.4, 0.02, 0.03), { shadow: false }, f);
  k.box("goldSolid", v(cx, 0.605, SD + 0.45), v(4.4, 0.02, 0.03), { shadow: false }, f);
  // footlights
  for (let i = 0; i < 11; i++) {
    const fx = px0 + 0.4 + (i / 10) * (px1 - px0 - 0.8);
    if (Math.abs(fx - cx) < 2.3) continue;
    const s = MeshBuilder.CreateSphere("fl", { diameter: 0.14, segments: 8, slice: 0.5 }, k.scene);
    k.add("lampGlow", s, v(fx, SH, SD - 0.15), { shadow: false }, f);
    if (i % 3 === 0) c.lights.push({ pos: Kit.toWorld(f, v(fx, SH + 0.3, SD - 0.4)), kind: "foot" });
  }
  // warm wash on the backdrop + curtains from hidden stage lamps
  for (const t of [0.2, 0.5, 0.8]) {
    c.lights.push({ pos: Kit.toWorld(f, v(px0 + (px1 - px0) * t, SH + 0.5, 1.6)), kind: "foot" });
  }

  // hero clock above the proscenium
  const ccy = 7.45, cr = 0.95, cz = 0.62;
  const face = MeshBuilder.CreateCylinder("cf", { height: 0.04, diameter: cr * 2, tessellation: 64 }, k.scene);
  k.add("clockFace", face, v(cx, ccy, cz), { rotX: Math.PI / 2, shadow: false }, f);
  const rim = MeshBuilder.CreateTorus("cr", { diameter: cr * 2 + 0.08, thickness: 0.12, tessellation: 64 }, k.scene);
  k.add("goldSolid", rim, v(cx, ccy, cz), { rotX: Math.PI / 2 }, f);
  k.cyl("lacquer", v(cx, ccy, cz - 0.08), 0.12, cr * 2 + 0.5, { rotX: Math.PI / 2, tess: 12 }, f);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const big = i % 3 === 0;
    k.box("lacquer", v(cx + Math.sin(a) * cr * 0.8, ccy + Math.cos(a) * cr * 0.8, cz + 0.03), v(big ? 0.07 : 0.035, big ? 0.22 : 0.14, 0.02), { rotZ: -a, shadow: false }, f);
  }
  // deco rays behind the clock
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    k.box("goldSolid", v(cx + Math.sin(a) * (cr + 0.42), ccy + Math.cos(a) * (cr + 0.42), cz - 0.12), v(0.05, 0.55, 0.03), { rotZ: -a, shadow: false }, f);
  }
  c.clock = {
    center: Kit.toWorld(f, v(cx, ccy, cz + 0.05)),
    normal: Kit.toWorld({ origin: Vector3.Zero(), rotY: f.rotY }, v(0, 0, 1)),
    radius: cr,
  };
  c.lights.push({ pos: Kit.toWorld(f, v(cx, ccy, cz + 1.0)), kind: "clock" });
}

// ---------------- curtain drape ----------------

/**
 * Pleated velvet drape. Local x ∈ [-w/2, w/2], y ∈ [0, h], z = fold depth.
 * `side` gathers toward -1 (left) / +1 (right) at height `tieY`; 0 = no gather.
 */
export function drape(scene: Scene, w: number, h: number, folds: number, depth: number, tieY: number, side: number): Mesh {
  const rows = 40, cols = folds * 8;
  const paths: Vector3[][] = [];
  for (let r = 0; r <= rows; r++) {
    const y = (r / rows) * h;
    const g = side ? 0.62 * Math.exp(-Math.pow((y - tieY) / 1.1, 2)) + (y < tieY ? 0.25 * (1 - y / tieY) : 0) : 0;
    const squeeze = 1 - Math.min(0.75, g);
    const path: Vector3[] = [];
    for (let i = 0; i <= cols; i++) {
      const t = i / cols;
      let x = (t - 0.5) * w;
      if (side) x = side * (w / 2) + (x - side * (w / 2)) * squeeze;
      const amp = depth / Math.sqrt(squeeze);
      const z = Math.sin(t * folds * Math.PI * 2) * amp * (0.8 + 0.2 * Math.sin(y * 1.3 + t * 7));
      // swag: valance sags between folds
      const sag = side === 0 ? -Math.pow(Math.sin(t * folds * Math.PI), 2) * 0.0 : 0;
      path.push(new Vector3(x, y + sag, z));
    }
    paths.push(path);
  }
  const m = MeshBuilder.CreateRibbon("drape", { pathArray: paths, sideOrientation: Mesh.DOUBLESIDE }, scene);
  return m;
}
