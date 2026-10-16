// Scene lighting: HDRI IBL, moonlight through the windows, shadowed
// chandelier spots, and many cheap clustered point lights (sconces, candles,
// footlights, cove wash).
import {
  Scene, Vector3, DirectionalLight, SpotLight, PointLight, ShadowGenerator, CubeTexture,
  ClusteredLightContainer, AbstractMesh, Color3, RenderTargetTexture, MeshBuilder, Mesh,
} from "@babylonjs/core";
import { Palette } from "../art/palette";
import { mat } from "../art/materials";
import { BuiltWing } from "../level/build";
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
  refreshShadows(): void;
  update(t: number): void;
}

export function setupLighting(scene: Scene, room: BuiltWing, casters: AbstractMesh[]): Lighting {
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
  // lights start "parked" (not in the scene); the cluster adopts the ones it needs
  const mk = (name: string, pos: Vector3, color: Color3, intensity: number, range: number, spec = 1, kind = "misc") => {
    const l = new PointLight(name, pos, scene);
    l.diffuse = color;
    l.specular = color.scale(spec);
    l.intensity = intensity;
    l.range = range;
    points.push(l);
    void kind;
    return l;
  };
  room.lights.forEach((s, i) => {
    switch (s.kind) {
      case "sconce": mk(`sconce${i}`, s.pos, Palette.tungsten, 7, 6, 1, "sconce"); break;
      case "foot": mk(`foot${i}`, s.pos, Palette.glowWarm, 9, 7, 1, "foot"); break;
      case "cove": mk(`cove${i}`, s.pos.add(new Vector3(0, -1.2, 0)), Palette.tungsten, 7, 12, 0.05, "cove"); break;
      case "clock": mk(`clock${i}`, s.pos, Palette.glowWarm, 5, 4, 1, "clock"); break;
      case "candle": mk(`candle${i}`, s.pos, Palette.candle, 2, 3, 1, "candle"); break;
      case "fire": fires.push(mk(`fire${i}`, s.pos, Color3.FromHexString("#FF8A3A"), 9, 6, 1, "fire")); break;
      case "lamp": mk(`lamp${i}`, s.pos, Palette.tungsten, 14, 7, 1, "lamp"); break;
      case "garden": mk(`garden${i}`, s.pos, Palette.glowWarm, 18, 9, 0.3, "garden"); break;
    }
  });
  room.candles.forEach((p, i) => candles.push(mk(`candle${i}`, p, Palette.candle, 3.5, 4, 1, "candle")));
  // up-light onto the ceiling, one per chandelier pair (no specular: it streaks across the glossy floor)
  room.chandeliers.forEach((p, i) => mk(`chandUp${i}`, p.add(new Vector3(0, 0.9, 0)), Palette.tungsten, 26, 10, 0.0, "chandUp"));

  // One clustered container for the whole wing: tiles cull lights per pixel
  // region, so lights in other rooms cost almost nothing. (Note: glTF
  // transmission materials must not be used with it on WebGPU — see build.ts.)
  const clustered = points.length > 0 && ClusteredLightContainer.IsLightSupported(points[0]) && !new URLSearchParams(location.search).has("nocluster");
  if (clustered) new ClusteredLightContainer("cluster", points, scene);

  const ballroomMeshes = room.roomMeshes.ballroom ?? [];
  for (const s of spots) s.includedOnlyMeshes = [...ballroomMeshes];

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
      // the room is static: render shadow maps once (re-armed by refreshShadows)
      for (const g of shadows) g.getShadowMap()!.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      L.shadows = shadows;
    },
    addDynamic(meshes: AbstractMesh[]) {
      for (const s of spots) s.includedOnlyMeshes.push(...meshes);

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
