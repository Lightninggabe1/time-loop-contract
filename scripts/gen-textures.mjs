// Self-generated (CC0) procedural textures for the art-deco look.
// Output: public/assets/textures/<name>/{diff,arm,nor_gl}.webp
// All patterns tile seamlessly (periodic noise).
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "public", "assets", "textures");
const only = process.argv.slice(2);

// ---------- palette (linear-ish sRGB 0..255), mirrors src/art/palette.ts ----------
const C = {
  cream: [236, 226, 206],
  creamVein: [168, 150, 122],
  emerald: [18, 74, 58],
  emeraldVein: [120, 178, 150],
  black: [22, 20, 22],
  blackVein: [96, 90, 88],
  brass: [214, 168, 82],
  gold: [226, 178, 92],
  burgundy: [92, 18, 34],
};

// ---------- periodic gradient noise ----------
function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const g = (ix, iy) => {
    const a = hash(((ix % period) + period) % period, ((iy % period) + period) % period, seed) * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)];
  };
  const dot = (ix, iy) => {
    const [gx, gy] = g(ix, iy);
    return gx * (x - ix) + gy * (y - iy);
  };
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = dot(xi, yi), b = dot(xi + 1, yi), c = dot(xi, yi + 1), d = dot(xi + 1, yi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.4;
}
function fbm(u, v, base, oct, seed) {
  let s = 0, amp = 0.5, f = base;
  for (let i = 0; i < oct; i++) {
    s += amp * noise(u * f, v * f, f, seed + i * 17);
    f *= 2;
    amp *= 0.5;
  }
  return s;
}

const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// marble colour at uv in [0,1) (tileable)
function marble(u, v, base, veinCol, seed, scale = 2) {
  const warp = fbm(u, v, scale, 5, seed);
  const n = fbm(u + warp * 0.35, v + warp * 0.35, scale * 2, 5, seed + 101);
  const vein = Math.pow(1 - Math.abs(n * 2.2), 14); // thin veins
  const fine = Math.pow(1 - Math.abs(fbm(u, v, scale * 3, 3, seed + 7) * 2.5), 40) * 0.22;
  const cloud = fbm(u, v, scale, 3, seed + 55) * 0.5 + 0.5;
  let c = mix3(base, mix3(base, veinCol, 0.25), cloud * 0.6);
  c = mix3(c, veinCol, clamp(vein * 0.85 + fine));
  return { c, vein: clamp(vein + fine) };
}

// ---------- writer ----------
async function write(name, w, h, fn) {
  const diff = Buffer.alloc(w * h * 3);
  const arm = Buffer.alloc(w * h * 3);
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = fn(x / w, y / h, x, y);
      diff[i * 3] = clamp(r.c[0], 0, 255);
      diff[i * 3 + 1] = clamp(r.c[1], 0, 255);
      diff[i * 3 + 2] = clamp(r.c[2], 0, 255);
      arm[i * 3] = clamp(r.ao ?? 1) * 255;
      arm[i * 3 + 1] = clamp(r.rough ?? 0.5) * 255;
      arm[i * 3 + 2] = clamp(r.metal ?? 0) * 255;
      height[i] = r.h ?? 0;
    }
  }
  // normal map from height (OpenGL convention, +Y up), wraps
  const nor = Buffer.alloc(w * h * 3);
  const k = 2.0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hx = height[y * w + ((x + 1) % w)] - height[y * w + ((x - 1 + w) % w)];
      const hy = height[((y + 1) % h) * w + x] - height[((y - 1 + h) % h) * w + x];
      let nx = -hx * k, ny = hy * k, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 3;
      nor[i] = ((nx / l) * 0.5 + 0.5) * 255;
      nor[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      nor[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
    }
  }
  const dir = join(OUT, name);
  await mkdir(dir, { recursive: true });
  const raw = { raw: { width: w, height: h, channels: 3 } };
  await sharp(diff, raw).webp({ quality: 90 }).toFile(join(dir, "diff.webp"));
  await sharp(arm, raw).webp({ quality: 90 }).toFile(join(dir, "arm.webp"));
  await sharp(nor, raw).webp({ quality: 92 }).toFile(join(dir, "nor_gl.webp"));
  console.log("  gen", name, `${w}x${h}`);
}

