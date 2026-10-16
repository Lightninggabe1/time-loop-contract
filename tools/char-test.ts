// Dev tool: renders base characters with retargeted animations for look tests.
import {
  Engine, Scene, ArcRotateCamera, Vector3, CubeTexture, DirectionalLight, ShadowGenerator, MeshBuilder,
  PBRMaterial, Color3, LoadAssetContainerAsync, AnimatorAvatar, DefaultRenderingPipeline, ImageProcessingConfiguration, TransformNode, Color4,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { MeshoptCompression } from "@babylonjs/core/Meshes/Compression/meshoptCompression";
MeshoptCompression.Configuration.decoder.url = new URL("../vendor/meshopt_decoder.js", location.href).href;
import { UAL_TO_UBC } from "../src/characters/retarget";

const P = new URLSearchParams(location.search);
const engine = new Engine(document.getElementById("c") as HTMLCanvasElement, true, { preserveDrawingBuffer: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.07, 0.04, 0.05, 1);
scene.environmentTexture = CubeTexture.CreateFromPrefilteredData("../assets/env/ballroom_2k.env", scene);
scene.environmentIntensity = 0.6;
const cam = new ArcRotateCamera("c", Number(P.get("alpha") ?? Math.PI / 2), 1.45, Number(P.get("dist") ?? 4.2), new Vector3(0, Number(P.get("ty") ?? 1.0), 0), scene);
cam.fov = 0.6;
const key = new DirectionalLight("k", new Vector3(-0.5, -0.6, 0.6), scene);
key.intensity = 3;
key.position = new Vector3(4, 6, -6);
const sg = new ShadowGenerator(2048, key);
sg.usePercentageCloserFiltering = true;
const floor = MeshBuilder.CreateGround("g", { width: 10, height: 10 }, scene);
const fm = new PBRMaterial("f", scene);
fm.albedoColor = new Color3(0.25, 0.2, 0.18);
fm.roughness = 0.5;
floor.material = fm;
floor.receiveShadows = true;
const pp = new DefaultRenderingPipeline("p", true, scene, [cam]);
pp.samples = 4;
pp.imageProcessing.toneMappingEnabled = true;
pp.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;

const anims = await LoadAssetContainerAsync("../assets/characters/anim/AnimationLibrary_Godot_Standard.glb", scene);
const clip = P.get("anim") ?? "Idle_Loop";
const npcs = (P.get("npcs") ?? "ashcombe,vivienne,calloway,dolly").split(",");
const gap = Number(P.get("gap") ?? 0.95);
let x = -((npcs.length - 1) * gap) / 2;
for (let i = 0; i < npcs.length; i++) {
  const c = await LoadAssetContainerAsync(`../assets/characters/npc/${npcs[i]}.gltf`, scene);
  const inst = c.instantiateModelsToScene((n) => n, false);
  const root = inst.rootNodes[0] as TransformNode;
  root.position.x = x;
  x += gap;
  for (const m of root.getChildMeshes()) sg.addShadowCaster(m);
  const avatar = new AnimatorAvatar(`av${i}`, root, false);
  const src = anims.animationGroups.find((g) => g.name === clip)!;
  const g = avatar.retargetAnimationGroup(src, { mapNodeNames: UAL_TO_UBC, animationGroupName: `${clip}_${i}`, fixRootPosition: false });
  g.start(true, 1, g.from + ((i * 11) % Math.max(1, g.to - g.from)));
}
for (const g of anims.animationGroups) g.stop();
engine.runRenderLoop(() => scene.render());
let n = 0;
scene.onAfterRenderObservable.add(() => {
  if (++n === Number(P.get("frames") ?? 60)) (window as unknown as { __ready: boolean }).__ready = true;
});
