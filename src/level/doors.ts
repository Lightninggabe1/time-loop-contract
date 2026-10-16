// Swinging doors. Leaves pivot on hinges; each leaf carries an animated
// physics box, so closed doors block and open doors don't. Open/locked state
// lives in world flags ("door.<id>.open", "door.<id>.locked").
import { Scene, MeshBuilder, PhysicsBody, PhysicsMotionType, PhysicsShapeBox, Vector3, Quaternion, Mesh } from "@babylonjs/core";
import type { BuiltDoor } from "./build";

const OPEN_ANGLE = (100 * Math.PI) / 180;

export class Doors {
  private state = new Map<string, { door: BuiltDoor; t: number; target: number }>();

  constructor(scene: Scene, doors: BuiltDoor[]) {
    for (const d of doors) {
      d.pivots.forEach((pivot, i) => {
        const sx = i === 0 ? 1 : -1;
        const proxy = MeshBuilder.CreateBox(`doorcol_${d.spec.id}_${i}`, { width: d.spec.leafW, height: d.spec.height, depth: 0.12 }, scene);
        proxy.position.set((sx * d.spec.leafW) / 2, d.spec.height / 2, 0);
        proxy.parent = pivot;
        proxy.isVisible = false;
        proxy.isPickable = false;
        const body = new PhysicsBody(proxy, PhysicsMotionType.ANIMATED, false, scene);
        body.shape = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(d.spec.leafW, d.spec.height, 0.12), scene);
        body.disablePreStep = false;
        void (proxy as Mesh);
      });
      this.state.set(d.spec.id, { door: d, t: 0, target: 0 });
    }
  }

  ids() {
    return [...this.state.keys()];
  }

  setOpen(id: string, open: boolean, instant = false) {
    const s = this.state.get(id);
    if (!s) return;
    s.target = open ? 1 : 0;
    if (instant) s.t = s.target;
  }

  isOpen(id: string) {
    return (this.state.get(id)?.t ?? 0) > 0.5;
  }

  update(dt: number) {
    for (const s of this.state.values()) {
      if (s.t !== s.target) s.t = s.target > s.t ? Math.min(s.target, s.t + dt * 1.6) : Math.max(s.target, s.t - dt * 1.6);
      const ease = s.t * s.t * (3 - 2 * s.t);
      s.door.pivots.forEach((p, i) => {
        p.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), s.door.spec.rotY + s.door.spec.open[i] * -ease * OPEN_ANGLE);
      });
    }
  }
}
