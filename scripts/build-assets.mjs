// Converts raw CC0 assets in assets-src/ into web-ready files in public/assets/:
//  - models  → single .glb, meshopt-compressed geometry, WebP textures
//  - textures → WebP (2K albedo/normal, 1K ARM)
//  (HDRIs are baked to .env by scripts/bake-env.mjs)
import { readdir, mkdir, access, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, meshopt, textureCompress, resample, simplify } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "assets-src");
const OUT = join(ROOT, "public", "assets");
const force = process.argv.includes("--force");
const onlyModels = process.argv.find((a) => a.startsWith("--models="))?.slice(9).split(",");
const exists = (p) => access(p).then(() => true, () => false);
const newer = async (a, b) => force || !(await exists(b)) || (await stat(a)).mtimeMs > (await stat(b)).mtimeMs;

// Per-model diet: small table props don't need 1K maps, and foliage scans
// carry far more triangles than they show at play distance.
const DIET = {
  brass_candleholders: { tex: 512 },
  brass_goblets: { tex: 512 },
  croissant: { tex: 512 },
  food_apple_01: { tex: 512 },
  wooden_bowl_01: { tex: 512 },
  strawberry_chocolate_cake: { tex: 512 },
  potted_plant_01: { simplify: 0.3 },
  potted_plant_04: { simplify: 0.4 },
  shrub_01: { simplify: 0.25, tex: 512 },
  shrub_03: { simplify: 0.35, tex: 512 },
};

async function models() {
  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
  await mkdir(join(OUT, "models"), { recursive: true });
  for (const id of await readdir(join(SRC, "models"))) {
    const src = join(SRC, "models", id, `${id}.gltf`);
    const dst = join(OUT, "models", `${id}.glb`);
    if (onlyModels ? !onlyModels.includes(id) : !(await newer(src, dst))) continue;
    const doc = await io.read(src);
    const diet = DIET[id] ?? {};
    const t = diet.tex ?? 1024;
    await doc.transform(
      dedup(),
      weld(),
      ...(diet.simplify ? [simplify({ simplifier: MeshoptSimplifier, ratio: diet.simplify, error: 0.002 })] : []),
      resample(),
      prune(),
      textureCompress({ encoder: sharp, targetFormat: "webp", resize: [t, t], quality: 88 }),
      meshopt({ encoder: MeshoptEncoder, level: "medium" }),
    );
    await io.write(dst, doc);
    console.log("  model", id, ((await stat(dst)).size / 1024).toFixed(0) + " KB");
  }
}

async function textures() {
  for (const id of await readdir(join(SRC, "textures"))) {
    await mkdir(join(OUT, "textures", id), { recursive: true });
    for (const map of ["diff", "nor_gl", "arm"]) {
      const src = join(SRC, "textures", id, `${map}.jpg`);
      const dst = join(OUT, "textures", id, `${map}.webp`);
      if (!(await exists(src))) continue;
      if (!(await newer(src, dst))) continue;
      const size = map === "arm" ? 1024 : 2048;
      await sharp(src).resize(size, size).webp({ quality: map === "nor_gl" ? 92 : 86 }).toFile(dst);
    }
    console.log("  texture", id);
  }
}

await models();
await textures();
console.log("assets built");
