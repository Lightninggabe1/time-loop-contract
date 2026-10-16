// Builds dressed, rigged NPCs from the CC0 Quaternius Universal Base Characters.
//
// How clothes are made (no clipping, crisp details):
//  1. Paint: every texel of a new per-NPC texture set is rasterised in UV
//     space, mapped back to its 3D bind-pose position, and an outfit "painter"
//     decides what it is (skin → original texture, or fabric with colour,
//     roughness, metal, piping, buttons, stripes…). Lines are crisp at texture
//     resolution, independent of mesh density.
//  2. Shape: cloth vertices are Taubin-smoothed (removing muscle relief) and
//     inflated; fabric inherits the body's skin weights, so it moves exactly
//     with the body.
//  3. Parts: skirts, fringe, bow ties, hats, pearls, tails are generated
//     geometry skinned to the same rig.
//
// Input : assets-src/characters/{base,hair}, src/content/cast.json
// Output: public/assets/characters/npc/<id>.gltf + <id>.bin + tex/<id>_*.webp
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRMaterialsClearcoat, KHRMaterialsSheen } from "@gltf-transform/extensions";
import { prune, dedup, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "assets-src/characters");
const OUT = join(ROOT, "public/assets/characters/npc");
const TEX = 1024;
const only = process.argv.slice(2);
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
const cast = JSON.parse(await readFile(join(ROOT, "src/content/cast.json"), "utf8")).looks;

// ---------------------------------------------------------------- colour helpers (sRGB 0..255 for textures)
const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lin = (c) => c.map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const shade = (c, k) => c.map((v) => Math.max(0, Math.min(255, v * k)));
const frac = (x) => x - Math.floor(x);
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
function hash3(x, y, z) {
  const h = Math.imul((x * 73856093) ^ (y * 19349663) ^ (z * 83492791), 2654435761);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967295;
}

// ---------------------------------------------------------------- regions
const GROUP = (name) => {
  if (/^Head/.test(name)) return "head";
  if (/^neck/.test(name)) return "neck";
  if (name === "pelvis") return "pelvis";
  if (/^(spine|clavicle)/.test(name)) return "torso";
  if (/^upperarm/.test(name)) return "uarm";
  if (/^lowerarm/.test(name)) return "larm";
  if (/^(hand|index|middle|pinky|ring|thumb)/.test(name)) return "hand";
  if (/^thigh/.test(name)) return "thigh";
  if (/^calf/.test(name)) return "calf";
  if (/^(foot|ball)/.test(name)) return "foot";
  return "torso";
};

// body landmarks (bind pose, metres, +z front, +x = character's left)
const BODY = {
  male: { H: 1.81, neck: 1.545, wrist: 0.655, waist: 1.04, hip: 0.93 },
  female: { H: 1.77, neck: 1.5, wrist: 0.6, waist: 1.03, hip: 0.92 },
};

/**
 * Outfit painters. paint(p, n, g) → null for skin, "hide" for hidden, or a
 * fabric { c: sRGB[3], r: roughness, m: metal, k: cloth key (thickness) }.
 */
