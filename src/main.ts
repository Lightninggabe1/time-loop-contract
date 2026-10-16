import {
  Engine, WebGPUEngine, AbstractEngine, Scene, Color4, Color3, Vector3, HavokPlugin, Quaternion, Plane,
} from "@babylonjs/core";
import { MeshoptCompression } from "@babylonjs/core/Meshes/Compression/meshoptCompression";
import HavokPhysics from "@babylonjs/havok";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";

import layoutJson from "./level/layouts/ballroom.json";
import { buildRoom, Layout } from "./level/build";
import { initMaterials, freezeMaterials } from "./art/materials";
import { setupLighting } from "./render/lighting";
import { Post } from "./render/pipeline";
import { createShafts } from "./render/shafts";
import { Mirrors } from "./render/mirrors";
import { PRESETS, Quality, initialQuality, saveQuality, savedQuality, stepDown } from "./render/quality";
import { Input } from "./player/input";
import { Player, addStaticColliders } from "./player/player";
import { buildNavMesh } from "./nav/navmesh";
import { Hud } from "./ui/hud";

const params = new URLSearchParams(location.search);
const shot = params.get("shot");
const debug = window as unknown as Record<string, unknown>;
debug.__errors = [];
addEventListener("error", (e) => (debug.__errors as string[]).push(String(e.message)));
addEventListener("unhandledrejection", (e) => (debug.__errors as string[]).push(String(e.reason)));
if (shot) document.body.classList.add("shot");

MeshoptCompression.Configuration.decoder.url = new URL("./vendor/meshopt_decoder.js", location.href).href;

const loadbar = document.getElementById("loadbar")!;
const loadmsg = document.getElementById("loadmsg")!;
const progress = (p: number, msg: string) => {
  loadbar.style.width = `${Math.round(p * 100)}%`;
  loadmsg.textContent = msg;
};

async function createEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
  const want = params.get("engine");
  if (want !== "webgl" && (await WebGPUEngine.IsSupportedAsync)) {
    try {
      const e = new WebGPUEngine(canvas, { antialias: false, adaptToDeviceRatio: false, powerPreference: "high-performance" });
      await e.initAsync();
      return e;
    } catch (err) {
      console.warn("WebGPU init failed, falling back to WebGL2", err);
    }
  }
  return new Engine(canvas, false, { stencil: true, antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: !!shot }, false);
}

