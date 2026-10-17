// Art-deco architectural modules. Each module occupies [x0, x0+w] along a
// wall frame (x along wall, y up, z into the room; wall body is z ∈ [-T, 0]).
// Room-specific look (height, panelling, finishes) comes from a RoomStyle.
import { Mesh, MeshBuilder, Vector3, Scene } from "@babylonjs/core";
import { Kit, Frame } from "./kit";

export const T = 0.5; // wall thickness

export interface RoomStyle {
  H: number; // ceiling height
  cornice: number; // underside of cornice
  wains: number; // wainscot height (0 = none)
  slabMat: string;
  wainsMat: string;
  paperMat: string; // upper wall finish
  baseMat: string; // skirting
  trimMat: string; // chair rail, frames
  pilasterMat: string;
  pilasterBase: string;
  corniceMat: string;
  cove: boolean; // glowing cove line in the cornice
  windowTop: number;
  sillMat: string;
  panelFrames: boolean; // inset brass frames on the wainscot
  sconceY: number;
}

export const STYLES: Record<string, RoomStyle> = {
  ballroom: {
    H: 9, cornice: 7.7, wains: 1.3, slabMat: "plaster", wainsMat: "burgundyLacquer", paperMat: "wallFan", baseMat: "marbleBlack",
    trimMat: "goldSolid", pilasterMat: "marbleEmerald", pilasterBase: "marbleBlack", corniceMat: "marbleCream", cove: true,
    windowTop: 7.0, sillMat: "marbleCream", panelFrames: true, sconceY: 3.3,
  },
  study: {
    H: 4.6, cornice: 4.15, wains: 2.4, slabMat: "plaster", wainsMat: "walnutPanel", paperMat: "studyPaper", baseMat: "walnut",
    trimMat: "goldSolid", pilasterMat: "walnutPanel", pilasterBase: "walnut", corniceMat: "walnut", cove: false,
    windowTop: 3.7, sillMat: "walnut", panelFrames: true, sconceY: 2.15,
  },
  kitchen: {
    H: 4.2, cornice: 3.95, wains: 1.6, slabMat: "plaster", wainsMat: "kitchenTile", paperMat: "plaster", baseMat: "marbleBlack",
    trimMat: "brass", pilasterMat: "plaster", pilasterBase: "marbleBlack", corniceMat: "plaster", cove: false,
    windowTop: 3.5, sillMat: "marbleCream", panelFrames: false, sconceY: 2.4,
  },
};

export interface LightSpot {
  pos: Vector3;
  kind: "sconce" | "candle" | "foot" | "cove" | "clock" | "fire" | "lamp" | "garden";
}

export interface DoorSpec {
  id: string;
  hinge: Vector3[]; // world hinge point per leaf (at floor)
  rotY: number; // wall frame rotation
  leafW: number;
  height: number;
  leaves: number;
  open: number[]; // swing direction per leaf (+1 / -1)
  glazed: boolean;
}

export interface ModuleCtx {
  kit: Kit;
  f: Frame;
  st: RoomStyle;
  room: string;
  lights: LightSpot[];
  windows: { center: Vector3; normal: Vector3; width: number; bottom: number; top: number }[];
  doors: DoorSpec[];
  /** named interactable anchors produced by modules (safe, fuse box, fireplace…) */
  anchors: Record<string, { pos: Vector3; normal: Vector3 }>;
  clock?: { center: Vector3; normal: Vector3; radius: number };
  mirrorMat?: string;
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
const worldN = (c: ModuleCtx) => Kit.toWorld({ origin: Vector3.Zero(), rotY: c.f.rotY }, v(0, 0, 1));

// ---------------- common dressing ----------------

function slab(c: ModuleCtx, x0: number, x1: number, y0: number, y1: number) {
  if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3) return;
  c.kit.box(c.st.slabMat, v((x0 + x1) / 2, (y0 + y1) / 2, -T / 2), v(x1 - x0, y1 - y0, T), { collide: true }, c.f);
}

