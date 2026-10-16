// Downloads CC0 assets from Poly Haven into assets-src/ (raw) and records them
// in CREDITS.md. Idempotent: skips files that already exist.
import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RAW = join(ROOT, "assets-src");
const API = "https://api.polyhaven.com";

const HDRIS = [{ id: "ballroom", res: "2k" }];
const TEXTURES = [
  "herringbone_parquet",
  "velour_velvet",
  "plastered_wall_04",
  "quatrefoil_jacquard_fabric",
  "fabric_leather_02",
  "poly_wool_herringbone",
  "dark_paneled_wood", "lacquered_cherry_wood", "checkered_pavement_tiles", "interior_tiles", "stone_tiles_02", "kitchen_wood",
];
const MAPS = { Diffuse: "diff", nor_gl: "nor_gl", arm: "arm" };
const MODELS = [
  "Chandelier_02",
  "Chandelier_01",
  "ArmChair_01",
  "Sofa_01",
  "vintage_grandfather_clock_01",
  "brass_candleholders",
  "brass_goblets",
  "marble_bust_01",
  "potted_plant_01",
  "dining_chair_02",
  "wine_bottles_01",
  "coffee_table_round_01",
  // study
  "chess_set", "mantel_clock_01", "book_encyclopedia_set_01",
  "decorative_book_set_01", "desk_lamp_arm_01", "magnifying_glass_01", "Rockingchair_01",
  "fancy_picture_frame_02", "drawer_cabinet",
  // kitchen
  "brass_pot_01", "brass_pan_01", "wooden_cutting_board", "jug_01", "wine_barrel_01", "wooden_crate_01",
  "strawberry_chocolate_cake", "croissant", "food_apple_01", "wooden_bowl_01", "metal_trash_can",
  // balcony & garden
  "planter_box_01", "potted_plant_04", "street_lamp_01", "horse_statue_01", "shrub_01", "shrub_03",
];

const exists = (p) => access(p).then(() => true, () => false);

async function get(url, dest) {
  if (await exists(dest)) return;
  await mkdir(dirname(dest), { recursive: true });
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      await writeFile(dest, Buffer.from(await r.arrayBuffer()));
      console.log("  ✓", dest.replace(ROOT, ""));
      return;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
}

const json = async (u) => (await fetch(u)).json();
const credits = [];

async function main() {
  for (const { id, res } of HDRIS) {
    const f = await json(`${API}/files/${id}`);
    await get(f.hdri[res].hdr.url, join(RAW, "hdri", `${id}_${res}.hdr`));
    credits.push(["HDRI", id, `https://polyhaven.com/a/${id}`]);
  }
  for (const id of TEXTURES) {
    const f = await json(`${API}/files/${id}`);
    for (const [k, short] of Object.entries(MAPS)) {
      const u = f[k]?.["2k"]?.jpg?.url;
      if (u) await get(u, join(RAW, "textures", id, `${short}.jpg`));
      else console.warn("  ! no", k, "for", id);
    }
    credits.push(["Texture", id, `https://polyhaven.com/a/${id}`]);
  }
  for (const id of MODELS) {
    const f = await json(`${API}/files/${id}`);
    const g = f.gltf?.["1k"]?.gltf;
    if (!g) {
      console.warn("  ! no glTF for", id, "— skipped");
      continue;
    }
    const base = g.url.slice(0, g.url.lastIndexOf("/") + 1);
    await get(g.url, join(RAW, "models", id, `${id}.gltf`));
    for (const [rel, info] of Object.entries(g.include)) {
      await get(info.url ?? base + rel, join(RAW, "models", id, rel));
    }
    credits.push(["Model", id, `https://polyhaven.com/a/${id}`]);
  }

  const path = join(ROOT, "CREDITS.md");
  let md = (await exists(path)) ? await readFile(path, "utf8") : "";
  if (!md.includes("| Type |")) {
    md =
      "# Credits\n\nAll third-party assets are CC0 (public domain). Self-made assets are noted.\n\n" +
      "| Type | Asset | Author / Source | Licence | URL |\n|---|---|---|---|---|\n";
  }
  for (const [type, id, url] of credits) {
    if (!md.includes(url)) md += `| ${type} | ${id} | Poly Haven | CC0 | ${url} |\n`;
  }
  await writeFile(path, md);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