function painter(look) {
  const B = BODY[look.body];
  const C = Object.fromEntries(Object.entries(look.colors).map(([k, v]) => [k, hex(v)]));
  const o = look.outfit;
  const WHITE = hex("#F2EEE6"), BLACK = hex("#101012"), SATIN = hex("#0A0A0C"), GOLD = hex("#E2B25C");
  const shoes = { c: hex("#0B0A0A"), r: 0.16, m: 0, k: "shoes" };

  if (look.body === "male") {
    const open = ["tuxedo", "dinnerjacket", "smoking", "lounge", "tails", "waiter"].includes(o);
    const jacketHem = o === "waiter" ? 1.0 : o === "doorman" ? 0.62 : B.hip;
    const jacketC = C.jacket;
    const lapelC = o === "dinnerjacket" || o === "lounge" ? shade(C.jacket, 0.92) : SATIN;
    const trouserC = o === "lounge" ? shade(C.jacket, 0.95) : o === "doorman" ? hex("#16121A") : BLACK;
    const wool = (c, extra = 0) => ({ c, r: 0.74 - extra, m: 0, k: "jacket" });
    const stripe = (x) => o === "lounge" && frac(x * 70) < 0.05;
    return (p, n, g) => {
      const [x, y, z] = p;
      const ax = Math.abs(x);
      if (g === "head") return null;
      if (g === "hand") return null;
      if (g === "neck") {
        if (y > B.neck + 0.035) return null;
        if (o === "chef") return { c: hex("#B3262E"), r: 0.55, m: 0, k: "shirt" }; // neckerchief
        if (o === "doorman") return y > B.neck + 0.02 ? { c: GOLD, r: 0.3, m: 1, k: "jacket" } : wool(jacketC);
        return { c: WHITE, r: 0.45, m: 0, k: "shirt" }; // collar
      }
      if (g === "foot") return shoes;
      const legs = g === "thigh" || g === "calf" || (g === "pelvis" && y < jacketHem);
      if (legs && !(o === "doorman" && y > jacketHem)) {
        if (o === "chef") {
          const check = (Math.floor(x * 55) + Math.floor(y * 55)) & 1;
          return { c: check ? hex("#1E1E22") : hex("#D8D6D0"), r: 0.7, m: 0, k: "trousers" };
        }
        const outer = n[0] * Math.sign(x || 1) > 0.86 && ["tuxedo", "tails", "smoking", "dinnerjacket"].includes(o);
        if (outer) return { c: SATIN, r: 0.28, m: 0, k: "trousers" };
        return { c: stripe(x + 0.007) ? shade(trouserC, 1.35) : trouserC, r: 0.75, m: 0, k: "trousers" };
      }
      if (g === "uarm" || g === "larm") {
        if (ax > B.wrist - 0.022) {
          if (o === "doorman") return { c: GOLD, r: 0.3, m: 1, k: "jacket" };
          if (o === "smoking") return { c: SATIN, r: 0.28, m: 0, k: "jacket" };
          if (ax > B.wrist - 0.006) return { c: WHITE, r: 0.5, m: 0, k: "shirt" }; // shirt cuff
        }
        if (o === "doorman" && Math.abs(ax - (B.wrist - 0.06)) < 0.006) return { c: GOLD, r: 0.3, m: 1, k: "jacket" };
        return wool(stripe(x) ? shade(jacketC, 1.35) : jacketC, o === "smoking" ? 0.1 : 0);
      }
      // torso front details
      if (z > 0.0) {
        if (open && y > B.waist - 0.04 && y < B.neck) {
          const t = Math.min(1, Math.max(0, (y - (B.waist - 0.02)) / (B.neck - B.waist)));
          const half = 0.014 + Math.pow(t, 1.15) * 0.105;
          if (ax < half) {
            if (o === "lounge" && ax < 0.016 && y < B.neck - 0.01) return { c: C.accent, r: 0.35, m: 0, k: "jacket" }; // necktie
            if (o === "tails" && y < B.waist + 0.22) return { c: WHITE, r: 0.6, m: 0, k: "jacket" }; // white waistcoat
            const stud = ax < 0.006 && frac((y - B.waist) * 14) < 0.12 && o !== "lounge";
            return { c: stud ? BLACK : WHITE, r: stud ? 0.2 : 0.5, m: 0, k: "jacket" };
          }
          const lapelW = 0.05;
          if (ax < half + lapelW && y > B.waist + 0.06) {
            if (Math.abs(ax - (half + lapelW)) < 0.003) return { c: shade(lapelC, 0.55), r: 0.4, m: 0, k: "jacket" };
            if (Math.abs(ax - half) < 0.0025) return { c: shade(lapelC, 0.7), r: 0.3, m: 0, k: "jacket" }; // inner lapel edge
            return { c: lapelC, r: 0.3, m: 0, k: "jacket" };
          }
          if (["tuxedo", "dinnerjacket", "lounge"].includes(o) && x > 0.075 && x < 0.135 && y > 1.33 && y < 1.33 + (x - 0.075) * 0.5) return { c: o === "lounge" ? C.accent : WHITE, r: 0.45, m: 0, k: "lapel" };
          if (look.id === "ashcombe" && Math.hypot(x - 0.115, y - 1.42) < 0.014) return { c: hex("#B3262E"), r: 0.5, m: 0, k: "lapel" };
          if (Math.hypot(ax, y - (B.waist + 0.02)) < 0.009 && o !== "waiter") return { c: o === "dinnerjacket" ? BLACK : SATIN, r: 0.2, m: 0, k: "jacket" };
        }
        if (o === "chef") {
          for (const by of [1.1, 1.19, 1.28, 1.37]) for (const bx of [-0.055, 0.055]) if (Math.hypot(x - bx, y - by) < 0.01) return { c: WHITE, r: 0.25, m: 0, k: "jacket" };
          if (Math.abs(x - 0.03) < 0.003 && y > 1.0) return { c: shade(jacketC, 0.85), r: 0.6, m: 0, k: "jacket" };
        }
        if (o === "doorman") {
          for (const by of [1.12, 1.2, 1.28, 1.36]) {
            if (Math.abs(y - by) < 0.006 && ax < 0.09) return { c: GOLD, r: 0.3, m: 1, k: "jacket" };
            if (Math.hypot(ax - 0.09, y - by) < 0.011) return { c: GOLD, r: 0.25, m: 1, k: "jacket" };
          }
          if (ax < 0.004 && y < 1.4) return { c: shade(jacketC, 0.7), r: 0.6, m: 0, k: "jacket" };
        }
      }
      if (o === "doorman" && g === "torso" && y > 1.45 && ax > 0.14) return { c: GOLD, r: 0.3, m: 1, k: "jacket" };
      if (g === "torso" && y > 1.46 && Math.abs(ax - 0.17) < 0.003 && o !== "chef") return { c: shade(jacketC, 0.8), r: 0.7, m: 0, k: "jacket" };
      if (g === "pelvis" && Math.abs(y - (B.waist - 0.05)) < 0.004 && z > 0 && ax > 0.06) return { c: shade(jacketC, 0.6), r: 0.7, m: 0, k: "jacket" };
      return wool(stripe(x) ? shade(jacketC, 1.35) : jacketC, o === "smoking" ? 0.1 : 0);
    };
  }

  // ---- female
  const hemY = { floor: 0.0, calf: 0.32 }[look.length ?? "floor"];
  const dressC = C.dress, trimC = C.trim;
  const gloves = o !== "maid" && C.gloves ? { c: C.gloves, r: 0.38, m: 0, k: "gloves" } : null;
  const flap = o === "flapper", maid = o === "maid";
  const topY = maid ? 9 : flap ? 1.41 : 1.37;
  return (p, n, g) => {
    const [x, y, z] = p;
    const ax = Math.abs(x);
    if (g === "head") return null;
    if (g === "hand") return gloves ?? null;
    if (g === "larm" || g === "uarm") {
      if (maid) return ax > B.wrist - 0.035 ? { c: trimC, r: 0.6, m: 0, k: "shirt" } : { c: dressC, r: 0.7, m: 0, k: "dress" };
      if (gloves && ax > 0.27) return ax < 0.285 ? { c: shade(C.gloves, 0.85), r: 0.4, m: 0, k: "gloves" } : gloves;
      return null;
    }
    if (g === "neck") return maid && y < B.neck + 0.03 ? { c: trimC, r: 0.55, m: 0, k: "shirt" } : null;
    if (g === "foot") return hemY < 0.05 ? "hide" : { c: hex("#121012"), r: 0.2, m: 0, k: "shoes" };
    if (g === "calf") return y < hemY + 0.04 ? { c: hex("#5A4036"), r: 0.32, m: 0, k: "stocking" } : "hide";
    if (g === "thigh" || (g === "pelvis" && y < B.hip + 0.05)) return "hide";
    if (y > topY) return flap && ax > 0.05 && ax < 0.075 ? { c: trimC, r: 0.25, m: 1, k: "dress" } : null;
    if (maid) {
      if (z > 0.02 && ax < 0.085 && y > 1.1 && y < 1.4) return { c: trimC, r: 0.6, m: 0, k: "apron" };
      if (z > 0.02 && Math.abs(ax - 0.085) < 0.004 && y > 1.1 && y < 1.4) return { c: shade(trimC, 0.8), r: 0.6, m: 0, k: "apron" };
      return { c: dressC, r: 0.7, m: 0, k: "dress" };
    }
    if (Math.abs(y - topY) < 0.012) return { c: trimC, r: 0.25, m: 1, k: "dress" };
    if (flap) {
      const band = frac(y * 11 + 0.3) < 0.09;
      const sp = hash3(Math.floor(x * 400), Math.floor(y * 400), Math.floor(z * 400));
      return { c: band ? trimC : sp > 0.93 ? shade(dressC, 1.35) : dressC, r: band ? 0.22 : 0.3, m: band ? 1 : 0.6, k: "dress" };
    }
    if (Math.abs(ax - 0.07) < 0.003 && z > 0) return { c: shade(dressC, 0.75), r: 0.4, m: 0, k: "dress" };
    const sp = hash3(Math.floor(x * 300), Math.floor(y * 300), Math.floor(z * 300));
    return { c: sp > 0.97 ? mixc(dressC, trimC, 0.6) : dressC, r: 0.4, m: sp > 0.97 ? 0.8 : 0, k: "dress" };
  };
}

const THICK = { jacket: 0.02, lapel: 0.024, shirt: 0.009, trousers: 0.014, shoes: 0.008, dress: 0.012, apron: 0.02, gloves: 0.004, stocking: 0.001 };
const SMOOTH = { jacket: 1, lapel: 1, shirt: 0.6, trousers: 1, shoes: 0.8, dress: 0.6, apron: 0.6, gloves: 0.15, stocking: 0 };