function wainscot(c: ModuleCtx, x0: number, x1: number) {
  const st = c.st, w = x1 - x0, cx = (x0 + x1) / 2;
  if (w < 1e-3) return;
  c.kit.box(st.baseMat, v(cx, 0.12, 0.04), v(w, 0.24, 0.08), {}, c.f);
  if (st.wains <= 0) return;
  c.kit.box(st.wainsMat, v(cx, st.wains / 2, 0.02), v(w, st.wains, 0.04), {}, c.f);
  c.kit.box(st.trimMat, v(cx, st.wains + 0.03, 0.05), v(w, 0.07, 0.1), {}, c.f);
  if (!st.panelFrames) return;
  const n = Math.max(1, Math.round(w / 1.3));
  const pw = w / n;
  for (let i = 0; i < n; i++) {
    const px0 = x0 + i * pw + 0.14, px1 = x0 + (i + 1) * pw - 0.14;
    if (px1 - px0 < 0.2) continue;
    const pcx = (px0 + px1) / 2, y0 = 0.38, y1 = st.wains - 0.16;
    c.kit.box("brass", v(pcx, y0, 0.045), v(px1 - px0, 0.025, 0.012), { shadow: false }, c.f);
    c.kit.box("brass", v(pcx, y1, 0.045), v(px1 - px0, 0.025, 0.012), { shadow: false }, c.f);
    c.kit.box("brass", v(px0, (y0 + y1) / 2, 0.045), v(0.025, y1 - y0, 0.012), { shadow: false }, c.f);
    c.kit.box("brass", v(px1, (y0 + y1) / 2, 0.045), v(0.025, y1 - y0, 0.012), { shadow: false }, c.f);
  }
}

function paper(c: ModuleCtx, x0: number, x1: number, y0 = c.st.wains + 0.07, y1 = c.st.cornice) {
  if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3) return;
  c.kit.box(c.st.paperMat, v((x0 + x1) / 2, (y0 + y1) / 2, 0.006), v(x1 - x0, y1 - y0, 0.012), { shadow: false }, c.f);
}

/** Continuous cornice for a whole wall (length L). */
export function cornice(c: ModuleCtx, L: number) {
  const k = c.kit, f = c.f, st = c.st, cx = L / 2, C = st.cornice, H = st.H;
  if (st.cove) {
    k.box("goldSolid", v(cx, C + 0.06, 0.04), v(L, 0.12, 0.08), {}, f);
    k.box(st.corniceMat, v(cx, C + 0.36, 0.08), v(L, 0.48, 0.16), {}, f);
    k.box("goldSolid", v(cx, C + 0.66, 0.13), v(L, 0.12, 0.26), {}, f);
    k.box("plaster", v(cx, (C + 0.72 + H) / 2, 0.19), v(L, H - C - 0.72, 0.38), {}, f);
    k.box("coveGlow", v(cx, C + 0.735, 0.34), v(L, 0.03, 0.05), { shadow: false }, f);
    c.lights.push({ pos: Kit.toWorld(f, v(cx, H - 0.6, 1.2)), kind: "cove" });
  } else {
    const h = H - C;
    k.box(st.trimMat, v(cx, C + 0.02, 0.03), v(L, 0.04, 0.06), {}, f);
    k.box(st.corniceMat, v(cx, C + h * 0.45, 0.06), v(L, h * 0.7, 0.12), {}, f);
    k.box(st.corniceMat, v(cx, H - h * 0.12, 0.11), v(L, h * 0.24, 0.22), {}, f);
  }
}

// ---------------- sconce ----------------

function sconce(c: ModuleCtx, x: number, y: number, z: number) {
  const k = c.kit, f = c.f;
  k.box("goldSolid", v(x, y, z + 0.02), v(0.26, 0.56, 0.04), {}, f);
  k.box("goldSolid", v(x, y + 0.32, z + 0.03), v(0.14, 0.1, 0.06), {}, f);
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
  slab(c, x0, x0 + w, 0, c.st.H);
  wainscot(c, x0, x0 + w);
  paper(c, x0, x0 + w);
  if (opt.sconce) sconce(c, x0 + w / 2, c.st.sconceY, 0.01);
}

