// Modular kit: builds static architecture from primitives in local "frames"
// (a wall's own coordinate system), bakes transforms, assigns world-scale
// box-projected UVs, and merges everything per material for cheap draw calls.
import { Mesh, MeshBuilder, Vector3, Matrix, Quaternion, VertexBuffer, Scene, TransformNode } from "@babylonjs/core";
import { mat, TILE } from "../art/materials";

/** A local coordinate frame: x along the wall, y up, z into the room. */
export interface Frame {
  origin: Vector3;
  rotY: number;
}

export interface Collider {
  center: Vector3;
  size: Vector3;
  rotY: number;
}

export interface PieceOpts {
  rotY?: number; // extra local rotation (radians)
  rotX?: number;
  rotZ?: number;
  collide?: boolean;
  shadow?: boolean; // cast shadows (default true)
  tile?: number; // override metres-per-repeat for UVs
  uvRot?: boolean; // swap U/V (e.g. vertical grain)
  uvOffset?: [number, number]; // metres added to projected coords before tiling
}

const WORLD: Frame = { origin: Vector3.Zero(), rotY: 0 };

export class Kit {
  readonly scene: Scene;
  private buckets = new Map<string, { meshes: Mesh[]; shadow: boolean }>();
  readonly colliders: Collider[] = [];
  readonly root: TransformNode;

  constructor(scene: Scene, name: string) {
    this.scene = scene;
    this.root = new TransformNode(name, scene);
  }

  static frame(origin: Vector3, rotY: number): Frame {
    return { origin, rotY };
  }

  /** Local point → world point. */
  static toWorld(f: Frame, p: Vector3): Vector3 {
    const m = Matrix.RotationY(f.rotY);
    return Vector3.TransformCoordinates(p, m).addInPlace(f.origin);
  }

  box(material: string, center: Vector3, size: Vector3, opts: PieceOpts = {}, f: Frame = WORLD) {
    const m = MeshBuilder.CreateBox("b", { width: size.x, height: size.y, depth: size.z }, this.scene);
    this.place(m, material, center, opts, f);
    if (opts.collide) {
      this.colliders.push({ center: Kit.toWorld(f, center), size: size.clone(), rotY: f.rotY + (opts.rotY ?? 0) });
    }
    return m;
  }

  cyl(material: string, center: Vector3, height: number, diameter: number, opts: PieceOpts & { tess?: number; top?: number } = {}, f: Frame = WORLD) {
    const m = MeshBuilder.CreateCylinder(
      "c",
      { height, diameterBottom: diameter, diameterTop: opts.top ?? diameter, tessellation: opts.tess ?? 24 },
      this.scene,
    );
    this.place(m, material, center, opts, f);
    if (opts.collide) {
      this.colliders.push({ center: Kit.toWorld(f, center), size: new Vector3(diameter, height, diameter), rotY: 0 });
    }
    return m;
  }

  /** Add an arbitrary mesh built in local frame coordinates. */
  add(material: string, m: Mesh, center: Vector3, opts: PieceOpts = {}, f: Frame = WORLD) {
    this.place(m, material, center, opts, f);
    return m;
  }

  private place(m: Mesh, material: string, center: Vector3, opts: PieceOpts, f: Frame) {
    m.rotationQuaternion = Quaternion.RotationYawPitchRoll(f.rotY + (opts.rotY ?? 0), opts.rotX ?? 0, opts.rotZ ?? 0);
    m.position.copyFrom(Kit.toWorld(f, center));
    m.bakeCurrentTransformIntoVertices();
    boxUV(m, opts.tile ?? TILE[material] ?? 1, opts.uvRot, opts.uvOffset);
    let b = this.buckets.get(material);
    if (!b) this.buckets.set(material, (b = { meshes: [], shadow: opts.shadow ?? true }));
    b.meshes.push(m);
  }

  /** Merge each material bucket into one static mesh. */
  finish(): { meshes: Mesh[]; casters: Mesh[] } {
    const meshes: Mesh[] = [];
    const casters: Mesh[] = [];
    for (const [material, b] of this.buckets) {
      const merged = Mesh.MergeMeshes(b.meshes, true, true, undefined, false, false);
      if (!merged) continue;
      merged.name = `${this.root.name}_${material}`;
      merged.material = mat(material);
      merged.parent = this.root;
      merged.receiveShadows = true;
      merged.isPickable = false;
      merged.freezeWorldMatrix();
      merged.doNotSyncBoundingInfo = true;
      meshes.push(merged);
      if (b.shadow) casters.push(merged);
    }
    this.buckets.clear();
    return { meshes, casters };
  }
}

/** World-space box projection: UV = position / tile on the dominant-axis plane. */
export function boxUV(m: Mesh, tile: number, swap = false, off: [number, number] = [0, 0]) {
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  const nor = m.getVerticesData(VertexBuffer.NormalKind)!;
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
    const ax = Math.abs(nor[i]), ay = Math.abs(nor[i + 1]), az = Math.abs(nor[i + 2]);
    let u: number, v: number;
    if (ay >= ax && ay >= az) {
      u = pos[i];
      v = pos[i + 2];
    } else if (ax >= az) {
      u = pos[i + 2] * Math.sign(nor[i] || 1);
      v = pos[i + 1];
    } else {
      u = -pos[i] * Math.sign(nor[i + 2] || 1);
      v = pos[i + 1];
    }
    if (swap) [u, v] = [v, u];
    uv[j] = (u + off[0]) / tile;
    uv[j + 1] = (v + off[1]) / tile;
  }
  m.setVerticesData(VertexBuffer.UVKind, uv, false);
}
