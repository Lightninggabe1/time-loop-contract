// Recast navmesh (used only for schedule deviations: chases, fleeing).
// Built from the room's collision boxes so it matches what the player feels.
import { Scene, Mesh, MeshBuilder, Vector3 } from "@babylonjs/core";
import { CreateNavigationPluginAsync, RecastNavigationJSPluginV2 } from "@babylonjs/addons/navigation";
import * as RecastCore from "@recast-navigation/core";
import * as RecastGen from "@recast-navigation/generators";
import { Collider } from "../kit/kit";

let plugin: RecastNavigationJSPluginV2 | null = null;

export async function buildNavMesh(scene: Scene, colliders: Collider[]) {
  await RecastCore.init();
  plugin ??= await CreateNavigationPluginAsync({ instance: { ...RecastCore, ...RecastGen } });
  const temp: Mesh[] = colliders.map((c, i) => {
    const b = MeshBuilder.CreateBox(`nav${i}`, { width: c.size.x, height: c.size.y, depth: c.size.z }, scene);
    b.position.copyFrom(c.center);
    b.rotation.y = c.rotY;
    b.rotation.x = c.rotX ?? 0;
    b.computeWorldMatrix(true);
    return b;
  });
  plugin.createNavMesh(temp, {
    cs: 0.15, ch: 0.1, walkableSlopeAngle: 40, walkableHeight: 1.8, walkableClimb: 0.35, walkableRadius: 0.35,
    maxEdgeLen: 12, maxSimplificationError: 1.3, minRegionArea: 8, mergeRegionArea: 20, maxVertsPerPoly: 6,
    detailSampleDist: 6, detailSampleMaxError: 1,
  });
  for (const t of temp) t.dispose();
  return plugin;
}

export function closestPoint(p: Vector3) {
  return plugin?.getClosestPoint(p) ?? p;
}

/** Walkable path (navmesh) for schedule deviations such as chases; straight line before it's built. */
export function pathTo(from: Vector3, to: Vector3): Vector3[] {
  if (!plugin) return [to.clone()];
  const pts = plugin.computePath(plugin.getClosestPoint(from), plugin.getClosestPoint(to));
  return pts.length ? pts.slice(1) : [to.clone()];
}