export function pilaster(c: ModuleCtx, x0: number, w: number) {
  const k = c.kit, f = c.f, st = c.st, cx = x0 + w / 2;
  slab(c, x0, x0 + w, 0, st.H);
  const D = 0.34, cap = st.cornice - 0.73;
  k.box(st.pilasterBase, v(cx, 0.3, D / 2 + 0.03), v(w, 0.6, D + 0.06), { collide: true }, f);
  k.box(st.trimMat, v(cx, 0.63, D / 2 + 0.03), v(w - 0.04, 0.06, D + 0.04), {}, f);
  k.box(st.pilasterMat, v(cx, (0.66 + cap) / 2, D / 2), v(w - 0.2, cap - 0.66, D), { collide: true }, f);
  for (const dx of [-0.22, 0, 0.22]) k.box(st.trimMat, v(cx + dx, (0.9 + cap - 0.3) / 2, D + 0.01), v(0.035, cap - 0.3 - 0.9, 0.03), {}, f);
  k.box(st.trimMat, v(cx, cap + 0.07, D / 2 + 0.02), v(w - 0.12, 0.14, D + 0.04), {}, f);
  k.box(st.pilasterBase, v(cx, cap + 0.27, D / 2 + 0.04), v(w - 0.04, 0.26, D + 0.08), {}, f);
  k.box(st.trimMat, v(cx, cap + 0.48, D / 2 + 0.06), v(w + 0.06, 0.16, D + 0.12), {}, f);
  k.box(st.trimMat, v(cx, cap + 0.66, D / 2 + 0.04), v(w - 0.3, 0.2, D + 0.08), {}, f);
  sconce(c, cx, Math.min(3.4, st.sconceY + 0.1), D + 0.02);
}

export function windowModule(c: ModuleCtx, x0: number, w: number) {
  const k = c.kit, f = c.f, st = c.st;
  const jamb = 0.4, ox0 = x0 + jamb, ox1 = x0 + w - jamb, oy0 = Math.max(st.wains, 0.9), oy1 = st.windowTop;
  const cx = x0 + w / 2;
  slab(c, x0, x0 + w, 0, oy0);
  slab(c, x0, x0 + w, oy1, st.H);
  slab(c, x0, ox0, oy0, oy1);
  slab(c, ox1, x0 + w, oy0, oy1);
  k.box(st.slabMat, v(ox0 + 0.2, oy1 - 0.25, -T / 2), v(0.4, 0.5, T), { collide: true }, f);
  k.box(st.slabMat, v(ox1 - 0.2, oy1 - 0.25, -T / 2), v(0.4, 0.5, T), { collide: true }, f);
  wainscot(c, x0, x0 + w);
  paper(c, x0, ox0, st.wains + 0.07, oy1);
  paper(c, ox1, x0 + w, st.wains + 0.07, oy1);
  paper(c, x0, x0 + w, oy1, st.cornice);
  k.box(st.sillMat, v(cx, oy0 + 0.05, -T / 2 + 0.08), v(ox1 - ox0 + 0.2, 0.1, T + 0.16), { collide: true }, f);
  const cz = 0.03;
  k.box(st.trimMat, v(ox0 - 0.05, (oy0 + oy1) / 2, cz), v(0.1, oy1 - oy0, 0.06), {}, f);
  k.box(st.trimMat, v(ox1 + 0.05, (oy0 + oy1) / 2, cz), v(0.1, oy1 - oy0, 0.06), {}, f);
  k.box(st.trimMat, v(cx, oy1 + 0.05, cz), v(ox1 - ox0 + 0.2, 0.1, 0.06), {}, f);
  const mz = -T * 0.55, ow = ox1 - ox0;
  for (const t of [1 / 3, 2 / 3]) k.box("brass", v(ox0 + ow * t, (oy0 + oy1) / 2, mz), v(0.05, oy1 - oy0, 0.06), {}, f);
  for (let y = oy0 + 0.95; y < oy1 - 0.3; y += 0.95) k.box("brass", v(cx, y, mz), v(ow, 0.05, 0.06), {}, f);
  k.box("brass", v(cx, oy1 - 0.5, mz), v(ow - 0.8, 0.05, 0.06), {}, f);
  const g = MeshBuilder.CreatePlane("g", { width: ow, height: oy1 - oy0 }, k.scene);
  k.add("glass", g, v(cx, (oy0 + oy1) / 2, mz - 0.04), { rotY: Math.PI, shadow: false }, f);
  const pel = oy1 + 0.38;
  k.box("burgundyLacquer", v(cx, pel, 0.2), v(w, 0.42, 0.18), {}, f);
  k.box("goldSolid", v(cx, pel - 0.22, 0.3), v(w, 0.05, 0.03), {}, f);
  k.add("velvet", drape(k.scene, 0.85, pel - 0.18, 7, 0.07, 2.0, -1), v(ox0 + 0.05, 0.02, 0.17), { shadow: true }, f);
  k.add("velvet", drape(k.scene, 0.85, pel - 0.18, 7, 0.07, 2.0, 1), v(ox1 - 0.05, 0.02, 0.17), { shadow: true }, f);
  k.box("goldSolid", v(ox0 + 0.05, 2.0, 0.24), v(0.28, 0.08, 0.1), {}, f);
  k.box("goldSolid", v(ox1 - 0.05, 2.0, 0.24), v(0.28, 0.08, 0.1), {}, f);
  c.windows.push({ center: Kit.toWorld(f, v(cx, (oy0 + oy1) / 2, mz)), normal: worldN(c), width: ow, bottom: oy0, top: oy1 });
}

