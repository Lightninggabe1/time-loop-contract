import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
import { readdirSync } from "node:fs";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
for (const f of readdirSync("public/assets/models")) {
  const doc = await io.read("public/assets/models/" + f);
  const b = getBounds(doc.getRoot().listScenes()[0]);
  const r = (a) => a.map((x) => x.toFixed(2)).join(",");
  const mats = doc.getRoot().listMaterials().map((m) => m.getName() + (m.getEmissiveFactor().some(x=>x>0) ? "*" : "") + (m.getAlphaMode()!=="OPAQUE"?"(" + m.getAlphaMode() + ")":""));
  console.log(f.padEnd(34), "min", r(b.min), "max", r(b.max), "tris", doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0), mats.join(" "));
}
