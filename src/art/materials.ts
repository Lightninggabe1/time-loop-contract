// Material library: one shared PBR material per surface type, frozen after
// creation. Kit meshes use world-scale box-projected UVs (see kit/uv.ts), so
// `tile` below is "metres per texture repeat".
import { PBRMaterial, Texture, Color3, Scene } from "@babylonjs/core";
import { Palette } from "./palette";

const BASE = "./assets/textures/";

interface TexSet {
  dir: string;
  tile: number; // metres per repeat (informational; UVs are generated in metres / tile)
  tint?: Color3;
  roughness?: number; // multiplier on ARM green channel
  clearCoat?: number;
  bump?: number;
  env?: number; // environment (IBL) intensity multiplier
}

export const TILE: Record<string, number> = {};

const sets: Record<string, TexSet> = {
  floorDeco: { dir: "gen_floor_deco", tile: 4, clearCoat: 0.6, bump: 0.6, env: 0.06 },
  parquet: { dir: "herringbone_parquet", tile: 2.2, tint: hexTint("#D9B38C"), clearCoat: 0.8, roughness: 0.6, bump: 0.5, env: 0.06 },
  wallFan: { dir: "gen_wall_fan", tile: 1.2, bump: 0.6 },
  gold: { dir: "gen_gold", tile: 1, bump: 0.3 },
  marbleEmerald: { dir: "gen_marble_emerald", tile: 1.6, clearCoat: 0.7 },
  marbleBlack: { dir: "gen_marble_black", tile: 1.6, clearCoat: 0.7 },
  marbleCream: { dir: "gen_marble_cream", tile: 1.8, clearCoat: 0.5 },
  velvet: { dir: "velour_velvet", tile: 1.0, tint: hexTint("#7A2034"), roughness: 1.0 },
  jacquard: { dir: "quatrefoil_jacquard_fabric", tile: 0.6, tint: hexTint("#9A3A4E"), roughness: 1.0, bump: 0.8 },
  plaster: { dir: "plastered_wall_04", tile: 3, tint: hexTint("#F3E6CC"), roughness: 1.0, bump: 0.3 },
  leather: { dir: "fabric_leather_02", tile: 1, tint: hexTint("#8A3A2A") },
  // study
  walnutPanel: { dir: "dark_paneled_wood", tile: 2.4, tint: hexTint("#C29A78"), clearCoat: 0.35, roughness: 0.8 },
  studyPaper: { dir: "quatrefoil_jacquard_fabric", tile: 0.7, tint: hexTint("#2E6A52"), roughness: 1.0, bump: 0.8 },
  studyFloor: { dir: "herringbone_parquet", tile: 1.6, tint: hexTint("#9C6A44"), clearCoat: 0.7, roughness: 0.6, bump: 0.5, env: 0.08 },
  cherry: { dir: "lacquered_cherry_wood", tile: 1.2, clearCoat: 0.6 },
  // kitchen
  kitchenTile: { dir: "interior_tiles", tile: 1.2, tint: hexTint("#F4F0E6"), roughness: 0.5, bump: 0.7 },
  kitchenFloor: { dir: "checkered_pavement_tiles", tile: 1.6, roughness: 0.6, bump: 0.6, env: 0.15 },
  butcherBlock: { dir: "kitchen_wood", tile: 1.0 },
  // balcony / exterior
  stone: { dir: "stone_tiles_02", tile: 2.0, tint: hexTint("#A79E8F"), roughness: 1.0, bump: 0.8 },
  terrace: { dir: "stone_tiles_02", tile: 1.6, tint: hexTint("#7E776C"), roughness: 1.0, bump: 0.9 },
  facade: { dir: "plastered_wall_04", tile: 3, tint: hexTint("#E9DFCC"), roughness: 1.0, bump: 0.4 },
};

function hexTint(h: string) {
  return Color3.FromHexString(h);
}

const cache = new Map<string, PBRMaterial>();
let scene: Scene;

export function initMaterials(s: Scene) {
  scene = s;
  cache.clear();
  for (const [k, v] of Object.entries(sets)) TILE[k] = v.tile;
}

function tex(path: string, srgb = true) {
  const t = new Texture(BASE + path, scene, { noMipmap: false, samplingMode: Texture.TRILINEAR_SAMPLINGMODE });
  t.anisotropicFilteringLevel = 8;
  t.gammaSpace = srgb;
  return t;
}

function textured(name: string, s: TexSet) {
  const m = new PBRMaterial(name, scene);
  m.albedoTexture = tex(`${s.dir}/diff.webp`);
  if (s.tint) m.albedoColor = s.tint;
  const arm = tex(`${s.dir}/arm.webp`, false);
  m.metallicTexture = arm;
  m.useAmbientOcclusionFromMetallicTextureRed = true;
  m.useRoughnessFromMetallicTextureGreen = true;
  m.useMetallnessFromMetallicTextureBlue = true;
  m.metallic = 1;
  m.roughness = s.roughness ?? 1;
  const n = tex(`${s.dir}/nor_gl.webp`, false);
  n.level = s.bump ?? 1;
  m.bumpTexture = n;
  m.invertNormalMapY = false;
  if (s.env !== undefined) m.environmentIntensity = s.env;
  if (s.clearCoat) {
    m.clearCoat.isEnabled = true;
    m.clearCoat.intensity = s.clearCoat;
    m.clearCoat.roughness = 0.05;
  }
  return m;
}

function solid(name: string, albedo: Color3, metallic: number, roughness: number) {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = albedo;
  m.metallic = metallic;
  m.roughness = roughness;
  return m;
}