export function mirror(c: ModuleCtx, x0: number, w: number) {
  const k = c.kit, f = c.f, st = c.st, cx = x0 + w / 2;
  slab(c, x0, x0 + w, 0, st.H);
  wainscot(c, x0, x0 + w);
  paper(c, x0, x0 + w);
  const mw = w - 0.9, y0 = st.wains + 0.35, y1 = Math.min(6.5, st.cornice - 1.2);
  const m = MeshBuilder.CreatePlane("m", { width: mw, height: y1 - y0 }, k.scene);
  k.add(c.mirrorMat ?? "mirror", m, v(cx, (y0 + y1) / 2, 0.035), { rotY: Math.PI, shadow: false }, f);
  k.box("lacquer", v(cx, (y0 + y1) / 2, 0.02), v(mw + 0.3, y1 - y0 + 0.3, 0.03), {}, f);
  k.box("goldSolid", v(cx - mw / 2 - 0.06, (y0 + y1) / 2, 0.06), v(0.1, y1 - y0 + 0.2, 0.06), {}, f);
  k.box("goldSolid", v(cx + mw / 2 + 0.06, (y0 + y1) / 2, 0.06), v(0.1, y1 - y0 + 0.2, 0.06), {}, f);
  k.box("goldSolid", v(cx, y0 - 0.06, 0.06), v(mw + 0.22, 0.1, 0.06), {}, f);
  k.box("goldSolid", v(cx, y1 + 0.06, 0.06), v(mw + 0.22, 0.1, 0.06), {}, f);
  k.box("goldSolid", v(cx, y1 + 0.22, 0.05), v(mw * 0.7, 0.2, 0.05), {}, f);
  k.box("goldSolid", v(cx, y1 + 0.42, 0.05), v(mw * 0.4, 0.2, 0.05), {}, f);
  k.box("goldSolid", v(cx, y1 + 0.6, 0.05), v(mw * 0.15, 0.16, 0.05), {}, f);
  k.box("goldSolid", v(cx, y0 + (y1 - y0) * 0.62, 0.045), v(mw, 0.025, 0.012), { shadow: false }, f);
}

/**
 * Doorway. With an `id` the leaves become animated door entities (ctx.doors);
 * without one they are sealed decorative doors (merged, collide).
 */
