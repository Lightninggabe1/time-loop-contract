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
import { dedup, prune, weld, meshopt, textureCompress, resample } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "assets-src");
const OUT = join(ROOT, "public", "assets");
const force = process.argv.includes("--force");
const exists = (p) => access(p).then(() => true, () => false);
const newer = async (a, b) => force || !(await exists(b)) || (await stat(a)).mtimeMs > (await stat(b)).mtimeMs;

async function models() {
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
  await mkdir(join(OUT, "models"), { recursive: true });
  for (const id of await readdir(join(SRC, "models"))) {
    const src = join(SRC, "models", id, `${id}.gltf`);
    const dst = join(OUT, "models", `${id}.glb`);
    if (!(await newer(src, dst))) continue;
    const doc = await io.read(src);
    await doc.transform(
      dedup(),
      weld(),
      resample(),
      prune(),
      textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 88 }),
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
