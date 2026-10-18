// Keep only the animation clips the game plays (src/characters/npc.ts CLIPS)
// from the Universal Animation Library, and drop its mannequin mesh (never
// shown; retargeting only needs the skeleton). 6.7 MB → well under 1 MB.
//   node scripts/prune-anims.mjs
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup, resample, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import { readFile, stat } from "node:fs/promises";

const SRC = "assets-src/anim/AnimationLibrary_Godot_Standard.glb"; // fetched original (CC0), not shipped
const OUT = "public/assets/characters/anim/anims.glb";

const npcSrc = await readFile("src/characters/npc.ts", "utf8");
const block = npcSrc.slice(npcSrc.indexOf("const CLIPS = {"), npcSrc.indexOf("} as const;"));
const keep = new Set([...block.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]));
console.log("keeping", [...keep].join(", "));

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(SRC);
const root = doc.getRoot();
for (const a of root.listAnimations()) if (!keep.has(a.getName())) a.dispose();
const missing = [...keep].filter((k) => !root.listAnimations().some((a) => a.getName() === k));
if (missing.length) throw new Error(`clips not in library: ${missing.join(", ")}`);
// the mannequin's skin and mesh go; bones (nodes) stay
for (const n of root.listNodes()) {
  if (n.getMesh()) n.setMesh(null);
  if (n.getSkin()) n.setSkin(null);
}
for (const m of root.listMeshes()) m.dispose();
for (const s of root.listSkins()) s.dispose();
await doc.transform(resample({ tolerance: 1e-4 }), dedup(), prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
await io.write(OUT, doc);
const a = (await stat(SRC)).size, b = (await stat(OUT)).size;
console.log(`${OUT}: ${(a / 1e6).toFixed(2)} MB → ${(b / 1e6).toFixed(2)} MB`);