function emissive(name: string, color: Color3, intensity: number) {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = Color3.Black();
  m.emissiveColor = color;
  m.emissiveIntensity = intensity;
  m.metallic = 0;
  m.roughness = 1;
  m.disableLighting = true;
  return m;
}

const builders: Record<string, () => PBRMaterial> = {
  lacquer: () => {
    const m = solid("lacquer", Palette.lacquer, 0, 0.35);
    m.clearCoat.isEnabled = true;
    m.clearCoat.roughness = 0.04;
    return m;
  },
  goldSolid: () => solid("goldSolid", Palette.gold, 1, 0.22),
  brass: () => solid("brass", Palette.brass, 1, 0.32),
  emeraldLacquer: () => {
    const m = solid("emeraldLacquer", Palette.emerald, 0, 0.3);
    m.clearCoat.isEnabled = true;
    m.clearCoat.roughness = 0.06;
    return m;
  },
  burgundyLacquer: () => {
    const m = solid("burgundyLacquer", Palette.burgundy, 0, 0.32);
    m.clearCoat.isEnabled = true;
    m.clearCoat.roughness = 0.06;
    return m;
  },
  cabinetCream: () => {
    const m = solid("cabinetCream", Color3.FromHexString("#E8DEC8").toLinearSpace(), 0, 0.4);
    m.clearCoat.isEnabled = true;
    m.clearCoat.intensity = 0.4;
    return m;
  },
  cabinetLine: () => solid("cabinetLine", Color3.FromHexString("#8C7F6A").toLinearSpace(), 0, 0.6),
  emberGlow: () => emissive("emberGlow", Color3.FromHexString("#FF7A2A"), 5),
  bookRed: () => solid("bookRed", Color3.FromHexString("#6E1A22").toLinearSpace(), 0, 0.55),
  bookGreen: () => solid("bookGreen", Color3.FromHexString("#1E4A36").toLinearSpace(), 0, 0.55),
  bookNavy: () => solid("bookNavy", Color3.FromHexString("#1C2440").toLinearSpace(), 0, 0.55),
  bookTan: () => solid("bookTan", Color3.FromHexString("#8C6A44").toLinearSpace(), 0, 0.6),
  bookBlack: () => solid("bookBlack", Color3.FromHexString("#1A1616").toLinearSpace(), 0, 0.5),
  hedge: () => solid("hedge", Color3.FromHexString("#14261A").toLinearSpace(), 0, 0.9),
  lawn: () => solid("lawn", Color3.FromHexString("#0C140E").toLinearSpace(), 0, 1),
  cofferPaint: () => solid("cofferPaint", Color3.FromHexString("#1F4A3E").toLinearSpace(), 0, 0.55),
  white: () => solid("white", Color3.FromHexString("#F2EEE6").toLinearSpace(), 0, 0.6),
  linen: () => solid("linen", Palette.ivory, 0, 0.85),
  walnut: () => {
    const m = solid("walnut", Palette.walnut, 0, 0.4);
    m.clearCoat.isEnabled = true;
    return m;
  },
  mirror: () => solid("mirror", Color3.FromHexString("#CFC2A8").toLinearSpace(), 1, 0.06),
  mirrorLive: () => solid("mirrorLive", Color3.FromHexString("#CFC2A8").toLinearSpace(), 1, 0.0),
  glass: () => {
    const m = solid("glass", Color3.FromHexString("#FFF4E0").toLinearSpace(), 0, 0.02);
    m.alpha = 0.12;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    m.indexOfRefraction = 1.5;
    m.environmentIntensity = 0.5;
    return m;
  },
  crystal: () => {
    const m = solid("crystal", Color3.FromHexString("#FFFFFF").toLinearSpace(), 0, 0.03);
    m.alpha = 0.32;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    m.environmentIntensity = 1.4;
    return m;
  },
  champagne: () => {
    const m = solid("champagne", Color3.FromHexString("#8A5E1E").toLinearSpace(), 0, 0.04);
    m.alpha = 0.8;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    return m;
  },
  lampGlow: () => emissive("lampGlow", Palette.glowWarm, 4),
  coveGlow: () => emissive("coveGlow", Palette.tungsten, 2.6),
  candleFlame: () => emissive("candleFlame", Palette.candle, 8),
  clockFace: () => emissive("clockFace", Color3.FromHexString("#FFE9C2"), 1.4),
  skyDome: () => {
    const m = new PBRMaterial("skyDome", scene);
    m.albedoColor = Color3.Black();
    m.emissiveTexture = tex("gen_sky_dome/diff.webp");
    m.emissiveColor = Color3.White();
    m.emissiveIntensity = 1.0;
    m.disableLighting = true;
    m.fogEnabled = false;
    return m;
  },
  moonDisc: () => emissive("moonDisc", Color3.FromHexString("#F4EEDC"), 3.5),
  nightSky: () => {
    const m = new PBRMaterial("nightSky", scene);
    m.albedoColor = Color3.Black();
    m.emissiveTexture = tex("gen_night_sky/diff.webp");
    m.emissiveColor = Color3.White();
    m.emissiveIntensity = 1.2;
    m.disableLighting = true;
    return m;
  },
};

export function mat(name: string): PBRMaterial {
  let m = cache.get(name);
  if (m) return m;
  if (sets[name]) m = textured(name, sets[name]);
  else if (builders[name]) m = builders[name]();
  else throw new Error(`Unknown material ${name}`);
  m.maxSimultaneousLights = 8;
  cache.set(name, m);
  return m;
}

/** Freeze all library materials once the scene is assembled. */
export function freezeMaterials() {
  for (const m of cache.values()) {
    if (m.alpha < 1 || m.name === "mirrorLive") continue;
    m.freeze();
  }
}

