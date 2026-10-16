// Scene lighting: HDRI IBL, moonlight through the windows, shadowed
// chandelier spots, and many cheap clustered point lights (sconces, candles,
// footlights, cove wash).
import {
  Scene, Vector3, DirectionalLight, SpotLight, PointLight, ShadowGenerator, CubeTexture,
  ClusteredLightContainer, AbstractMesh, Light, Color3, RenderTargetTexture,
} from "@babylonjs/core";
import { Palette } from "../art/palette";
import { BuiltRoom } from "../level/build";
import { Preset } from "./quality";

export interface Lighting {
  moon: DirectionalLight;
  spots: SpotLight[];
  points: PointLight[];
  shadows: ShadowGenerator[];
  candles: PointLight[];
  apply(p: Preset): void;
  refreshShadows(): void;
  update(t: number): void;
}

export function setupLighting(scene: Scene, room: BuiltRoom, casters: AbstractMesh[]): Lighting {
  const env = CubeTexture.CreateFromPrefilteredData("./assets/env/ballroom_2k.env", scene);
  env.rotationY = Math.PI * 0.5;
  scene.environmentTexture = env;
  scene.environmentIntensity = 0.32;

  // moonlight: cool, low angle, from the west windows
  const moonDir = new Vector3(0.82, -0.42, 0.22).normalize();
  const moon = new DirectionalLight("moon", moonDir, scene);
  moon.position = new Vector3(-22, 12, -4);
  moon.diffuse = Palette.moon;
  moon.specular = Palette.moon.scale(0.25);
  moon.intensity = 24;
  moon.shadowMinZ = 1;
  moon.shadowMaxZ = 60;
  moon.autoUpdateExtends = false;
  moon.orthoLeft = -18;
  moon.orthoRight = 18;
  moon.orthoTop = 18;
  moon.orthoBottom = -18;

  // chandelier spots (shadowed on higher presets)
  const spots = room.chandeliers.map((p, i) => {
    const s = new SpotLight(`chand${i}`, p.add(new Vector3(0, -0.4, 0)), Vector3.Down(), 2.3, 1.6, scene);
    s.diffuse = Palette.tungsten;
    s.specular = Palette.tungsten;
    s.intensity = 220;
    s.range = 22;
    s.shadowMinZ = 0.3;
    s.shadowMaxZ = 16;
    return s;
  });

  // cheap lights → clustered
  const points: PointLight[] = [];
  const candles: PointLight[] = [];
  const mk = (name: string, pos: Vector3, color: Color3, intensity: number, range: number) => {
    const l = new PointLight(name, pos, scene);
    l.diffuse = color;
    l.specular = color;
    l.intensity = intensity;
    l.range = range;
    points.push(l);
    return l;
  };
  room.lights.forEach((s, i) => {
    switch (s.kind) {
      case "sconce": mk(`sconce${i}`, s.pos, Palette.tungsten, 7, 6); break;
      case "foot": mk(`foot${i}`, s.pos, Palette.glowWarm, 9, 7); break;
      case "cove": mk(`cove${i}`, s.pos.add(new Vector3(0, -1.2, 0)), Palette.tungsten, 7, 12); break;
      case "clock": mk(`clock${i}`, s.pos, Palette.glowWarm, 5, 4); break;
      case "candle": mk(`candle${i}`, s.pos, Palette.candle, 2, 3); break;
    }
  });
  room.candles.forEach((p, i) => candles.push(mk(`candle${i}`, p, Palette.candle, 3.5, 4)));
  // up-light from each chandelier onto the ceiling
  room.chandeliers.forEach((p, i) => {
    mk(`chandUpL${i}`, p.add(new Vector3(-2.8, 0.9, 0)), Palette.tungsten, 16, 8);
    mk(`chandUpR${i}`, p.add(new Vector3(2.8, 0.9, 0)), Palette.tungsten, 16, 8);
  });

  let cluster: ClusteredLightContainer | null = null;
  if (ClusteredLightContainer.IsLightSupported(points[0])) {
    cluster = new ClusteredLightContainer("cluster", points as Light[], scene);
  }

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
    refreshShadows() {
      for (const g of L.shadows) g.getShadowMap()!.resetRefreshCounter();
    },
    update(t: number) {
      // candle flicker (deterministic in time)
      candles.forEach((c, i) => {
        c.intensity = 3.5 * (0.85 + 0.1 * Math.sin(t * 9.1 + i * 1.7) + 0.05 * Math.sin(t * 23.3 + i));
      });
    },
  };
  void cluster;
  return L;
}
