// Dev tool: converts an .hdr panorama into a prefiltered Babylon .env file.
// Driven by scripts/bake-env.mjs via Playwright; result exposed on window.
import { Engine, Scene, HDRCubeTexture, EnvironmentTextureTools } from "@babylonjs/core";

const params = new URLSearchParams(location.search);
const src = params.get("src") ?? "../assets/env/ballroom_2k.hdr";
const size = Number(params.get("size") ?? 512);
const engine = new Engine(document.getElementById("c") as HTMLCanvasElement);
const scene = new Scene(engine);
const hdr = new HDRCubeTexture(src, scene, size, false, true, false, true);
hdr.onLoadObservable.addOnce(async () => {
  const buf = await EnvironmentTextureTools.CreateEnvTextureAsync(hdr, { imageType: "image/png" });
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  (window as any).envBase64 = btoa(bin);
});
