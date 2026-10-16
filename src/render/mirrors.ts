// Planar reflections for the mirror wall (High preset). Other presets fall
// back to the HDRI environment, which is itself a ballroom.
import { Scene, MirrorTexture, Plane, Mesh, AbstractMesh } from "@babylonjs/core";
import { mat } from "../art/materials";
import { Preset } from "./quality";

export class Mirrors {
  tex?: MirrorTexture;
  constructor(private scene: Scene, private plane: Plane) {}

  apply(p: Preset) {
    const m = mat("mirrorLive");
    this.tex?.dispose();
    this.tex = undefined;
    if (p.name === "high") {
      const t = new MirrorTexture("mirrorWall", { ratio: 0.42 }, this.scene, true);
      t.mirrorPlane = this.plane;
      // never re-render the clustered-light proxy (it writes the light buffer the materials read)
      t.renderList = this.scene.meshes.filter((x: AbstractMesh) => x.name !== "ballroom_mirrorLive" && x.name !== "sky" && !/proxy/i.test(x.name) && !x.name.startsWith("doorcol_")) as Mesh[];
      t.level = 0.9;
      t.adaptiveBlurKernel = 6;
      t.refreshRate = 3;
      m.reflectionTexture = t;
      this.tex = t;
    } else {
      m.reflectionTexture = null;
    }
  }
}
