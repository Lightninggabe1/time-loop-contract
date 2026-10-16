// Post-processing stack per preset: SSAO → SSR → (bloom, ACES, grading,
// vignette, grain, AA) in the default pipeline.
import {
  Scene, Camera, DefaultRenderingPipeline, SSAO2RenderingPipeline, SSRRenderingPipeline,
  ImageProcessingConfiguration, ColorCurves, Color4,
} from "@babylonjs/core";
import { Preset } from "./quality";

export class Post {
  private scene: Scene;
  private camera: Camera;
  ssao?: SSAO2RenderingPipeline;
  ssr?: SSRRenderingPipeline;
  def?: DefaultRenderingPipeline;

  constructor(scene: Scene, camera: Camera) {
    this.scene = scene;
    this.camera = camera;
  }

  apply(p: Preset) {
    this.dispose();
    const { scene, camera } = this;

    if (p.ssao) {
      const ssao = new SSAO2RenderingPipeline("ssao", scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [camera], false);
      ssao.radius = 0.9;
      ssao.totalStrength = 1.1;
      ssao.base = 0.12;
      ssao.samples = p.ssaoSamples;
      ssao.maxZ = 40;
      ssao.minZAspect = 0.4;
      ssao.expensiveBlur = false;
      this.ssao = ssao;
    }

    if (p.reflections) {
      const ssr = new SSRRenderingPipeline("ssr", scene, [camera], false);
      ssr.thickness = 0.4;
      ssr.selfCollisionNumSkip = 2;
      ssr.enableAutomaticThicknessComputation = false;
      ssr.blurDispersionStrength = 0.03;
      ssr.roughnessFactor = 0.15;
      ssr.reflectivityThreshold = 0.08;
      ssr.strength = 0.9;
      ssr.reflectionSpecularFalloffExponent = 1.6;
      ssr.maxDistance = 30;
      ssr.maxSteps = p.name === "high" ? 90 : 60;
      ssr.step = p.name === "high" ? 0.12 : 0.18;
      ssr.useFresnel = true;
      ssr.ssrDownsample = 1;
      ssr.blurDownsample = 1;
      ssr.attenuateScreenBorders = true;
      ssr.attenuateIntersectionDistance = true;
      ssr.inputTextureColorIsInGammaSpace = false;
      ssr.generateOutputInGammaSpace = false;
      this.ssr = ssr;
    }

    const d = new DefaultRenderingPipeline("post", true, scene, [camera]);
    d.samples = p.msaa;
    d.fxaaEnabled = p.fxaa;
    d.bloomEnabled = true;
    d.bloomThreshold = 0.85;
    d.bloomWeight = 0.42;
    d.bloomKernel = p.bloomKernel;
    d.bloomScale = 0.5;
    d.imageProcessingEnabled = true;
    const ip = d.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.05;
    ip.contrast = 1.12;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 2.2;
    ip.vignetteStretch = 0.4;
    ip.vignetteColor = new Color4(0.06, 0.02, 0.03, 0);
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    // grading: warm highlights, slightly teal shadows, rich mids
    const cc = new ColorCurves();
    cc.globalSaturation = 12;
    cc.highlightsHue = 40;
    cc.highlightsDensity = 18;
    cc.highlightsSaturation = 20;
    cc.shadowsHue = 190;
    cc.shadowsDensity = 22;
    cc.shadowsSaturation = 18;
    cc.shadowsExposure = 4;
    ip.colorCurvesEnabled = true;
    ip.colorCurves = cc;
    d.grainEnabled = p.grain;
    d.grain.intensity = 6;
    d.grain.animated = true;
    d.chromaticAberrationEnabled = p.name === "high";
    d.chromaticAberration.aberrationAmount = 12;
    d.chromaticAberration.radialIntensity = 0.6;
    d.sharpenEnabled = p.name !== "low";
    d.sharpen.edgeAmount = 0.18;
    this.def = d;
  }

  dispose() {
    this.ssao?.dispose();
    this.ssr?.dispose();
    this.def?.dispose();
    this.ssao = this.ssr = this.def = undefined;
  }
}