async function main() {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  progress(0.05, "Waking the orchestra…");
  const [engine, havok] = await Promise.all([createEngine(canvas), HavokPhysics({ locateFile: () => havokWasmUrl })]);
  debug.__engine = engine.isWebGPU ? "webgpu" : "webgl2";

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.02, 0.015, 0.02, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.011;
  scene.fogColor = new Color3(0.09, 0.06, 0.06);
  scene.skipPointerMovePicking = true;
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));

  initMaterials(scene);
  progress(0.15, "Polishing the chandeliers…");
  const layout = layoutJson as unknown as Layout;
  const room = await buildRoom(scene, layout);
  progress(0.7, "Chilling the champagne…");

  const hud = new Hud();
  const input = new Input(canvas, document.getElementById("stick")!);
  const spawn = new Vector3(...layout.spawn.pos);
  const player = new Player(scene, input, spawn, (layout.spawn.yaw * Math.PI) / 180);
  scene.activeCamera = player.camera;
  addStaticColliders(scene, room.colliders);
  hud.bindInput(input);

  const lighting = setupLighting(scene, room, room.casters);
  const shafts = createShafts(scene, room, lighting.moon.direction.clone());
  const post = new Post(scene, player.camera);
  const mirrors = new Mirrors(scene, new Plane(1, 0, 0, -(layout.size[0] / 2 - 0.035)));

  let quality: Quality = initialQuality();
  const applyQuality = (q: Quality) => {
    quality = q;
    const p = PRESETS[q];
    const dpr = Math.min(devicePixelRatio || 1, p.maxDpr) * p.renderScale;
    engine.setHardwareScalingLevel(1 / dpr);
    lighting.apply(p);
    post.apply(p);
    shafts.enableDust(p.dust);
    mirrors.apply(p);
    // keep additive/transparent effects out of the SSR/SSAO prepass
    const pre = scene.prePassRenderer;
    if (pre) for (const m of [shafts.mesh.material!, ...scene.materials.filter((x) => x.alpha < 1)]) if (!pre.excludedMaterials.includes(m)) pre.excludedMaterials.push(m);
    hud.setQuality(q);
  };
  hud.onQuality = (q) => {
    saveQuality(q);
    applyQuality(q);
  };
  applyQuality(quality);

  freezeMaterials();
  progress(0.85, "Compiling shaders…");
  await scene.whenReadyAsync();

  // game clock: 6 PM → midnight over 9 real minutes
  const LOOP_SECONDS = 9 * 60;
  let t = 0;
  const setClock = (seconds: number) => {
    const gameMin = 18 * 60 + (seconds / LOOP_SECONDS) * 360;
    const h = Math.floor(gameMin / 60), m = Math.floor(gameMin % 60);
    hud.setTime(h, m);
    if (room.clockHands && room.clock) {
      const n = room.clock.normal.scale(-1);
      const base = Quaternion.FromLookDirectionLH(n, Vector3.Up());
      const roll = (a: number) => base.multiply(Quaternion.RotationAxis(new Vector3(0, 0, 1), -a));
      room.clockHands.minute.rotationQuaternion = roll(((gameMin % 60) / 60) * Math.PI * 2);
      room.clockHands.hour.rotationQuaternion = roll((((gameMin / 60) % 12) / 12) * Math.PI * 2);
    }
  };
  setClock(0);

  // screenshot mode: fixed camera at a preset spot
  if (shot) {
    const s = layout.shots.find((x) => x.name === shot) ?? layout.shots[0];
    player.enabled = false;
    player.camera.position.set(...s.pos);
    player.camera.setTarget(new Vector3(...s.target));
    player.camera.fov = player.baseFov();
    if (params.has("time")) setClock(Number(params.get("time")));
  }

  const frameTimes: number[] = [];
  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    if (!shot) {
      t = (t + dt) % LOOP_SECONDS;
      setClock(t);
      player.update(dt);
    }
    lighting.update(shot ? 1 : performance.now() / 1000);
    shafts.update(scene.activeCamera!.position);
  });
  let last = performance.now();
  const loop = () => {
    scene.render();
    const now = performance.now();
    frameTimes.push(now - last);
    if (frameTimes.length > 240) frameTimes.shift();
    last = now;
  };
  engine.runRenderLoop(loop);
  addEventListener("resize", () => engine.resize());

  /** Uncapped frame cost: render n frames back-to-back and wait for the GPU. */
  const bench = async (n = 60) => {
    engine.stopRenderLoop(loop);
    await new Promise((r) => setTimeout(r, 50));
    const flush = async () => {
      if (engine.isWebGPU) await (engine as unknown as { _device: GPUDevice })._device.queue.onSubmittedWorkDone();
      else {
        const gl = (engine as Engine)._gl;
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      }
    };
    const frame = () => {
      engine.beginFrame();
      scene.render();
      engine.endFrame();
    };
    for (let i = 0; i < 5; i++) frame();
    await flush();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      frame();
      if (i % 10 === 9) await flush();
    }
    await flush();
    const ms = (performance.now() - t0) / n;
    engine.runRenderLoop(loop);
    return ms;
  };

  const avg = (n: number) => {
    const s = frameTimes.slice(-n);
    return s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  };
  setInterval(() => hud.setFps(avg(60), quality, debug.__engine as string), 500);

  progress(1, "Doors open");
  document.getElementById("loading")!.classList.add("done");
  hud.show();

  // probe: step down quality automatically if the device struggles
  if (!savedQuality() && !shot) {
    setTimeout(() => {
      const next = stepDown(quality, avg(90));
      if (next) applyQuality(next);
      setTimeout(() => {
        const next2 = stepDown(quality, avg(90));
        if (next2) applyQuality(next2);
      }, 2500);
    }, 2500);
  }

  // navmesh in the background (deviations only)
  buildNavMesh(scene, room.colliders)
    .then(() => (debug.__nav = true))
    .catch((e) => console.error("navmesh failed", e));

  // hooks for the Playwright harness
  debug.__game = {
    scene, engine, player, room, post, mirrors, lighting, PRESETS,
    setQuality: (q: Quality) => applyQuality(q),
    avgFrame: (n = 120) => avg(n),
    bench,
    measure: async (frames = 120) => {
      const start = frameTimes.length;
      await new Promise<void>((res) => {
        const check = () => (frameTimes.length - start >= Math.min(frames, 200) ? res() : requestAnimationFrame(check));
        check();
      });
      return avg(frames);
    },
  };
  let settled = 0;
  scene.onAfterRenderObservable.add(() => {
    if (++settled === 40) debug.__ready = true;
  });
}

main().catch((e) => {
  console.error(e);
  progress(1, "Something went wrong — please reload");
});