// ---------------------------------------------------------------- geometry helpers
function weld(P) {
  const map = new Map(), canon = new Int32Array(P.length / 3);
  let n = 0;
  for (let i = 0; i < P.length / 3; i++) {
    const k = `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`;
    let c = map.get(k);
    if (c === undefined) map.set(k, (c = n++));
    canon[i] = c;
  }
  return { canon, count: n };
}
function computeNormals(P, I, canon, count) {
  const nv = P.length / 3, cnt = canon ? count : nv;
  const acc = new Float32Array(cnt * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      const k = canon ? canon[v] : v;
      acc[k * 3] += nx;
      acc[k * 3 + 1] += ny;
      acc[k * 3 + 2] += nz;
    }
  }
  const N = new Float32Array(P.length);
  for (let i = 0; i < nv; i++) {
    const k = canon ? canon[i] : i;
    const l = Math.hypot(acc[k * 3], acc[k * 3 + 1], acc[k * 3 + 2]) || 1;
    for (let a = 0; a < 3; a++) N[i * 3 + a] = acc[k * 3 + a] / l;
  }
  return N;
}

class Part {
  constructor() {
    Object.assign(this, { P: [], UV: [], J: [], W: [], I: [] });
  }
  get size() {
    return this.P.length / 3;
  }
  v(p, uv, joints, weights) {
    this.P.push(...p);
    this.UV.push(...uv);
    const j = [0, 0, 0, 0], w = [0, 0, 0, 0];
    joints.forEach((x, i) => ((j[i] = x), (w[i] = Math.max(0, weights[i]))));
    const s = w.reduce((a, b) => a + b, 0) || 1;
    this.J.push(...j);
    this.W.push(...w.map((x) => x / s));
    return this.size - 1;
  }
  /** a,b,c,d counter-clockwise as seen from the outside */
  quad(a, b, c, d) {
    this.I.push(a, b, c, a, c, d);
  }
  /** Tube through rings (around Y, or X with axis:"x"); faces outward. arc=[from,to] radians for open tubes. */
  tube(rings, seg = 28, cap = false, arc = [0, Math.PI * 2]) {
    const base = this.size;
    rings.forEach((r, i) => {
      for (let s = 0; s <= seg; s++) {
        const th = arc[0] + (s / seg) * (arc[1] - arc[0]);
        const w = r.wobble ? r.wobble(th) : 0;
        const p = r.axis === "x"
          ? [r.c[0], r.c[1] + Math.sin(th) * (r.ry + w), r.c[2] + Math.cos(th) * (r.rz + w)]
          : [r.c[0] + Math.sin(th) * (r.rx + w), r.c[1], r.c[2] + Math.cos(th) * (r.rz + w)];
        this.v(p, [s / seg, i / Math.max(1, rings.length - 1)], ...r.skin(th, i));
      }
    });
    // orientation is fixed up afterwards by orientOutward()
    for (let i = 0; i < rings.length - 1; i++)
      for (let s = 0; s < seg; s++) {
        const a = base + i * (seg + 1) + s;
        this.quad(a, a + 1, a + seg + 2, a + seg + 1);
      }
    if (cap) {
      const last = rings[rings.length - 1];
      const ci = this.v(last.c, [0.5, 1], ...last.skin(0, rings.length - 1));
      const off = base + (rings.length - 1) * (seg + 1);
      for (let s = 0; s < seg; s++) this.I.push(ci, off + s, off + s + 1);
    }
    this.orientOutward(base, rings.map((r) => r.c));
  }
  /** Flip triangles (from vertex `base` on) whose normal points toward the axis. */
  orientOutward(base, centres) {
    const cy = centres.reduce((s, c) => s + c[1], 0) / centres.length;
    const cx = centres.reduce((s, c) => s + c[0], 0) / centres.length;
    const cz = centres.reduce((s, c) => s + c[2], 0) / centres.length;
    for (let t = 0; t < this.I.length; t += 3) {
      const [a, b, c] = [this.I[t], this.I[t + 1], this.I[t + 2]];
      if (a < base) continue;
      const p = (i) => [this.P[i * 3], this.P[i * 3 + 1], this.P[i * 3 + 2]];
      const A = p(a), Bp = p(b), Cp = p(c);
      const u = [Bp[0] - A[0], Bp[1] - A[1], Bp[2] - A[2]], v = [Cp[0] - A[0], Cp[1] - A[1], Cp[2] - A[2]];
      const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const m = [(A[0] + Bp[0] + Cp[0]) / 3 - cx, (A[1] + Bp[1] + Cp[1]) / 3 - cy, (A[2] + Bp[2] + Cp[2]) / 3 - cz];
      if (nrm[0] * m[0] + nrm[1] * m[1] + nrm[2] * m[2] < 0) [this.I[t + 1], this.I[t + 2]] = [c, b];
    }
  }
  blob(c, r, joints, weights, seg = 8) {
    const base = this.size;
    for (let a = 0; a <= seg; a++) {
      const phi = (a / seg) * Math.PI;
      for (let b = 0; b <= seg; b++) {
        const th = (b / seg) * Math.PI * 2;
        this.v([c[0] + r[0] * Math.sin(phi) * Math.sin(th), c[1] + r[1] * Math.cos(phi), c[2] + r[2] * Math.sin(phi) * Math.cos(th)], [b / seg, a / seg], joints, weights);
      }
    }
    for (let a = 0; a < seg; a++)
      for (let b = 0; b < seg; b++) {
        const i0 = base + a * (seg + 1) + b;
        this.quad(i0, i0 + 1, i0 + seg + 2, i0 + seg + 1);
      }
    this.orientOutward(base, [c]);
  }
}

