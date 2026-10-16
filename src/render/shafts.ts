// Fake volumetric moonlight: additive slices swept from each window opening
// along the moon direction, plus slow dust motes. No custom shaders, so it
// runs identically on WebGPU and WebGL2.
import {
  Scene, Vector3, Mesh, VertexData, StandardMaterial, RawTexture, Constants, Color3,
  ParticleSystem, Color4, BoxParticleEmitter, Texture, FresnelParameters,
} from "@babylonjs/core";
import { BuiltRoom } from "../level/build";

function gradientTexture(scene: Scene) {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  let seed = 7;
  const streak: number[] = [];
  for (let i = 0; i < S; i++) streak.push((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < S; y++) {
    const v = y / (S - 1);
    const edge = Math.pow(Math.sin(v * Math.PI), 1.6);
    const s = 0.7 + 0.3 * (streak[y] * 0.6 + streak[(y + 3) % S] * 0.4);
    for (let x = 0; x < S; x++) {
      const u = x / (S - 1);
      const along = Math.pow(1 - u, 1.6) * Math.min(1, u * 10);
      const a = along * edge * s;
      const i = (y * S + x) * 4;
      data[i] = 158 * a;
      data[i + 1] = 184 * a;
      data[i + 2] = 255 * a;
      data[i + 3] = 255;
    }
  }
  const t = RawTexture.CreateRGBATexture(data, S, S, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE;
  return t;
}

function dot(scene: Scene) {
  const S = 32;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2);
      const a = Math.max(0, 1 - d) ** 2;
      const i = (y * S + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = 255 * a;
    }
  const t = RawTexture.CreateRGBATexture(data, S, S, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  t.hasAlpha = true;
  return t;
}

export function createShafts(scene: Scene, room: BuiltRoom, lightDir: Vector3, intensity = 0.7) {
  const m = new StandardMaterial("shaft", scene);
  m.disableLighting = true;
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  // NB: StandardMaterial *adds* the emissive texture (× level) to emissiveColor
  const grad = gradientTexture(scene);
  grad.level = intensity;
  m.emissiveTexture = grad;
  m.emissiveColor = Color3.Black();
  m.alphaMode = Constants.ALPHA_ADD;
  m.alpha = 0.999;
  m.backFaceCulling = false;
  m.disableDepthWrite = true;
  m.fogEnabled = false;
  // slices fade when seen edge-on, hiding their hard borders
  m.emissiveFresnelParameters = new FresnelParameters({ leftColor: Color3.White(), rightColor: Color3.Black(), power: 1.6, bias: 0 });

  const L = lightDir.normalize();
  const len = 18;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const quad = (a: Vector3, b: Vector3) => {
    const base = pos.length / 3;
    const c = b.add(L.scale(len)), d = a.add(L.scale(len));
    for (const p of [a, b, c, d]) pos.push(p.x, p.y, p.z);
    uv.push(0, 0, 0, 1, 1, 1, 1, 0);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const w of room.windows) {
    const up = Vector3.Up();
    const along = Vector3.Cross(up, w.normal).normalize();
    const cy = (w.bottom + w.top) / 2;
    const at = (s: number, y: number) => w.center.add(along.scale(s)).add(up.scale(y - cy));
    for (const s of [-0.3, 0, 0.3]) quad(at(s * w.width, w.bottom + 0.1), at(s * w.width, w.top - 0.1));
    quad(at(-w.width / 2 + 0.1, (w.bottom + w.top) / 2), at(w.width / 2 - 0.1, (w.bottom + w.top) / 2));
  }
  const mesh = new Mesh("shafts", scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.uvs = uv;
  vd.indices = idx;
  vd.normals = new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0));
  vd.applyToMesh(mesh);
  mesh.material = m;
  mesh.isPickable = false;
  mesh.alphaIndex = 10;
  mesh.freezeWorldMatrix();

  // dust motes drifting in the shafts
  let dust: ParticleSystem | null = null;
  const enableDust = (on: boolean) => {
    if (!on) {
      dust?.dispose();
      dust = null;
      return;
    }
    if (dust) return;
    dust = new ParticleSystem("dust", 400, scene);
    dust.particleTexture = dot(scene);
    const em = new BoxParticleEmitter();
    em.minEmitBox = new Vector3(-9.5, 0.3, -11);
    em.maxEmitBox = new Vector3(-1, 6.5, 11);
    em.direction1 = new Vector3(-0.05, -0.02, -0.05);
    em.direction2 = new Vector3(0.05, 0.03, 0.05);
    dust.particleEmitterType = em;
    dust.emitter = Vector3.Zero();
    dust.minSize = 0.012;
    dust.maxSize = 0.03;
    dust.minLifeTime = 8;
    dust.maxLifeTime = 14;
    dust.emitRate = 30;
    dust.minEmitPower = 0.05;
    dust.maxEmitPower = 0.15;
    dust.color1 = new Color4(0.5, 0.56, 0.7, 0.35);
    dust.color2 = new Color4(0.7, 0.62, 0.5, 0.25);
    dust.colorDead = new Color4(0, 0, 0, 0);
    dust.blendMode = ParticleSystem.BLENDMODE_ADD;
    dust.preWarmCycles = 200;
    dust.preWarmStepOffset = 5;
    dust.start();
  };
  // Fade out as the viewer walks into the beams (overlapping slices would
  // otherwise wash the view out). Distance is measured from the window wall.
  const wallX = room.windows.length ? room.windows[0].center.x : 0;
  const update = (cam: Vector3) => {
    const d = Math.abs(cam.x - wallX);
    const k = Math.min(1, Math.max(0, (d - 3) / 7));
    grad.level = intensity * (0.15 + 0.85 * k * k);
  };
  return { mesh, enableDust, update };
}
