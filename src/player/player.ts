// First-person player on a Havok character controller.
import {
  Scene, Vector3, UniversalCamera, PhysicsCharacterController, CharacterSupportedState, Quaternion,
  PhysicsBody, PhysicsMotionType, PhysicsShapeContainer, PhysicsShapeBox, TransformNode,
} from "@babylonjs/core";
import { Input } from "./input";
import { Collider } from "../kit/kit";

const EYE = 1.62;
const HEIGHT = 1.8;
const RADIUS = 0.32;

export function addStaticColliders(scene: Scene, colliders: Collider[]) {
  const node = new TransformNode("colliders", scene);
  const container = new PhysicsShapeContainer(scene);
  for (const c of colliders) {
    const box = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), c.size, scene);
    container.addChild(box, c.center, Quaternion.RotationYawPitchRoll(c.rotY, c.rotX ?? 0, 0));
  }
  const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, scene);
  body.shape = container;
  return body;
}

export class Player {
  readonly camera: UniversalCamera;
  private cc: PhysicsCharacterController;
  yaw: number;
  pitch = 0;
  walkSpeed = 3.4;
  sprintSpeed = 6.2;
  private bob = 0;
  private shakeAmt = 0;
  private gravity = new Vector3(0, -18, 0);
  enabled = true;

  constructor(scene: Scene, private input: Input, spawn: Vector3, yaw: number) {
    this.yaw = yaw;
    this.camera = new UniversalCamera("fp", spawn.add(new Vector3(0, EYE, 0)), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.05;
    this.camera.maxZ = 90;
    this.camera.fov = this.baseFov();
    this.cc = new PhysicsCharacterController(spawn.add(new Vector3(0, HEIGHT / 2, 0)), { capsuleHeight: HEIGHT, capsuleRadius: RADIUS }, scene);
    this.applyRotation();
  }

  private applyRotation() {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  update(dt: number) {
    if (!this.enabled) return;
    dt = Math.min(dt, 1 / 20);
    const s = this.input.read();
    this.yaw += s.look.x;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch + s.look.y));
    this.applyRotation();

    const fwd = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const speed = s.sprint ? this.sprintSpeed : this.walkSpeed;
    const desired = fwd.scale(s.move.y * speed).addInPlace(right.scale(s.move.x * speed));
    const up = Vector3.Up();

    const support = this.cc.checkSupport(dt, new Vector3(0, -1, 0));
    let vel: Vector3;
    if (support.supportedState === CharacterSupportedState.SUPPORTED) {
      vel = this.cc.calculateMovement(dt, fwd, support.averageSurfaceNormal, this.cc.getVelocity(), support.averageSurfaceVelocity, desired, up);
      vel.subtractInPlace(support.averageSurfaceVelocity);
      if (vel.dot(up) > 1e-3) {
        const len = vel.length();
        vel.normalizeFromLength(len);
        const horiz = len / support.averageSurfaceNormal.dot(up);
        vel = support.averageSurfaceNormal.cross(vel).cross(up).scale(horiz);
      }
      vel.addInPlace(support.averageSurfaceVelocity);
    } else {
      const v = this.cc.getVelocity();
      const air = desired.subtract(new Vector3(v.x, 0, v.z)).scale(Math.min(1, dt * 2));
      vel = v.add(air).addInPlace(this.gravity.scale(dt));
    }
    this.cc.setVelocity(vel);
    this.cc.integrate(dt, support, this.gravity);

    const p = this.cc.getPosition();
    const moving = Math.hypot(vel.x, vel.z);
    this.bob += dt * moving * 2.1;
    const bobY = Math.sin(this.bob * 2) * 0.025 * Math.min(1, moving / 3);
    this.camera.position.set(p.x, p.y - HEIGHT / 2 + EYE + bobY, p.z);
    if (this.shakeAmt > 0.001) {
      const k = this.shakeAmt;
      this.camera.position.addInPlaceFromFloats((Math.random() - 0.5) * k * 0.1, (Math.random() - 0.5) * k * 0.1, (Math.random() - 0.5) * k * 0.1);
      this.shakeAmt *= Math.pow(0.02, dt);
    }
    const baseFov = this.baseFov();
    const targetFov = s.sprint && moving > 4 ? baseFov + 0.07 : baseFov;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 6);
  }

  shake(amount: number) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  /** Vertical FOV: widen in portrait so phones still see the room. */
  baseFov() {
    const e = this.camera.getEngine();
    const aspect = e.getRenderWidth() / Math.max(1, e.getRenderHeight());
    return aspect < 1 ? 1.3 : 1.0;
  }

  /** Teleport (used by the loop reset and screenshot spots). */
  setPose(feet: Vector3, yaw: number, pitch = 0) {
    this.cc.setPosition(feet.add(new Vector3(0, HEIGHT / 2, 0)));
    this.cc.setVelocity(Vector3.Zero());
    this.yaw = yaw;
    this.pitch = pitch;
    this.applyRotation();
    this.camera.position.set(feet.x, feet.y + EYE, feet.z);
  }
}