export function door(c: ModuleCtx, x0: number, w: number, opt: { opening?: number; height?: number; id?: string; glazed?: boolean; leaves?: number; swing?: number; fanlight?: boolean; frameOnly?: boolean }) {
  const k = c.kit, f = c.f, st = c.st, cx = x0 + w / 2;
  const ow = opt.opening ?? 2.4, oh = opt.height ?? 3.6;
  const ox0 = cx - ow / 2, ox1 = cx + ow / 2;
  slab(c, x0, ox0, 0, st.H);
  slab(c, ox1, x0 + w, 0, st.H);
  slab(c, ox0, ox1, oh, st.H);
  wainscot(c, x0, ox0 - 0.2);
  wainscot(c, ox1 + 0.2, x0 + w);
  paper(c, x0, ox0 - 0.2);
  paper(c, ox1 + 0.2, x0 + w);
  paper(c, ox0 - 0.2, ox1 + 0.2, oh + 0.3, st.cornice);
  const leaves = opt.leaves ?? (ow > 1.6 ? 2 : 1);
  const lz = -T * 0.4, leafW = ow / leaves;
  if (opt.frameOnly) {
    // other side of a shared wall: the leaves belong to the neighbouring room
  } else if (opt.id) {
    const hinge: Vector3[] = [], open: number[] = [];
    for (let i = 0; i < leaves; i++) {
      const left = i === 0;
      hinge.push(Kit.toWorld(f, v(left ? ox0 : ox1, 0, lz)));
      open.push((left ? 1 : -1) * (opt.swing ?? 1));
    }
    c.doors.push({ id: opt.id, hinge, rotY: f.rotY, leafW, height: oh, leaves, open, glazed: !!opt.glazed });
    c.anchors[`door.${opt.id}`] = { pos: Kit.toWorld(f, v(cx, 1.2, 0.3)), normal: worldN(c) };
  } else {
    for (let i = 0; i < leaves; i++) {
      const lx = ox0 + leafW * (i + 0.5);
      k.box("walnut", v(lx, oh / 2, lz), v(leafW - 0.01, oh, 0.08), { collide: true }, f);
      for (const dx of [-0.25, 0, 0.25]) k.box("goldSolid", v(lx + dx * (leafW / 1.2), oh * 0.55, lz + 0.045), v(0.02, oh * 0.62, 0.01), { shadow: false }, f);
      k.box("goldSolid", v(lx, oh * 0.2, lz + 0.045), v(leafW - 0.25, 0.03, 0.01), { shadow: false }, f);
    }
  }
  k.box(st.trimMat, v(ox0 - 0.1, oh / 2, 0.05), v(0.2, oh, 0.1), {}, f);
  k.box(st.trimMat, v(ox1 + 0.1, oh / 2, 0.05), v(0.2, oh, 0.1), {}, f);
  k.box("marbleBlack", v(cx, oh + 0.15, 0.06), v(ow + 0.6, 0.3, 0.12), {}, f);
  k.box(st.trimMat, v(cx, oh + 0.34, 0.08), v(ow + 0.8, 0.08, 0.16), {}, f);
  if (opt.fanlight === false) return;
  const r = Math.min(ow / 2, st.cornice - oh - 0.6);
  if (r < 0.4) return;
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

/** Built-in bookshelves with procedurally varied books. */
export function shelves(c: ModuleCtx, x0: number, w: number, opt: { seed?: number }) {
  const k = c.kit, f = c.f, st = c.st;
  slab(c, x0, x0 + w, 0, st.H);
  paper(c, x0, x0 + w, st.cornice - 0.4, st.cornice);
  const D = 0.42, top = st.cornice - 0.45;
  k.box("walnut", v(x0 + 0.04, top / 2, D / 2), v(0.08, top, D), { collide: true }, f);
  k.box("walnut", v(x0 + w - 0.04, top / 2, D / 2), v(0.08, top, D), { collide: true }, f);
  k.box("walnut", v(x0 + w / 2, top - 0.04, D / 2), v(w, 0.08, D + 0.04), {}, f);
  k.box("walnut", v(x0 + w / 2, 0.45, D / 2), v(w, 0.9, D), { collide: true }, f);
  k.box("goldSolid", v(x0 + w / 2, 0.9, D + 0.005), v(w - 0.1, 0.03, 0.02), { shadow: false }, f);
  k.box("walnutPanel", v(x0 + w / 2, top / 2 + 0.45, 0.02), v(w - 0.16, top - 0.9, 0.04), {}, f);
  let seed = (opt.seed ?? 7) * 9301 + Math.round(x0 * 100);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const bookMats = ["bookRed", "bookGreen", "bookNavy", "bookTan", "bookBlack", "bookRed", "bookGreen"];
  for (let y = 0.98; y < top - 0.3; y += 0.42) {
    k.box("walnut", v(x0 + w / 2, y - 0.02, D / 2), v(w - 0.16, 0.04, D), {}, f);
    let x = x0 + 0.1;
    while (x < x0 + w - 0.12) {
      const bw = 0.03 + rnd() * 0.035, bh = 0.24 + rnd() * 0.1;
      if (rnd() < 0.08) {
        x += 0.12;
        continue;
      }
      const lean = rnd() < 0.06 ? 0.2 : 0;
      if (x + bw > x0 + w - 0.12) break;
      k.box(bookMats[Math.floor(rnd() * bookMats.length)], v(x + bw / 2, y + bh / 2, D * 0.55), v(bw, bh, 0.22 + rnd() * 0.05), { rotZ: lean, shadow: false }, f);
      if (rnd() < 0.3) k.box("goldSolid", v(x + bw / 2, y + bh * 0.8, D * 0.55 + 0.125), v(bw * 0.9, 0.012, 0.004), { shadow: false }, f);
      x += bw + 0.004;
    }
  }
}

/** Marble fireplace with a warm fire glow. */
export function fireplace(c: ModuleCtx, x0: number, w: number) {
  const k = c.kit, f = c.f, cx = x0 + w / 2;
  slab(c, x0, x0 + w, 0, c.st.H);
  wainscot(c, x0, cx - 1.0);
  wainscot(c, cx + 1.0, x0 + w);
  paper(c, x0, x0 + w);
  k.box("marbleBlack", v(cx, 0.65, 0.18), v(2.0, 1.3, 0.36), { collide: true }, f);
  k.box("lacquer", v(cx, 0.45, 0.2), v(0.95, 0.75, 0.34), {}, f);
  k.box("emberGlow", v(cx, 0.16, 0.24), v(0.7, 0.08, 0.2), { shadow: false }, f);
  for (const dx of [-0.18, 0, 0.18]) k.box("walnut", v(cx + dx, 0.2, 0.26), v(0.12, 0.08, 0.3), { rotY: dx * 2, shadow: false }, f);
  k.box("goldSolid", v(cx, 1.33, 0.22), v(2.2, 0.06, 0.46), {}, f);
  k.box("marbleCream", v(cx, 1.38, 0.24), v(2.3, 0.06, 0.5), {}, f);
  for (const dx of [-0.6, -0.3, 0.3, 0.6]) k.box("goldSolid", v(cx + dx, 0.65, 0.365), v(0.03, 1.1, 0.01), { shadow: false }, f);
  c.lights.push({ pos: Kit.toWorld(f, v(cx, 0.45, 0.8)), kind: "fire" });
  c.anchors.fireplace = { pos: Kit.toWorld(f, v(cx, 0.6, 0.5)), normal: worldN(c) };
  c.anchors.mantel = { pos: Kit.toWorld(f, v(cx, 1.45, 0.25)), normal: worldN(c) };
}

/** Panel with a recessed wall safe (a painting hangs over it). */
export function safePanel(c: ModuleCtx, x0: number, w: number) {
  const k = c.kit, f = c.f, cx = x0 + w / 2;
  panel(c, x0, w, {});
  const y = c.st.wains + 0.75;
  k.box("lacquer", v(cx, y, 0.03), v(0.62, 0.62, 0.04), {}, f);
  // reads as a safe at a glance: brass trim, a big dial, a handle and hinges
  for (const [dx, dy, w, h] of [[0, 0.32, 0.66, 0.03], [0, -0.32, 0.66, 0.03], [-0.32, 0, 0.03, 0.66], [0.32, 0, 0.03, 0.66]])
    k.box("brass", v(cx + dx, y + dy, 0.045), v(w, h, 0.03), { shadow: false }, f);
  k.cyl("brass", v(cx + 0.06, y + 0.04, 0.06), 0.03, 0.2, { rotX: Math.PI / 2, tess: 32, shadow: false }, f);
  k.cyl("lacquer", v(cx + 0.06, y + 0.04, 0.078), 0.012, 0.11, { rotX: Math.PI / 2, tess: 24, shadow: false }, f);
  k.box("brass", v(cx - 0.18, y + 0.04, 0.07), v(0.035, 0.18, 0.035), { shadow: false }, f);
  for (const dy of [-0.2, 0.2]) k.box("brass", v(cx + 0.27, y + dy, 0.06), v(0.04, 0.08, 0.03), { shadow: false }, f);
  c.anchors.safe = { pos: Kit.toWorld(f, v(cx, y, 0.1)), normal: worldN(c) };
}

/** Kitchen counter run with marble top, brass rail and cupboards. */
export function counter(c: ModuleCtx, x0: number, w: number, opt: { stove?: boolean; fuse?: boolean }) {
  const k = c.kit, f = c.f, cx = x0 + w / 2;
  slab(c, x0, x0 + w, 0, c.st.H);
  wainscot(c, x0, x0 + w);
  paper(c, x0, x0 + w);
  const D = 0.65;
  k.box("cabinetCream", v(cx, 0.45, D / 2), v(w, 0.9, D), { collide: true }, f);
  k.box("marbleCream", v(cx, 0.92, D / 2 + 0.02), v(w + 0.02, 0.05, D + 0.05), {}, f);
  k.box("brass", v(cx, 0.8, D + 0.04), v(w - 0.1, 0.025, 0.025), { shadow: false }, f);
  const n = Math.max(1, Math.round(w / 0.6));
  for (let i = 0; i < n; i++) {
    const dx = x0 + (i + 0.5) * (w / n);
    k.box("cabinetLine", v(dx - w / n / 2 + 0.01, 0.45, D + 0.002), v(0.012, 0.8, 0.004), { shadow: false }, f);
    k.box("brass", v(dx, 0.62, D + 0.012), v(0.1, 0.015, 0.015), { shadow: false }, f);
  }
  if (opt.stove) {
    const sw = Math.min(1.6, w - 0.4);
    k.box("lacquer", v(cx, 0.48, D / 2 + 0.02), v(sw, 0.96, D + 0.04), { collide: true }, f);
    k.box("brass", v(cx, 0.97, D / 2 + 0.02), v(sw + 0.04, 0.03, D + 0.06), {}, f);
    for (const dx of [-0.4, 0, 0.4]) k.box("lacquer", v(cx + dx, 0.6, D + 0.045), v(0.36, 0.42, 0.01), {}, f);
    for (const dx of [-0.3, 0.3]) k.cyl("emberGlow", v(cx + dx, 0.995, D / 2), 0.01, 0.22, { shadow: false }, f);
    k.box("brass", v(cx, 2.3, 0.35), v(sw + 0.2, 0.05, 0.7), {}, f);
    k.box("cabinetCream", v(cx, 2.65, 0.25), v(sw, 0.7, 0.5), {}, f);
    c.anchors.stove = { pos: Kit.toWorld(f, v(cx, 1.0, D + 0.3)), normal: worldN(c) };
  } else {
    k.box("cabinetCream", v(cx, 2.1, 0.2), v(w, 0.8, 0.38), {}, f);
    k.box("brass", v(cx, 1.68, 0.4), v(w - 0.1, 0.02, 0.02), { shadow: false }, f);
  }
  if (opt.fuse) {
    k.box("lacquer", v(x0 + w - 0.35, 1.7, 0.06), v(0.4, 0.55, 0.12), {}, f);
    k.box("brass", v(x0 + w - 0.35, 1.7, 0.125), v(0.3, 0.45, 0.01), { shadow: false }, f);
    c.anchors.fusebox = { pos: Kit.toWorld(f, v(x0 + w - 0.35, 1.7, 0.4)), normal: worldN(c) };
  }
}

/** Stone balustrade (balcony edge, no wall above). */
export function balustrade(c: ModuleCtx, x0: number, w: number) {
  const k = c.kit, f = c.f, cx = x0 + w / 2;
  k.box("stone", v(cx, 0.08, -0.1), v(w, 0.16, 0.4), { collide: true }, f);
  k.box("stone", v(cx, 1.02, -0.1), v(w, 0.12, 0.42), {}, f);
  // invisible-height collider so nobody tumbles into the garden
  c.kit.colliders.push({ center: Kit.toWorld(f, v(cx, 1.2, -0.1)), size: new Vector3(w, 2.4, 0.4), rotY: f.rotY });
  for (let x = x0 + 0.15; x < x0 + w - 0.05; x += 0.22) {
    const b = MeshBuilder.CreateCylinder("bal", { height: 0.8, diameterTop: 0.09, diameterBottom: 0.13, tessellation: 10 }, k.scene);
    k.add("stone", b, v(x, 0.56, -0.1), {}, f);
  }
}

export function stage(c: ModuleCtx, x0: number, w: number) {
  const k = c.kit, f = c.f, st = c.st, cx = x0 + w / 2;
  const SH = 0.9, SD = 4.6;
  const px0 = x0 + 2, px1 = x0 + w - 2, pTop = 6.5;
  slab(c, x0, x0 + w, 0, st.H);
  wainscot(c, x0, px0 - 0.5);
  wainscot(c, px1 + 0.5, x0 + w);
  paper(c, x0, px0 - 0.5);
  paper(c, px1 + 0.5, x0 + w);
  paper(c, px0 - 0.5, px1 + 0.5, pTop + 0.5, st.cornice);
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
  for (const s of [-1, 1]) {
    const tx = s < 0 ? px0 - 0.25 : px1 + 0.25;
    k.box("goldSolid", v(tx, pTop / 2, 0.25), v(0.5, pTop, 0.5), { collide: true }, f);
    k.box("marbleBlack", v(tx, pTop / 2, 0.36), v(0.3, pTop - 1.2, 0.5), {}, f);
    k.box("goldSolid", v(tx, pTop + 0.25, 0.3), v(0.7, 0.5, 0.6), {}, f);
    k.box("goldSolid", v(tx, pTop + 0.6, 0.25), v(0.45, 0.25, 0.5), {}, f);
  }
  k.box("goldSolid", v(cx, pTop + 0.12, 0.3), v(px1 - px0, 0.24, 0.5), {}, f);
  k.box("marbleBlack", v(cx, pTop + 0.36, 0.25), v(px1 - px0, 0.24, 0.42), {}, f);
  k.add("velvet", drape(k.scene, 2.3, pTop - SH - 0.1, 11, 0.12, 2.1, -1), v(px0 + 1.15, SH, 0.45), {}, f);
  k.add("velvet", drape(k.scene, 2.3, pTop - SH - 0.1, 11, 0.12, 2.1, 1), v(px1 - 1.15, SH, 0.45), {}, f);
  k.add("velvet", drape(k.scene, px1 - px0, 0.9, 30, 0.1, -10, 0), v(cx, pTop - 0.85, 0.55), {}, f);
  k.box("goldSolid", v(cx, pTop - 0.86, 0.6), v(px1 - px0, 0.04, 0.04), { shadow: false }, f);
  k.box("marbleBlack", v(cx, SH / 2, SD / 2), v(px1 - px0 + 1.4, SH, SD), { collide: true }, f);
  k.box("parquet", v(cx, SH + 0.01, SD / 2 - 0.04), v(px1 - px0 + 1.3, 0.02, SD - 0.12), { tile: 2.2 }, f);
  for (const y of [0.3, 0.62]) k.box("goldSolid", v(cx, y, SD + 0.005), v(px1 - px0 + 1.4, 0.04, 0.02), { shadow: false }, f);
  k.box("goldSolid", v(cx, SH - 0.02, SD - 0.02), v(px1 - px0 + 1.42, 0.06, 0.08), {}, f);
  k.box("marbleBlack", v(cx, 0.15, SD + 0.45), v(4.4, 0.3, 0.9), { collide: true }, f);
  k.box("marbleBlack", v(cx, 0.45, SD + 0.22), v(4.4, 0.3, 0.45), { collide: true }, f);
  k.box("goldSolid", v(cx, 0.305, SD + 0.9), v(4.4, 0.02, 0.03), { shadow: false }, f);
  k.box("goldSolid", v(cx, 0.605, SD + 0.45), v(4.4, 0.02, 0.03), { shadow: false }, f);
  for (let i = 0; i < 11; i++) {
    const fx = px0 + 0.4 + (i / 10) * (px1 - px0 - 0.8);
    if (Math.abs(fx - cx) < 2.3) continue;
    const s = MeshBuilder.CreateSphere("fl", { diameter: 0.14, segments: 8, slice: 0.5 }, k.scene);
    k.add("lampGlow", s, v(fx, SH, SD - 0.15), { shadow: false }, f);
    if (i % 3 === 0) c.lights.push({ pos: Kit.toWorld(f, v(fx, SH + 0.3, SD - 0.4)), kind: "foot" });
  }
  for (const t of [0.2, 0.5, 0.8]) c.lights.push({ pos: Kit.toWorld(f, v(px0 + (px1 - px0) * t, SH + 0.5, 1.6)), kind: "foot" });
  k.cyl("goldSolid", v(cx, SH + 0.01, 3.2), 0.02, 0.35, { tess: 20 }, f);
  k.cyl("goldSolid", v(cx, SH + 0.75, 3.2), 1.5, 0.025, { tess: 8, shadow: false }, f);
  k.box("goldSolid", v(cx, SH + 1.55, 3.2), v(0.08, 0.14, 0.05), {}, f);
  c.anchors.microphone = { pos: Kit.toWorld(f, v(cx, SH + 1.3, 3.4)), normal: worldN(c) };
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
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    k.box("goldSolid", v(cx + Math.sin(a) * (cr + 0.42), ccy + Math.cos(a) * (cr + 0.42), cz - 0.12), v(0.05, 0.55, 0.03), { rotZ: -a, shadow: false }, f);
  }
  c.clock = { center: Kit.toWorld(f, v(cx, ccy, cz + 0.05)), normal: worldN(c), radius: cr };
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
      path.push(new Vector3(x, y, z));
    }
    paths.push(path);
  }
  return MeshBuilder.CreateRibbon("drape", { pathArray: paths, sideOrientation: Mesh.DOUBLESIDE }, scene);
}
