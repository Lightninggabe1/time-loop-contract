// Scene lighting: HDRI IBL, moonlight through the windows, shadowed
// chandelier spots, and many cheap clustered point lights (sconces, candles,
// footlights, cove wash).
import {
  Scene, Vector3, DirectionalLight, SpotLight, PointLight, ShadowGenerator, CubeTexture,
  ClusteredLightContainer, AbstractMesh, Color3, RenderTargetTexture, MeshBuilder, Mesh,
} from "@babylonjs/core";
import { Palette } from "../art/palette";
import { mat } from "../art/materials";
import { BuiltWing, RoomsDelta, RoomDef } from "../level/build";
import type { LightSpot } from "../kit/modules";
import { Preset } from "./quality";

export interface Lighting {
  moon: DirectionalLight;
  spots: SpotLight[];
  points: PointLight[];
  shadows: ShadowGenerator[];
  candles: PointLight[];
  apply(p: Preset): void;
  /** Register moving meshes (NPCs, doors) so every room's lights affect them. */
  addDynamic(meshes: AbstractMesh[]): void;
  /** Lights, moon exclusions, key lights and shadow casters of newly built rooms (lightsDone: their point lights already exist). */
  addRooms(delta: RoomsDelta, lightsDone?: boolean): void;
  refreshShadows(): void;
  update(t: number): void;
}

/** Spare cluster slots for streamed rooms (the whole manor's worth). */
const SPARE_LIGHTS = 220;

