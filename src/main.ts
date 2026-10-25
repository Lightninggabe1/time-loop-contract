import {
  Engine, WebGPUEngine, AbstractEngine, Scene, Color4, Color3, Vector3, HavokPlugin, Quaternion, Plane, Material,
} from "@babylonjs/core";
import { MeshoptCompression } from "@babylonjs/core/Meshes/Compression/meshoptCompression";
import HavokPhysics from "@babylonjs/havok";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";

import wingJson from "./level/layouts/wing.json";
import { createWing, buildRooms, WingDef, RoomDef } from "./level/build";
import { Doors } from "./level/doors";
import { initMaterials, freezeMaterials } from "./art/materials";
import { setupLighting } from "./render/lighting";
import { Post } from "./render/pipeline";
import { createShafts } from "./render/shafts";
import { Mirrors } from "./render/mirrors";
import { PRESETS, Quality, initialQuality, isMobile, saveQuality, savedQuality, stepDown } from "./render/quality";
import { Input } from "./player/input";
import { Player, addStaticColliders } from "./player/player";
import { buildNavMesh } from "./nav/navmesh";
import { Hud } from "./ui/hud";
import { HeistClient } from "./game/heist-client";

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
// If loading stalls (slow phone GPU), offer the simpler renderer after a while.
let stallTimer = 0;
const armStall = () => {
  clearTimeout(stallTimer);
  stallTimer = window.setTimeout(() => {
    if (document.getElementById("stall")) return;
    const a = document.createElement("a");
    a.id = "stall";
    a.href = `${location.pathname}?engine=webgl&quality=low`;
    a.textContent = "Taking a while? Tap here for the lighter version";
    loadmsg.after(a);
  }, 25000);
};
const progress = (p: number, msg: string) => {
  armStall();
  loadbar.style.width = `${Math.round(p * 100)}%`;
  loadmsg.textContent = msg;
};