// ---------------------------------------------------------------- texture IO
const texCache = new Map();
async function loadRaw(file, channels = 3) {
  const key = `${file}:${channels}`;
  if (!texCache.has(key)) {
    let img = sharp(join(SRC, "base", file)).removeAlpha();
    img = channels === 1 ? img.toColourspace("b-w") : img.toColourspace("srgb");
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    texCache.set(key, { data, w: info.width, h: info.height, ch: info.channels });
  }
  return texCache.get(key);
}
function sample(t, u, v) {
  const x = Math.min(t.w - 1, Math.max(0, u * t.w - 0.5)), y = Math.min(t.h - 1, Math.max(0, v * t.h - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(t.w - 1, x0 + 1), y1 = Math.min(t.h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0, out = [];
  for (let c = 0; c < t.ch; c++) {
    const g = (xx, yy) => t.data[(yy * t.w + xx) * t.ch + c];
    out.push((g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy);
  }
  return out;
}

// ---------------------------------------------------------------- build one NPC
async function build(look) {
  const male = look.body === "male";
  const B = BODY[look.body];
  const o = look.outfit;
  const body = male ? "Superhero_Male_FullBody" : "Superhero_Female_FullBody";
  const doc = await io.read(join(SRC, "base", `${body}.gltf`));
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const jointNames = skin.listJoints().map((j) => j.getName());
  const JI = (n) => {
    const i = jointNames.indexOf(n);
    if (i < 0) throw new Error(`joint ${n}`);
    return i;
  };
  const bodyMesh = root.listMeshes().find((m) => m.listPrimitives()[0].getAttribute("POSITION").getCount() > 5000);
  const bodyNode = root.listNodes().find((n) => n.getMesh() === bodyMesh);
  const prim = bodyMesh.listPrimitives()[0];
  const P0 = prim.getAttribute("POSITION").getArray().slice();
  const N0 = prim.getAttribute("NORMAL").getArray().slice();
  const UV = prim.getAttribute("TEXCOORD_0").getArray();
  const J = prim.getAttribute("JOINTS_0").getArray();
  const W = prim.getAttribute("WEIGHTS_0").getArray();
  const I0 = prim.getIndices().getArray();
  const nV = P0.length / 3;
  const dom = new Array(nV);
  for (let i = 0; i < nV; i++) {
    let b = 0;
    for (let k = 1; k < 4; k++) if (W[i * 4 + k] > W[i * 4 + b]) b = k;
    dom[i] = GROUP(jointNames[J[i * 4 + b]]);
  }
  const paint = painter(look);
  const vpaint = Array.from({ length: nV }, (_, i) => paint([P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]], [N0[i * 3], N0[i * 3 + 1], N0[i * 3 + 2]], dom[i]));

  // -------- 1. bake textures
  const toneFile = { "male:Dark": "T_Superhero_Male_Dark", "male:Light": "T_Superhero_Male_Ligh", "female:Dark": "T_Superhero_Female_Dark_BaseColor", "female:Light": "T_Superhero_Female_Light_BaseColor" }[`${look.body}:${look.skin}`];
  const sAlb = await loadRaw(`${toneFile}.png`, 3);
  const sNor = await loadRaw(`T_Superhero_${male ? "Male" : "Female"}_Normal.png`, 3);
  const sRgh = await loadRaw(`T_Superhero_${male ? "Male" : "Female"}_Roughness.png`, 1);
  const alb = Buffer.alloc(TEX * TEX * 3), nor = Buffer.alloc(TEX * TEX * 3), arm = Buffer.alloc(TEX * TEX * 3);
  const filled = new Uint8Array(TEX * TEX);
  for (let t = 0; t < I0.length; t += 3) {
    const vs = [I0[t], I0[t + 1], I0[t + 2]];
    const uv = vs.map((v) => [UV[v * 2] * TEX, UV[v * 2 + 1] * TEX]);
    const minx = Math.max(0, Math.floor(Math.min(...uv.map((q) => q[0])) - 1)), maxx = Math.min(TEX - 1, Math.ceil(Math.max(...uv.map((q) => q[0])) + 1));
    const miny = Math.max(0, Math.floor(Math.min(...uv.map((q) => q[1])) - 1)), maxy = Math.min(TEX - 1, Math.ceil(Math.max(...uv.map((q) => q[1])) + 1));
    const [a, b, c] = uv;
    const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(den) < 1e-12) continue;
    for (let py = miny; py <= maxy; py++)
      for (let px = minx; px <= maxx; px++) {
        const X = px + 0.5, Y = py + 0.5;
        const w0 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / den;
        const w1 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
        const idx = py * TEX + px;
        const ws = [w0, w1, w2];
        const p = [0, 1, 2].map((k) => ws[0] * P0[vs[0] * 3 + k] + ws[1] * P0[vs[1] * 3 + k] + ws[2] * P0[vs[2] * 3 + k]);
        const n = [0, 1, 2].map((k) => ws[0] * N0[vs[0] * 3 + k] + ws[1] * N0[vs[1] * 3 + k] + ws[2] * N0[vs[2] * 3 + k]);
        const g = dom[vs[ws.indexOf(Math.max(...ws))]];
        const f = paint(p, n, g);
        const u = X / TEX, v = Y / TEX;
        if (!f || f === "hide") {
          alb.set(sample(sAlb, u, v).map(Math.round), idx * 3);
          nor.set(sample(sNor, u, v).map(Math.round), idx * 3);
          arm.set([255, Math.round(sample(sRgh, u, v)[0]), 0], idx * 3);
        } else {
          const s = sample(sAlb, u, v);
          const lum = (s[0] * 0.3 + s[1] * 0.59 + s[2] * 0.11) / 255;
          const ao = 0.85 + 0.15 * Math.min(1, lum * 1.6); // keep a hint of the sculpt's creases as AO
          const weave = (hash3(px, py, 7) - 0.5) * 9 * (f.m ? 0.3 : 1);
          alb.set(f.c.map((ch) => Math.max(0, Math.min(255, Math.round(ch * ao + weave)))), idx * 3);
          nor.set([128 + Math.round((hash3(px, py, 1) - 0.5) * 12), 128 + Math.round((hash3(px, py, 2) - 0.5) * 12), 252], idx * 3);
          arm.set([255, Math.round(Math.min(1, Math.max(0.04, f.r)) * 255), Math.round(f.m * 255)], idx * 3);
        }
        filled[idx] = 1;
      }
  }
  for (let pass = 0; pass < 6; pass++) {
    const nf = filled.slice();
    for (let y = 0; y < TEX; y++)
      for (let x = 0; x < TEX; x++) {
        const i = y * TEX + x;
        if (filled[i]) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= TEX || yy >= TEX) continue;
          const j = yy * TEX + xx;
          if (!filled[j]) continue;
          for (const buf of [alb, nor, arm]) buf.copy(buf, i * 3, j * 3, j * 3 + 3);
          nf[i] = 1;
          break;
        }
      }
    filled.set(nf);
  }
  await mkdir(join(OUT, "tex"), { recursive: true });
  const raw = { raw: { width: TEX, height: TEX, channels: 3 } };
  const imgs = {
    alb: await sharp(alb, raw).webp({ quality: 90 }).toBuffer(),
    nor: await sharp(nor, raw).webp({ quality: 92 }).toBuffer(),
    arm: await sharp(arm, raw).webp({ quality: 90 }).toBuffer(),
  };

  // -------- 2a. reshape: slim heroic limbs and fill the V-taper into a tailored silhouette
  const R = male ? { uarm: 0.8, larm: 0.86, thigh: 0.86, calf: 0.9, neck: 0.92 } : { uarm: 0.84, larm: 0.9, thigh: 0.92, calf: 0.94, neck: 0.95 };
  {
    const bins = new Map(); // key → [sum a, sum b, n]
    const keyOf = (i) => {
      const g = dom[i], x = P0[i * 3], y = P0[i * 3 + 1];
      if (g === "uarm" || g === "larm") return `${g}:${Math.sign(x)}:${Math.round(Math.abs(x) * 100)}`; // arms lie along x
      if (g === "thigh" || g === "calf" || g === "neck") return `${g}:${g === "neck" ? 0 : Math.sign(x)}:${Math.round(y * 100)}`; // legs along y
      return null;
    };
    const keys = new Array(nV);
    for (let i = 0; i < nV; i++) {
      const k = (keys[i] = keyOf(i));
      if (!k) continue;
      const g = dom[i];
      const along = g === "uarm" || g === "larm";
      const a = along ? P0[i * 3 + 1] : P0[i * 3], b = P0[i * 3 + 2];
      const e = bins.get(k) ?? [0, 0, 0];
      e[0] += a; e[1] += b; e[2]++;
      bins.set(k, e);
    }
    for (let i = 0; i < nV; i++) {
      const k = keys[i];
      if (!k) continue;
      const g = dom[i], [sa, sb, n] = bins.get(k);
      const ca = sa / n, cb = sb / n;
      const x = Math.abs(P0[i * 3]), y = P0[i * 3 + 1];
      let f = R[g];
      // blend back to 1 near joints that meet unreshaped parts (shoulder, wrist, hip)
      if (g === "uarm") f = 1 + (f - 1) * smooth(0.17, 0.26, x);
      if (g === "larm") f = 1 + (f - 1) * (1 - smooth(B.wrist - 0.07, B.wrist - 0.01, x));
      if (g === "thigh") f = 1 + (f - 1) * (1 - smooth(0.82, 0.95, y));
      if (g === "calf") f = 1 + (f - 1) * smooth(0.06, 0.14, y);
      if (g === "uarm" || g === "larm") {
        P0[i * 3 + 1] = ca + (P0[i * 3 + 1] - ca) * f;
        P0[i * 3 + 2] = cb + (P0[i * 3 + 2] - cb) * f;
      } else {
        P0[i * 3] = ca + (P0[i * 3] - ca) * f;
        P0[i * 3 + 2] = cb + (P0[i * 3 + 2] - cb) * f;
      }
    }
    if (male && !["chef"].includes(o)) {
      // tailored torso: raise the waist/abdomen cross-section toward the chest's
      const half = (y0, y1) => {
        let mx = 0, mzF = -1, mzB = 1;
        for (let i = 0; i < nV; i++) if ((dom[i] === "torso" || dom[i] === "pelvis") && P0[i * 3 + 1] > y0 && P0[i * 3 + 1] < y1) {
          mx = Math.max(mx, Math.abs(P0[i * 3]));
          mzF = Math.max(mzF, P0[i * 3 + 2]);
          mzB = Math.min(mzB, P0[i * 3 + 2]);
        }
        return { mx, mzF, mzB };
      };
      const chest = half(1.3, 1.36);
      for (let i = 0; i < nV; i++) {
        if (!(dom[i] === "torso" || dom[i] === "pelvis")) continue;
        const y = P0[i * 3 + 1];
        const k = smooth(0.9, 1.0, y) * (1 - smooth(1.28, 1.36, y)); // waist band
        if (k <= 0 || !vpaint[i] || vpaint[i] === "hide") continue;
        const x = P0[i * 3], z = P0[i * 3 + 2];
        const tx = chest.mx * 0.86 * Math.sign(x || 1);
        if (Math.abs(x) > 0.05) P0[i * 3] = x + (Math.abs(tx) > Math.abs(x) ? (tx - x) * 0.55 * k : 0);
        if (z > 0) P0[i * 3 + 2] = z + Math.max(0, chest.mzF * 0.9 - z) * 0.6 * k;
      }
    }
  }

  // -------- 2b. shape cloth: smooth + inflate (welded, seams with skin pinned)
  const { canon, count } = weld(P0);
  const cpos = new Float64Array(count * 3), touched = new Uint8Array(count), thick = new Float64Array(count), smoothK = new Float64Array(count), cn = new Float64Array(count);
  for (let i = 0; i < nV; i++) {
    const c = canon[i];
    for (let a = 0; a < 3; a++) cpos[c * 3 + a] = P0[i * 3 + a];
    const f = vpaint[i];
    if (!f || f === "hide") touched[c] |= 1;
    else {
      touched[c] |= 2;
      thick[c] += THICK[f.k] ?? 0.01;
      smoothK[c] += SMOOTH[f.k] ?? 0.5;
      cn[c]++;
    }
  }
  const nbr = Array.from({ length: count }, () => new Set());
  for (let t = 0; t < I0.length; t += 3) {
    const a = canon[I0[t]], b = canon[I0[t + 1]], c = canon[I0[t + 2]];
    nbr[a].add(b).add(c);
    nbr[b].add(a).add(c);
    nbr[c].add(a).add(b);
  }
  // smoothing only moves vertices along their normal: removes muscle relief
  // without sliding the surface under the painted texture (keeps lines straight)
  const cnorm = new Float64Array(count * 3);
  for (let i = 0; i < nV; i++) for (let a = 0; a < 3; a++) cnorm[canon[i] * 3 + a] += N0[i * 3 + a];
  for (let v = 0; v < count; v++) {
    const l = Math.hypot(cnorm[v * 3], cnorm[v * 3 + 1], cnorm[v * 3 + 2]) || 1;
    for (let a = 0; a < 3; a++) cnorm[v * 3 + a] /= l;
  }
  const step = (lambda) => {
    const next = cpos.slice();
    for (let v = 0; v < count; v++) {
      if (touched[v] !== 2 || !nbr[v].size) continue;
      const k = (smoothK[v] / cn[v]) * lambda;
      let sx = 0, sy = 0, sz = 0;
      for (const u of nbr[v]) (sx += cpos[u * 3]), (sy += cpos[u * 3 + 1]), (sz += cpos[u * 3 + 2]);
      const m = nbr[v].size;
      const dx = sx / m - cpos[v * 3], dy = sy / m - cpos[v * 3 + 1], dz = sz / m - cpos[v * 3 + 2];
      const dn = dx * cnorm[v * 3] + dy * cnorm[v * 3 + 1] + dz * cnorm[v * 3 + 2];
      next[v * 3] += k * dn * cnorm[v * 3];
      next[v * 3 + 1] += k * dn * cnorm[v * 3 + 1];
      next[v * 3 + 2] += k * dn * cnorm[v * 3 + 2];
    }
    cpos.set(next);
  };
  for (let it = 0; it < 40; it++) {
    step(0.55);
    step(-0.58);
  }
  const P = new Float32Array(P0.length);
  for (let i = 0; i < nV; i++) for (let a = 0; a < 3; a++) P[i * 3 + a] = cpos[canon[i] * 3 + a];
  let N = computeNormals(P, I0, canon, count);
  for (let i = 0; i < nV; i++) {
    const c = canon[i];
    if (!cn[c]) continue;
    let off = thick[c] / cn[c];
    if (touched[c] & 1) off *= 0.3;
    const y = P[i * 3 + 1];
    if (male && dom[i] === "pelvis" && y > 0.86) off += smooth(1.08, 0.9, y) * 0.028; // jacket skirt over hips
    if (male && (dom[i] === "calf" || dom[i] === "thigh")) off += smooth(0.6, 0.12, y) * 0.022; // straight trouser legs
    for (let a = 0; a < 3; a++) P[i * 3 + a] += N[i * 3 + a] * off;
  }
  const keep = [];
  for (let t = 0; t < I0.length; t += 3) if (![0, 1, 2].every((k) => vpaint[I0[t + k]] === "hide")) keep.push(I0[t], I0[t + 1], I0[t + 2]);
  const I = new I0.constructor(keep);
  N = computeNormals(P, I, canon, count);
  prim.getAttribute("POSITION").setArray(P);
  prim.getAttribute("NORMAL").setArray(N);
  prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(I));
  for (const k of ["COLOR_0", "COLOR_1", "TEXCOORD_1", "TEXCOORD_2", "TEXCOORD_3"]) if (prim.getAttribute(k)) prim.setAttribute(k, null);

  // -------- materials
  const ccExt = doc.createExtension(KHRMaterialsClearcoat);
  const sheenExt = doc.createExtension(KHRMaterialsSheen);
  const tex = (name, buf) => doc.createTexture(name).setImage(buf).setMimeType("image/webp").setURI(`tex/${look.id}_${name}.webp`);
  prim.setMaterial(
    doc.createMaterial(`${look.id}_body`).setBaseColorTexture(tex("albedo", imgs.alb)).setMetallicRoughnessTexture(tex("arm", imgs.arm)).setNormalTexture(tex("normal", imgs.nor)).setRoughnessFactor(1).setMetallicFactor(1),
  );
  const mats = {};
  const mk = (name, hx, rough, opts = {}) => {
    const m = doc.createMaterial(`${look.id}_${name}`).setBaseColorFactor([...lin(hex(hx)), 1]).setRoughnessFactor(rough).setMetallicFactor(opts.metal ?? 0);
    if (opts.clearcoat) m.setExtension("KHR_materials_clearcoat", ccExt.createClearcoat().setClearcoatFactor(opts.clearcoat).setClearcoatRoughnessFactor(0.06));
    if (opts.sheen) m.setExtension("KHR_materials_sheen", sheenExt.createSheen().setSheenColorFactor(lin(hex(opts.sheen))).setSheenRoughnessFactor(0.5));
    if (opts.double) m.setDoubleSided(true);
    return (mats[name] = m);
  };
  const C = look.colors;
  mk("bow", o === "tails" ? "#F2EEE6" : "#0C0C0E", 0.32, { sheen: "#40404A" });
  mk("white", "#F2EEE6", 0.55);
  mk("gold", "#E2B25C", 0.25, { metal: 1 });
  mk("cloth", "#" + shade(hex(C.jacket ?? C.dress), 0.9).map((v) => Math.round(v).toString(16).padStart(2, "0")).join(""), 0.72);
  mk("black", "#0B0A0B", 0.2, { clearcoat: 1 });
  if (!male) {
    const sheenHex = "#" + shade(hex(C.dress), 1.5).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
    mk("skirt", C.dress, o === "flapper" ? 0.38 : o === "maid" ? 0.7 : 0.42, { sheen: o === "maid" ? null : sheenHex, double: true, metal: o === "flapper" ? 0.25 : 0 });
    mk("trim", C.trim, o === "maid" ? 0.6 : 0.24, { metal: o === "maid" ? 0 : 1, double: true });
    mk("pearl", "#F3EEE4", 0.12, { clearcoat: 1 });
    mk("band", look.headband ?? "#121214", 0.3, { sheen: "#888888" });
    mk("feather", "#F4EFE6", 0.85, { double: true });
    mk("apron", C.trim, 0.6, { double: true });
  }

  // -------- 3. generated parts
  const parts = {};
  const part = (m) => (parts[m] ??= new Part());
  const slab = (pred) => {
    const pts = [];
    for (let i = 0; i < nV; i++) if (pred(i, P[i * 3], P[i * 3 + 1], P[i * 3 + 2])) pts.push([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    const c = [0, 1, 2].map((a) => pts.reduce((s, p) => s + p[a], 0) / Math.max(1, pts.length));
    const r = [0, 1, 2].map((a) => Math.max(0, ...pts.map((p) => Math.abs(p[a] - c[a]))));
    return { c, r, n: pts.length };
  };
  const one = (name) => [[JI(name)], [1]];
  const neck = slab((i, x, y) => dom[i] === "neck" && Math.abs(y - (B.neck + 0.02)) < 0.012);
  const headTop = slab((i, x, y) => dom[i] === "head" && y > B.H - 0.1 && y < B.H - 0.06);
  const nk = [[JI("neck_01"), JI("spine_03")], [0.55, 0.45]];

  if (male) {
    const fz = neck.c[2] + neck.r[2] + 0.012, by = B.neck + 0.005;
    if (["tuxedo", "dinnerjacket", "smoking", "tails", "waiter"].includes(o)) {
      for (const sg of [-1, 1]) part("bow").blob([sg * 0.029, by, fz], [0.026, 0.015, 0.008], ...nk);
      part("bow").blob([0, by, fz + 0.004], [0.009, 0.012, 0.009], ...nk);
    }
    // jacket skirt below the waist (front opening for open jackets)
    const skirtTo = { tuxedo: 0.79, dinnerjacket: 0.79, smoking: 0.8, lounge: 0.78, doorman: 0.6, chef: 0.84 }[o];
    if (skirtTo) {
      const top = B.waist - 0.03;
      const hipS = slab((i, x, y) => (dom[i] === "pelvis" || dom[i] === "thigh") && Math.abs(y - 0.86) < 0.02);
      const topS = slab((i, x, y) => (dom[i] === "pelvis" || dom[i] === "torso") && Math.abs(y - top) < 0.012);
      const rows = 5;
      const ring = (k) => {
        const t = k / rows, y = top - t * (top - skirtTo);
        const rx = topS.r[0] * (1 - t) + Math.max(topS.r[0], hipS.r[0]) * t + 0.002 + t * t * 0.03;
        const rz = topS.r[2] * (1 - t) + Math.max(topS.r[2], hipS.r[2]) * t + 0.003 + t * t * 0.025;
        return {
          c: [0, y, (topS.c[2] + hipS.c[2]) / 2], rx, rz,
          skin: (th) => {
            const sl = Math.max(0, Math.sin(th)), sr = Math.max(0, -Math.sin(th)), leg = t * 0.5;
            return [[JI("pelvis"), JI("thigh_l"), JI("thigh_r")], [1 - leg * (sl + sr) * 0.8, leg * sl * 0.8, leg * sr * 0.8]];
          },
        };
      };
      const openFront = o !== "doorman" && o !== "chef";
      part("cloth").tube(Array.from({ length: rows + 1 }, (_, k) => ring(k)), 40, false, openFront ? [0.1, Math.PI * 2 - 0.1] : [0, Math.PI * 2]);
      mats.cloth.setDoubleSided(true);
    }
    if (o === "tails") {
      for (const sg of [-1, 1]) {
        const T = part("cloth");
        const rows = 6, b0 = T.size;
        for (let r = 0; r <= rows; r++) {
          const t = r / rows, y = 0.97 - t * 0.43, z = -0.17 - t * 0.025;
          const jw = [[JI("pelvis"), JI(`thigh_${sg > 0 ? "l" : "r"}`)], [1 - t * 0.55, t * 0.55]];
          T.v([sg * (0.012 + t * 0.012), y, z], [0, t], ...jw);
          T.v([sg * (0.16 - t * 0.06), y, z + 0.02 * (1 - t)], [1, t], ...jw);
        }
        for (let r = 0; r < rows; r++) T.quad(b0 + r * 2, b0 + r * 2 + 1, b0 + r * 2 + 3, b0 + r * 2 + 2);
      }
      mats.cloth.setDoubleSided(true);
    }
    if (o === "chef") {
      const hc = [0, headTop.c[1] + 0.015, headTop.c[2] - 0.005];
      part("white").tube([0, 1, 2, 3, 4].map((k) => ({ c: [0, hc[1] + k * 0.06, hc[2] - k * 0.004], rx: headTop.r[0] + 0.016 + Math.min(k, 2) * 0.014, rz: headTop.r[2] + 0.016 + Math.min(k, 2) * 0.014, skin: () => one("Head"), wobble: (th) => Math.sin(th * 9) * 0.005 * Math.min(k, 3) })), 36, true);
    }
    if (o === "doorman") {
      const hc = [0, headTop.c[1] + 0.03, headTop.c[2] - 0.005];
      part("cloth").tube([0, 1].map((k) => ({ c: [0, hc[1] + k * 0.055, hc[2]], rx: headTop.r[0] + 0.018, rz: headTop.r[2] + 0.018, skin: () => one("Head") })), 32, true);
      part("gold").tube([0, 1].map((k) => ({ c: [0, hc[1] + 0.006 + k * 0.014, hc[2]], rx: headTop.r[0] + 0.021, rz: headTop.r[2] + 0.021, skin: () => one("Head") })), 32);
      // peak: half-ellipse visor
      const V = part("black"), v0 = V.size, segs = 12;
      for (let s = 0; s <= segs; s++) {
        const th = -Math.PI / 2 + (s / segs) * Math.PI;
        V.v([Math.sin(th) * (headTop.r[0] + 0.02), hc[1] + 0.002, hc[2] + Math.cos(th) * (headTop.r[2] + 0.02)], [s / segs, 0], ...one("Head"));
        V.v([Math.sin(th) * (headTop.r[0] + 0.01), hc[1] - 0.006, hc[2] + Math.cos(th) * (headTop.r[2] + 0.06)], [s / segs, 1], ...one("Head"));
      }
      for (let s = 0; s < segs; s++) V.quad(v0 + s * 2, v0 + s * 2 + 2, v0 + s * 2 + 3, v0 + s * 2 + 1);
      mats.black.setDoubleSided(true);
    }
  } else {
    const hemY = { floor: 0.0, calf: 0.32 }[look.length ?? "floor"];
    const waistY = o === "flapper" ? 1.0 : 1.02;
    const waist = slab((i, x, y) => (dom[i] === "pelvis" || dom[i] === "torso") && Math.abs(y - waistY) < 0.015);
    const hips = slab((i, x, y) => (dom[i] === "pelvis" || dom[i] === "thigh") && Math.abs(y - 0.88) < 0.02);
    const rows = 16, bottom = Math.max(0.012, hemY);
    const rings = [];
    for (let k = 0; k <= rows; k++) {
      const t = k / rows, y = waistY - t * (waistY - bottom);
      const flare = o === "flapper" ? 0.012 + t * 0.012 : o === "maid" ? 0.03 + t * 0.08 : 0.02 + Math.pow(t, 1.5) * 0.2;
      const hipK = smooth(waistY, 0.88, y);
      const lip = smooth(0, 0.15, t); // flush with the bodice at the waist, then clears the hips
      const rx = Math.max(waist.r[0] + 0.004 + 0.012 * lip, hips.r[0] + 0.022) * hipK + (waist.r[0] + 0.004 + 0.012 * lip) * (1 - hipK) + flare * lip;
      const rz = Math.max(waist.r[2] + 0.005 + 0.012 * lip, hips.r[2] + 0.024) * hipK + (waist.r[2] + 0.005 + 0.012 * lip) * (1 - hipK) + flare * 0.85 * lip;
      rings.push({
        c: [0, y, (waist.c[2] + hips.c[2]) / 2 - t * 0.012],
        rx, rz,
        wobble: (th) => (o === "gown" ? Math.sin(th * 10) * 0.014 * t * t : o === "maid" ? Math.sin(th * 8) * 0.008 * t : Math.sin(th * 14) * 0.004 * t),
        skin: (th) => {
          // smooth left/right blend: front & back centre stay on the pelvis (no seam tearing)
          const sl = Math.max(0, Math.sin(th)), sr = Math.max(0, -Math.sin(th));
          const leg = Math.min(0.75, t * 0.95);
          return [[JI("pelvis"), JI("thigh_l"), JI("thigh_r")], [1 - leg * (sl + sr) * 0.8, leg * sl * 0.8, leg * sr * 0.8]];
        },
      });
    }
    part("skirt").tube(rings, 48);
    const band = (y, h, m, extra) => {
      const k = Math.max(0, Math.min(rows, Math.round(((waistY - y) / (waistY - bottom)) * rows)));
      const r = rings[k];
      part(m).tube([0, 1].map((q) => ({ c: [0, y + (0.5 - q) * h, r.c[2]], rx: r.rx + extra, rz: r.rz + extra, skin: r.skin, wobble: r.wobble })), 48);
    };
    if (o !== "maid") band(waistY - 0.012, 0.03, "trim", 0.005);
    if (o === "flapper") {
      band(waistY - 0.12, 0.012, "trim", 0.004);
      band(waistY - 0.26, 0.012, "trim", 0.004);
      const F = part("trim");
      const last = rings[rows];
      const strands = 150;
      for (let s = 0; s < strands; s++) {
        const th = (s / strands) * Math.PI * 2;
        const len = 0.09 + hash3(s, 3, 9) * 0.03;
        const p0 = [Math.sin(th) * (last.rx + 0.004), bottom + 0.01, last.c[2] + Math.cos(th) * (last.rz + 0.004)];
        const side = [Math.cos(th) * 0.0035, 0, -Math.sin(th) * 0.0035];
        const sk = last.skin(th);
        const a = F.v([p0[0] - side[0], p0[1], p0[2] - side[2]], [0, 0], ...sk);
        F.v([p0[0] + side[0], p0[1], p0[2] + side[2]], [1, 0], ...sk);
        F.v([p0[0] + side[0] * 0.6, p0[1] - len, p0[2] + side[2] * 0.6], [1, 1], ...sk);
        F.v([p0[0] - side[0] * 0.6, p0[1] - len, p0[2] - side[2] * 0.6], [0, 1], ...sk);
        F.quad(a, a + 3, a + 2, a + 1);
      }
    }
    if (o === "maid") {
      const A = part("apron");
      const cols = 8, b0 = A.size;
      for (let k = 0; k <= rows - 3; k++) {
        const r = rings[k];
        for (let s = 0; s <= cols; s++) {
          const th = -0.6 + (s / cols) * 1.2;
          A.v([Math.sin(th) * (r.rx + 0.008), r.c[1], r.c[2] + Math.cos(th) * (r.rz + 0.008)], [s / cols, k / rows], ...r.skin(th));
        }
      }
      for (let k = 0; k < rows - 3; k++) for (let s = 0; s < cols; s++) {
        const a = b0 + k * (cols + 1) + s;
        A.quad(a, a + 1, a + cols + 2, a + cols + 1);
      }
      part("apron").tube([0, 1].map((k) => ({ c: [0, headTop.c[1] + 0.012 + k * 0.022, headTop.c[2] - 0.03], rx: headTop.r[0] * 0.8 - k * 0.025, rz: headTop.r[2] * 0.65 - k * 0.025, skin: () => one("Head"), wobble: (th) => Math.sin(th * 12) * 0.005 })), 36, true);
    }
    if (look.pearls) {
      for (let k = 0; k < 30; k++) {
        const th = (k / 30) * Math.PI * 2;
        const droop = Math.max(0, Math.cos(th)) ** 2 * 0.04;
        part("pearl").blob([Math.sin(th) * (neck.r[0] + 0.016), B.neck - 0.005 - droop, neck.c[2] + Math.cos(th) * (neck.r[2] + 0.018 + droop * 0.5)], [0.0068, 0.0068, 0.0068], [JI("neck_01"), JI("spine_03")], [0.35, 0.65], 6);
      }
    }
    if (look.headband) {
      const y = B.H - 0.05;
      const ring = slab((i, x, yy) => dom[i] === "head" && Math.abs(yy - y) < 0.008);
      part("band").tube([0, 1].map((k) => ({ c: [ring.c[0], y + k * 0.016, ring.c[2]], rx: ring.r[0] + 0.01, rz: ring.r[2] + 0.01, skin: () => one("Head") })), 36);
      part("feather").blob([ring.r[0] + 0.004, y + 0.075, ring.c[2] - 0.025], [0.01, 0.075, 0.018], ...one("Head"), 10);
      part("trim").blob([ring.r[0] + 0.01, y + 0.008, ring.c[2] + 0.01], [0.011, 0.011, 0.007], ...one("Head"), 6);
    }
  }
  for (const [m, p] of Object.entries(parts)) {
    if (!p.I.length) continue;
    const Pp = new Float32Array(p.P);
    bodyMesh.addPrimitive(
      doc.createPrimitive()
        .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(Pp))
        .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(computeNormals(Pp, p.I)))
        .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(p.UV)))
        .setAttribute("JOINTS_0", doc.createAccessor().setType("VEC4").setArray(new Uint8Array(p.J)))
        .setAttribute("WEIGHTS_0", doc.createAccessor().setType("VEC4").setArray(new Float32Array(p.W)))
        .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(p.I)))
        .setMaterial(mats[m]),
    );
  }

  // -------- hair (same joint order → reuse skin) + tinted brows
  const hairC = [...lin(hex(look.hairColor)), 1];
  const addHair = async (file) => {
    const hdoc = await io.read(join(SRC, "hair", `${file}.gltf`));
    const hp = hdoc.getRoot().listMeshes()[0].listPrimitives()[0];
    const hm = hp.getMaterial();
    const mat = doc.createMaterial(`${look.id}_${file}`).setBaseColorFactor(hairC).setRoughnessFactor(0.5).setMetallicFactor(0).setDoubleSided(true);
    const copy = async (src, name) => (src ? doc.createTexture(name).setImage(await sharp(src.getImage()).resize(1024, 1024, { fit: "inside" }).webp({ quality: 88 }).toBuffer()).setMimeType("image/webp").setURI(`tex/${name}.webp`) : null);
    const bc = await copy(hm.getBaseColorTexture(), `${file}_base`);
    if (bc) mat.setBaseColorTexture(bc);
    const nm = await copy(hm.getNormalTexture(), `${file}_normal`);
    if (nm) mat.setNormalTexture(nm);
    mat.setAlphaMode(hm.getAlphaMode()).setAlphaCutoff(hm.getAlphaCutoff());
    const np = doc.createPrimitive().setMaterial(mat).setIndices(doc.createAccessor().setType("SCALAR").setArray(hp.getIndices().getArray().slice()));
    for (const s of ["POSITION", "NORMAL", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"]) {
      const a = hp.getAttribute(s);
      if (a) np.setAttribute(s, doc.createAccessor().setType(a.getType()).setArray(a.getArray().slice()));
    }
    const node = doc.createNode(file).setMesh(doc.createMesh(file).addPrimitive(np)).setSkin(skin);
    (bodyNode.getParentNode() ?? root.listScenes()[0]).addChild(node);
  };
  await addHair(look.hair);
  if (look.beard) await addHair("Hair_Beard");
  for (const m of root.listMaterials()) if (/MI_Hair/.test(m.getName())) m.setBaseColorFactor(hairC);
  for (const t of root.listTextures()) {
    const uri = t.getURI() || t.getName() || "tex";
    if (uri.startsWith("tex/")) continue;
    const base = uri.replace(/^.*\//, "").replace(/\.(png|jpe?g|webp)$/i, "").replace(/_png$/, "");
    t.setImage(await sharp(t.getImage()).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer()).setMimeType("image/webp").setURI(`tex/${base}.webp`);
  }
  for (const b of root.listBuffers()) b.setURI(`${look.id}.bin`);
  await doc.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  await io.write(join(OUT, `${look.id}.gltf`), doc);
  const tris = bodyMesh.listPrimitives().reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
  console.log(`  ${look.id.padEnd(9)} ${o.padEnd(12)} ${Math.round(tris)} tris`);
}

for (const look of cast) if (!only.length || only.includes(look.id)) await build(look);