export function setupLighting(scene: Scene, room: BuiltWing, casters: AbstractMesh[], keyRooms: { room: string; def: NonNullable<RoomDef["key"]> }[] = []): Lighting {
  const env = CubeTexture.CreateFromPrefilteredData("./assets/env/ballroom_2k.env", scene);
  env.rotationY = Math.PI * 0.5;
  scene.environmentTexture = env;
  scene.environmentIntensity = 0.32;

  // moonlight: cool, low angle, from the west windows
  const moonDir = new Vector3(0.82, -0.42, 0.22).normalize();
  const moon = new DirectionalLight("moon", moonDir, scene);
  moon.position = new Vector3(-22, 12, -4);
  moon.diffuse = Palette.moon;
  moon.specular = Palette.moon.scale(0.04);
  moon.intensity = 24;
  moon.shadowMinZ = 1;
  moon.shadowMaxZ = 60;
  moon.autoUpdateExtends = false;
  moon.orthoLeft = -18;
  moon.orthoRight = 18;
  moon.orthoTop = 18;
  moon.orthoBottom = -18;

  // outdoors gets its own, gentler moon (the interior one is strong enough to
  // throw window patches across the ballroom, which would bleach the terrace)
  const outdoor = room.roomMeshes.balcony ?? [];
  const moonOut = new DirectionalLight("moonOut", moonDir, scene);
  moonOut.position = moon.position.clone();
  moonOut.diffuse = Palette.moon;
  moonOut.specular = Palette.moon.scale(0.1);
  moonOut.intensity = 2.6;
  moonOut.shadowMinZ = 1;
  moonOut.shadowMaxZ = 60;
  moonOut.autoUpdateExtends = false;
  moonOut.orthoLeft = -14;
  moonOut.orthoRight = 14;
  moonOut.orthoTop = 14;
  moonOut.orthoBottom = -14;
  moonOut.includedOnlyMeshes = [...outdoor];
  moon.excludedMeshes = [...outdoor];

  // the visible moon sits exactly where the light comes from
  const moonDisc = MeshBuilder.CreateDisc("moon_disc", { radius: 4.2, tessellation: 40 }, scene);
  moonDisc.position = moonDir.scale(-140);
  moonDisc.billboardMode = Mesh.BILLBOARDMODE_ALL;
  moonDisc.material = mat("moonDisc");
  moonDisc.isPickable = false;

  // chandelier spots (shadowed on higher presets)
  const spots = room.chandeliers.map((p, i) => {
    const s = new SpotLight(`chand${i}`, p.add(new Vector3(0, -0.4, 0)), Vector3.Down(), 2.3, 1.6, scene);
    s.diffuse = Palette.tungsten;
    // big wide spots: keep their highlight from smearing across the glossy floor
    s.specular = Palette.tungsten.scale(0.12);
    s.intensity = 220;
    s.range = 22;
    s.shadowMinZ = 0.3;
    s.shadowMaxZ = 16;
    return s;
  });

  // cheap lights → one clustered container per room (WebGPU batches 32 lights;
  // more than one batch per container trips a validation bug, and lights in
  // other rooms are wasted work anyway)
  const points: PointLight[] = [];
  const candles: PointLight[] = [];
  const fires: PointLight[] = [];
  // Lights of rooms that stream in later take over spare lights made at start:
  // growing the cluster at runtime would re-create its light texture under
  // frozen materials (WebGPU then binds a dead texture).
  let cluster: ClusteredLightContainer | null = null;
  const spares: PointLight[] = [];
  const mk = (name: string, pos: Vector3, color: Color3, intensity: number, range: number, spec = 1) => {
    const l = spares.pop() ?? new PointLight(name, pos, scene);
    l.position.copyFrom(pos);
    l.diffuse = color;
    l.specular = color.scale(spec);
    l.intensity = intensity;
    l.range = range;
    (l as PointLight & { _tlcBase?: number })._tlcBase = intensity;
    if (!points.includes(l)) points.push(l);
    return l;
  };
  const addSpots = (list: LightSpot[], cands: Vector3[], base: number) => {
    list.forEach((s, j) => {
      const i = base + j;
      switch (s.kind) {
        case "sconce": mk(`sconce${i}`, s.pos, Palette.tungsten, 7, 6); break;
        case "foot": mk(`foot${i}`, s.pos, Palette.glowWarm, 9, 7); break;
        case "cove": mk(`cove${i}`, s.pos.add(new Vector3(0, -1.2, 0)), Palette.tungsten, 7, 12, 0.05); break;
        case "clock": mk(`clock${i}`, s.pos, Palette.glowWarm, 5, 4); break;
        case "candle": mk(`candle${i}`, s.pos, Palette.candle, 2, 3); break;
        case "fire": fires.push(mk(`fire${i}`, s.pos, Color3.FromHexString("#FF8A3A"), 9, 6)); break;
        case "lamp": mk(`lamp${i}`, s.pos, Palette.tungsten, 14, 7); break;
        case "green": mk(`green${i}`, s.pos, Palette.bankerGreen, 6, 4.5, 0.4); break;
        case "moonfill": mk(`moonfill${i}`, s.pos, Palette.moon, 4, 7, 0.1); break;
        case "garden": mk(`garden${i}`, s.pos, Palette.glowWarm, 18, 9, 0.3); break;
      }
    });
    cands.forEach((p, j) => candles.push(mk(`candle_t${base + j}`, p, Palette.candle, 3.5, 4)));
  };
  addSpots(room.lights, room.candles, 0);
  // up-light onto the ceiling, one per chandelier pair (no specular: it streaks across the glossy floor)
  room.chandeliers.forEach((p, i) => mk(`chandUp${i}`, p.add(new Vector3(0, 0.9, 0)), Palette.tungsten, 26, 10, 0.0));

  // One clustered container for the whole manor: tiles cull lights per pixel
  // region, so lights in other rooms cost almost nothing. (Note: glTF
  // transmission materials must not be used with it on WebGPU — see build.ts.)
  const clustered = points.length > 0 && ClusteredLightContainer.IsLightSupported(points[0]) && !new URLSearchParams(location.search).has("nocluster");
  if (clustered) {
    // spare slots for the rooms still to stream in (parked far away, dark, tiny range)
    for (let i = 0; i < SPARE_LIGHTS; i++) {
      const l = new PointLight(`spare${i}`, new Vector3(0, -500, 0), scene);
      l.intensity = 0;
      l.range = 0.01;
      spares.push(l);
    }
    cluster = new ClusteredLightContainer("cluster", [...points, ...spares], scene);
  }
  let lightCount = room.lights.length + room.candles.length;

  const ballroomMeshes = room.roomMeshes.ballroom ?? [];
  for (const s of spots) s.includedOnlyMeshes = [...ballroomMeshes];

  // Per-room shadowed key lights, made up front for every room that has one (adding a
  // light or a shadow generator after materials freeze breaks WebGPU bindings). Each
  // lights only its own room's static meshes, which join when the room streams in.
  const keys: { room: string; light: SpotLight; casters: AbstractMesh[]; gen: ShadowGenerator | null }[] = [];
  const nobody = MeshBuilder.CreateBox("keyNobody", { size: 0.001 }, scene);
  nobody.isVisible = false;
  nobody.isPickable = false;
  for (const kd of keyRooms) {
    const d = kd.def;
    const pos = new Vector3(...d.pos), dir = new Vector3(...d.target).subtract(pos).normalize();
    const l = new SpotLight(`key_${kd.room}`, pos, dir, d.angle, 1.4, scene);
    l.diffuse = Palette.tungsten;
    l.specular = Palette.tungsten.scale(0.2);
    l.intensity = d.intensity;
    l.range = d.range;
    l.shadowMinZ = 0.3;
    l.shadowMaxZ = d.range;
    l.includedOnlyMeshes = [nobody];
    keys.push({ room: kd.room, light: l, casters: [], gen: null });
  }
  const keyShadow = (k: (typeof keys)[number], p: Preset) => {
    k.light.shadowEnabled = p.name !== "low";
    k.gen = null;
    if (!k.light.shadowEnabled) return null;
    const g = new ShadowGenerator(p.name === "high" ? 2048 : 1024, k.light);
    g.usePercentageCloserFiltering = true;
    g.filteringQuality = ShadowGenerator.QUALITY_LOW;
    g.bias = 0.0006;
    g.normalBias = 0.015;
    for (const c of k.casters) g.addShadowCaster(c, false);
    g.getShadowMap()!.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    k.gen = g;
    return g;
  };
  let shadows: ShadowGenerator[] = [];
  const L: Lighting = {
    moon, spots, points, candles, shadows,
    apply(p: Preset) {
      for (const g of shadows) g.dispose();
      shadows = [];
      const sm = new ShadowGenerator(p.moonShadow, moon);
      sm.usePercentageCloserFiltering = true;
      sm.filteringQuality = p.name === "low" ? ShadowGenerator.QUALITY_LOW : ShadowGenerator.QUALITY_MEDIUM;
      sm.bias = 0.0008;
      sm.normalBias = 0.02;
      sm.darkness = 0.0;
      for (const c of casters) sm.addShadowCaster(c, false);
      shadows.push(sm);
      const so = new ShadowGenerator(p.name === "low" ? 1024 : 2048, moonOut);
      so.usePercentageCloserFiltering = true;
      so.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
      so.bias = 0.0008;
      so.normalBias = 0.02;
      for (const c of casters) so.addShadowCaster(c, false);
      shadows.push(so);
      // centre chandelier first
      const order = [1, 0, 2].filter((i) => i < spots.length);
      spots.forEach((s) => (s.shadowEnabled = false));
      for (let k = 0; k < p.spotShadows && k < order.length; k++) {
        const s = spots[order[k]];
        s.shadowEnabled = true;
        const g = new ShadowGenerator(p.spotShadowSize, s);
        g.usePercentageCloserFiltering = true;
        g.filteringQuality = ShadowGenerator.QUALITY_LOW;
        g.bias = 0.0006;
        g.normalBias = 0.015;
        for (const c of casters) {
          if (c.name.startsWith("Chandelier")) continue;
          g.addShadowCaster(c, false);
        }
        shadows.push(g);
      }
      for (const k of keys) {
        const g = keyShadow(k, p);
        if (g) shadows.push(g);
      }
      // the room is static: render shadow maps once (re-armed by refreshShadows)
      for (const g of shadows) g.getShadowMap()!.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      L.shadows = shadows;
    },
    addDynamic(meshes: AbstractMesh[]) {
      for (const s of spots) s.includedOnlyMeshes.push(...meshes);
      // (not the room key lights: a moving mesh under every shadowed light would blow
      // WebGPU's 16-varying limit; people are lit by the cheap lights and the IBL)

    },
    addRooms(delta: RoomsDelta, lightsDone = false) {
      if (!lightsDone) {
        if (cluster && delta.lights.length + delta.candles.length > spares.length) console.warn(`light pool short by ${delta.lights.length + delta.candles.length - spares.length}`);
        addSpots(delta.lights, delta.candles, lightCount);
        lightCount += delta.lights.length + delta.candles.length;
      }
      if (delta.noMoon.length) moon.excludedMeshes.push(...delta.noMoon);
      for (const kd of delta.keys) {
        const k = keys.find((x) => x.room === kd.room);
        if (!k) continue;
        k.light.includedOnlyMeshes.push(...kd.meshes);
        const add = kd.meshes.filter((m) => !m.name.startsWith("Chandelier"));
        k.casters.push(...add);
        for (const c of add) k.gen?.addShadowCaster(c, false);
      }
      casters.push(...delta.casters.filter((c) => !casters.includes(c)));
      for (const g of L.shadows) {
        if (g.getLight() instanceof SpotLight) continue; // chandelier spots light the ballroom only
        for (const c of delta.casters) g.addShadowCaster(c, false);
      }
      L.refreshShadows();
    },
    refreshShadows() {
      for (const g of L.shadows) g.getShadowMap()!.resetRefreshCounter();
    },
    update(t: number) {
      // candle flicker (deterministic in time)
      candles.forEach((c, i) => {
        c.intensity = 3.5 * (0.85 + 0.1 * Math.sin(t * 9.1 + i * 1.7) + 0.05 * Math.sin(t * 23.3 + i));
      });
      fires.forEach((c, i) => {
        c.intensity = 9 * (0.8 + 0.12 * Math.sin(t * 7.3 + i) + 0.08 * Math.sin(t * 17.9 + i * 2.1));
      });
    },
  };
  return L;
}