async function createEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
  // Phones default to WebGL2: mature, and much quicker to compile shaders than
  // mobile WebGPU, which could sit on "Compiling shaders" for minutes.
  const want = params.get("engine") ?? (isMobile() ? "webgl" : "webgpu");
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

  // the GPU can reset under memory pressure on phones: come back on the lighter renderer
  engine.onContextLostObservable.add(() => {
    if (params.get("engine") !== "webgl") location.replace(`${location.pathname}?engine=webgl&quality=low`);
  });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.02, 0.015, 0.02, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.011;
  scene.fogColor = new Color3(0.09, 0.06, 0.06);
  scene.skipPointerMovePicking = true;
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));

  initMaterials(scene);
  progress(0.15, "Polishing the chandeliers…");
  const layout = wingJson as unknown as WingDef;
  const room = createWing(scene, layout);
  // the starting rooms come first; screenshot mode builds everything up front
  const startIds = layout.rooms.filter((r) => shot || r.zone === "start").map((r) => r.id);
  const bootRooms = await buildRooms(scene, layout, startIds, room);
  const doors = new Doors(scene, room.doors);
  // a door stays shut while the room on either side of it is still streaming in
  const doorRooms = new Map<string, RoomDef[]>();
  const sidesOf = (id: string) => {
    let r = doorRooms.get(id);
    if (!r) {
      const d = room.doors.find((x) => x.spec.id === id)!;
      const h = d.spec.hinge, mid = h.length > 1 ? h[0].add(h[1]).scale(0.5) : h[0];
      const n = new Vector3(Math.sin(d.spec.rotY), 0, Math.cos(d.spec.rotY));
      r = [room.roomOf(mid.add(n.scale(1.2))), room.roomOf(mid.subtract(n.scale(1.2)))].filter((x): x is RoomDef => !!x);
      doorRooms.set(id, r);
    }
    return r;
  };
  doors.blocked = (id) => sidesOf(id).some((r) => !room.built.has(r.id) || streaming.has(r.id));
  const streaming = new Set<string>();
  for (const id of doors.ids()) doors.setOpen(id, id !== "study", true);
  progress(0.7, "Chilling the champagne…");

  const hud = new Hud();
  const input = new Input(canvas, document.getElementById("stick")!);
  const spawn = new Vector3(...layout.spawn.pos);
  const player = new Player(scene, input, spawn, (layout.spawn.yaw * Math.PI) / 180);
  scene.activeCamera = player.camera;
  addStaticColliders(scene, room.colliders);
  hud.bindInput(input);

  const lighting = setupLighting(scene, room, room.casters, layout.rooms.filter((r) => r.key).map((r) => ({ room: r.id, def: r.key! })));
  lighting.addRooms(bootRooms, true);
  lighting.addDynamic(room.doors.flatMap((d) => d.pivots.flatMap((p) => p.getChildMeshes())));
  const shafts = createShafts(scene, room, lighting.moon.direction.clone());
  const post = new Post(scene, player.camera);
  const mirrors = new Mirrors(scene, new Plane(1, 0, 0, -(10 - 0.035)));

  // Unlit, additive and transparent materials stay out of the SSR/SSAO
  // prepass (WGSL prepass shaders need lit normals). Also catches materials
  // created later (NPC blobs, icons, effects).
  const skipPrepass = (m: Material) => {
    const anyM = m as unknown as { disableLighting?: boolean; alphaMode?: number };
    return m.alpha < 1 || !!anyM.disableLighting || m.needAlphaBlending?.() === true || m === shafts.mesh.material;
  };
  const excludeFromPrepass = () => {
    const pre = scene.prePassRenderer;
    if (!pre) return;
    for (const m of scene.materials) if (skipPrepass(m) && !pre.excludedMaterials.includes(m)) pre.excludedMaterials.push(m);
  };
  scene.onNewMaterialAddedObservable.add(() => setTimeout(excludeFromPrepass, 0));

  let quality: Quality = initialQuality();
  let booted = false;
  const applyQuality = (q: Quality) => {
    quality = q;
    // frozen materials would keep binding the old shadow maps: thaw, switch, re-freeze
    for (const m of scene.materials) m.unfreeze();
    const p = PRESETS[q];
    const dpr = Math.min(devicePixelRatio || 1, p.maxDpr) * p.renderScale;
    engine.setHardwareScalingLevel(1 / dpr);
    lighting.apply(p);
    post.apply(p);
    shafts.enableDust(p.dust);
    mirrors.apply(p);
    excludeFromPrepass();
    hud.setQuality(q);
    scene.markAllMaterialsAsDirty(1 /* all */);
    if (booted) scene.whenReadyAsync().then(() => freezeMaterials());
  };
  hud.onQuality = (q) => {
    saveQuality(q);
    applyQuality(q);
  };
  applyQuality(quality);

  freezeMaterials();
  booted = true;
  progress(0.85, "Compiling shaders…");
  // Don't wait forever: after 10 s start anyway (anything unfinished pops in a moment later)
  const meshes = scene.meshes.filter((m) => m.isEnabled() && m.isVisible && m.subMeshes?.length);
  const tick = setInterval(() => {
    const done = meshes.filter((m) => m.isReady(true)).length;
    progress(0.85 + 0.1 * (done / Math.max(1, meshes.length)), `Compiling shaders… ${Math.round((100 * done) / Math.max(1, meshes.length))}%`);
  }, 400);
  await Promise.race([scene.whenReadyAsync(), new Promise((r) => setTimeout(r, 10000))]);
  clearInterval(tick);

  // the tower clock: one minute to midnight
  let t = 0;
  const setClock = (seconds: number) => {
    const gameMin = 23 * 60 + 59 + Math.min(60, seconds) / 60;
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

  // the game: rules (src/core/heist) + presentation (actors, HUD)
  const game = shot && !params.has("cast") ? null : new HeistClient(scene, room, doors, player, input, lighting);
  const castLoad = game ? game.loadCast().then(excludeFromPrepass).catch((e) => console.error("cast failed", e)) : Promise.resolve();
  debug.__client = game;
  const muteBtn = document.getElementById("mute");
  if (game && muteBtn) {
    const label = () => (muteBtn.textContent = `Sound: ${game.audio.muted ? "off" : "on"}`);
    label();
    muteBtn.addEventListener("click", () => (game.audio.toggleMute(), label()));
  }

  const frameTimes: number[] = [];
  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    if (!shot) {
      player.update(dt);
      if (game) {
        game.update(dt);
        t = game.round.seconds;
      } else t = (t + dt) % 60;
      setClock(t);
    }
    lighting.update(shot ? 1 : performance.now() / 1000);
    doors.update(dt);
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

  // people load behind the briefing card; screenshot runs with a cast wait for everyone
  progress(0.95, "Seating the guests…");
  await Promise.race([castLoad, new Promise((r) => setTimeout(r, shot ? 60000 : 1500))]);
  progress(1, "Doors open");
  clearTimeout(stallTimer);
  document.getElementById("loading")!.classList.add("done");
  hud.show();

  // probe: step down quality automatically if the device struggles
  if (!savedQuality() && !shot) {
    // median of recent frames ignores hitches; step down only if two windows in a
    // row are slow (textures and shaders may still be streaming in at first)
    const median = (n: number) => {
      const xs = frameTimes.slice(-n).sort((a, b) => a - b);
      return xs[Math.floor(xs.length / 2)] ?? 0;
    };
    let strikes = 0;
    const probe = () => {
      if (game?.ui && (game.ui.open || document.hidden)) return setTimeout(probe, 2000);
      const next = stepDown(quality, median(120));
      strikes = next ? strikes + 1 : 0;
      if (next && strikes >= 2) {
        applyQuality(next);
        strikes = 0;
      }
      if (quality !== "low") setTimeout(probe, 3000);
    };
    setTimeout(probe, 7000);
  }

  // stream the remaining rooms in, nearest first, while the intro card is up
  const pending = layout.rooms.filter((r) => !room.built.has(r.id));
  const zoneInfo = { loaded: [...room.built], pending: pending.length };
  debug.__zones = zoneInfo;
  const centre = (r: RoomDef) => new Vector3((r.bounds[0] + r.bounds[2]) / 2, 0, (r.bounds[1] + r.bounds[3]) / 2);
  const streamRooms = async () => {
    while (pending.length) {
      const me = player.camera.position;
      pending.sort((a, b) => Vector3.Distance(centre(a), me) - Vector3.Distance(centre(b), me));
      const next = pending.shift()!;
      streaming.add(next.id);
      await new Promise((r) => setTimeout(r, 30)); // let a frame through between rooms
      const delta = await buildRooms(scene, layout, [next.id], room);
      doors.add(delta.doors);
      lighting.addDynamic(delta.doors.flatMap((d) => d.pivots.flatMap((p) => p.getChildMeshes())));
      lighting.addRooms(delta);
      addStaticColliders(scene, delta.colliders);
      excludeFromPrepass();
      // compile its shaders before anyone can see in (the doors stay shut until then)
      const meshes = delta.meshes.filter((m) => m.subMeshes?.length);
      const t0 = performance.now();
      while (meshes.some((m) => !m.isReady(true)) && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
      freezeMaterials();
      streaming.delete(next.id);
      zoneInfo.loaded.push(next.id);
      zoneInfo.pending = pending.length;
      for (const id of doors.ids()) if (sidesOf(id).some((r) => r.id === next.id)) doors.setOpen(id, doors.isOpen(id) || id !== "study");
    }
  };
  // navmesh (deviations only) once every room is in
  streamRooms()
    .then(() => buildNavMesh(scene, room.colliders))
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
    if (++settled >= 40 && !debug.__ready && (!game || game.isReady)) debug.__ready = true;
  });
}

main().catch((e) => {
  console.error(e);
  progress(1, "Something went wrong — please reload");
});