// ---------- 1. deco marble floor: one texture = 4m × 4m ----------
// Cream field, emerald diamond centre, black border bands, brass inlay lines.
async function floorDeco() {
  const S = 2048, M = S / 4; // px per metre
  const line = 0.018 * M, band = 0.16 * M, groove = 2.5;
  await write("gen_floor_deco", S, S, (u, v, x, y) => {
    // distance to tile edge (tile = whole texture)
    const ex = Math.min(x, S - x), ey = Math.min(y, S - y);
    const edge = Math.min(ex, ey);
    // diamond in centre
    const cx = Math.abs(x - S / 2), cy = Math.abs(y - S / 2);
    const dia = (cx + cy) / M; // manhattan metres
    const R = 1.25;
    // inner star square (rotated 45 inside diamond)
    const sq = Math.max(cx, cy) / M;

    let mat = "cream";
    if (edge < band) mat = "black";
    else if (dia < R) mat = sq < 0.38 ? "cream" : "emerald";
    if (dia < 0.22) mat = "black";
    // brass lines: at band inner edge, diamond outline, inner square outline, centre
    const isLine =
      Math.abs(edge - band) < line / 2 ||
      Math.abs(dia - R) * M < line / 2 ||
      Math.abs(dia - (R + 0.12)) * M < line / 3 ||
      (dia < R && Math.abs(sq - 0.38) * M < line / 2) ||
      Math.abs(dia - 0.22) * M < line / 2;
    // corner squares at tile corners (black w/ brass)
    // star rays from centre along axes inside cream field
    const ray = (Math.abs(x - S / 2) < line / 2 || Math.abs(y - S / 2) < line / 2) && dia > R + 0.12 && edge > band;
    // tiny grout between 1m stone slabs in cream field
    const gx = Math.min(x % (M * 1), M - (x % M)), gy = Math.min(y % M, M - (y % M));
    const grout = mat === "cream" && dia > R + 0.12 && Math.min(gx, gy) < groove * 0.5;

    let r;
    if (isLine || ray) {
      const n = fbm(u, v, 64, 2, 9) * 0.5 + 0.5;
      r = { c: mix3(C.brass, [255, 214, 140], n * 0.3), rough: 0.22 + n * 0.1, metal: 1, h: 0.4 };
    } else {
      const seedOff = mat === "emerald" ? 300 : mat === "black" ? 500 : 100;
      const base = C[mat], vein = C[mat + "Vein"];
      const m = marble(u, v, base, vein, seedOff, mat === "cream" ? 2 : 3);
      r = { c: m.c, rough: 0.07 + m.vein * 0.08, metal: 0, h: 0 };
      if (grout) r = { c: mix3(m.c, C.creamVein, 0.5), rough: 0.5, metal: 0, h: -0.6, ao: 0.6 };
    }
    // seam groove at tile edge (between repeated textures)
    if (edge < groove) r = { ...r, h: -1, ao: 0.5, rough: 0.6 };
    return r;
  });
}

// ---------- 2. emerald deco fan wallpaper (1 tile = 0.6m) ----------
async function wallFan() {
  const S = 1024;
  await write("gen_wall_fan", S, S, (u, v) => {
    // overlapping fan "scales": 4 fans across, rows every half-width, lower rows on top
    const X = u * 4, Y = v * 4;
    const k0 = Math.floor(Y * 2);
    let lx = 0, ly = 0, d = 9;
    for (let k = k0 + 1; k >= k0 - 1; k--) {
      const off = ((k % 2) + 2) % 2 ? 0.5 : 0;
      const cx = Math.round(X - off) + off, by = (k + 1) * 0.5;
      const dd = Math.hypot(X - cx, by - Y) * 2;
      if (dd <= 1) { lx = X - cx; ly = by - Y; d = dd; break; }
    }
    const arcs = (d * 4) % 1;
    const ang = Math.atan2(lx, ly);
    const rays = Math.abs(Math.sin(ang * 7));
    const isGold = d > 0.97 || (d > 0.3 && arcs < 0.06) || (d > 0.55 && rays < 0.05 && ly > 0);
    const n = fbm(u, v, 8, 3, 21) * 0.5 + 0.5;
    if (isGold) return { c: mix3(C.gold, [255, 220, 150], n * 0.25), rough: 0.3, metal: 1, h: 0.3 };
    // champagne silk ground, slightly deeper toward each fan's base
    const base = mix3([214, 196, 160], [186, 162, 124], d * 0.8);
    return { c: mix3(base, [230, 214, 182], n * 0.25), rough: 0.55 + n * 0.1, metal: 0, h: n * 0.05 };
  });
}

// ---------- 3. gold leaf (1 tile = 1m) ----------
async function gold() {
  const S = 512;
  await write("gen_gold", S, S, (u, v) => {
    const n = fbm(u, v, 6, 5, 33) * 0.5 + 0.5;
    const leaf = (Math.floor(u * 8) + Math.floor(v * 8)) % 2 ? 0.04 : 0;
    return { c: mix3(C.gold, [255, 205, 120], n * 0.4 + leaf), rough: 0.18 + n * 0.18, metal: 1, h: n * 0.2 };
  });
}

// ---------- 4. single marble swatches (1 tile = 1.5m) ----------
async function swatches() {
  for (const m of ["emerald", "black", "cream"]) {
    await write(`gen_marble_${m}`, 1024, 1024, (u, v) => {
      const r = marble(u, v, C[m], C[m + "Vein"], m.length * 77, 2);
      return { c: r.c, rough: 0.08 + r.vein * 0.1, metal: 0, h: 0 };
    });
  }
}

// ---------- 5. night sky with stars + distant garden silhouette (for windows) ----------
async function sky() {
  const W = 2048, H = 1024;
  await write("gen_night_sky", W, H, (u, v, x, y) => {
    const top = [8, 12, 34], hor = [44, 52, 96];
    let c = mix3(top, hor, Math.pow(v, 2.2));
    const st = hash(x, y, 4);
    if (st > 0.9985 && v < 0.75) c = mix3(c, [255, 245, 225], (st - 0.9985) / 0.0015);
    // tree line silhouette
    const tree = 0.78 + fbm(u, 0, 6, 4, 77) * 0.08 + Math.abs(Math.sin(u * 60)) * 0.01;
    if (v > tree) c = mix3([6, 10, 16], [14, 22, 30], (v - tree) * 3);
    // moon glow
    const md = Math.hypot((u - 0.7) * 2, v - 0.25);
    c = mix3(c, [120, 140, 190], clamp(0.25 - md) * 1.5);
    if (md < 0.035) c = [240, 236, 220];
    return { c, rough: 1, metal: 0 };
  });
}

const jobs = { floorDeco, wallFan, gold, swatches, sky };
for (const [k, f] of Object.entries(jobs)) if (!only.length || only.includes(k)) await f();
