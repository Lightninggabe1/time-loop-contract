// Plain 2D geometry for the heist sim: door gates (from the level layout),
// rooms, and "did this step cross a shut door?".
import type { Vec3 } from "../schedule";

export interface Gate {
  id: string;
  a: [number, number]; // x, z ends of the doorway along the wall
  b: [number, number];
  y: number; // sill height (upper-floor doors)
}

interface LayoutWall { from: [number, number]; to: [number, number]; modules: { type: string; w: number; id?: string; opening?: number; frameOnly?: boolean; y0?: number }[] }
interface LayoutRoom { id: string; bounds: [number, number, number, number]; walls: LayoutWall[] }

/** Doorways that have leaves (an id), found by walking each wall's modules. */
export function gatesFromLayout(layout: { rooms: LayoutRoom[] }): Record<string, Gate> {
  const out: Record<string, Gate> = {};
  for (const r of layout.rooms)
    for (const w of r.walls) {
      const dx = w.to[0] - w.from[0], dz = w.to[1] - w.from[1];
      const len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len;
      let x = 0;
      for (const m of w.modules) {
        if (m.type === "door" && m.id && !m.frameOnly) {
          const c = x + m.w / 2, half = (m.opening ?? 2.4) / 2;
          out[m.id] = {
            id: m.id,
            a: [w.from[0] + ux * (c - half), w.from[1] + uz * (c - half)],
            b: [w.from[0] + ux * (c + half), w.from[1] + uz * (c + half)],
            y: m.y0 ?? 0,
          };
        }
        x += m.w;
      }
    }
  return out;
}

/** Does the step p→q pass through the doorway? (pads the wall line by a body radius) */
export function crosses(g: Gate, p: Vec3, q: Vec3): boolean {
  if (Math.abs(p[1] - g.y) > 1.5 && Math.abs(q[1] - g.y) > 1.5) return false;
  const ex = g.b[0] - g.a[0], ez = g.b[1] - g.a[1];
  const len = Math.hypot(ex, ez);
  const nx = -ez / len, nz = ex / len;
  const side = (v: Vec3) => (v[0] - g.a[0]) * nx + (v[2] - g.a[1]) * nz;
  const sp = side(p), sq = side(q);
  if ((sp > 0) === (sq > 0)) return false;
  // where along the doorway the step crosses it
  const t = sp / (sp - sq);
  const ix = p[0] + (q[0] - p[0]) * t, iz = p[2] + (q[2] - p[2]) * t;
  const along = ((ix - g.a[0]) * ex + (iz - g.a[1]) * ez) / len;
  return along > -0.4 && along < len + 0.4;
}

export type Rooms = Record<string, [number, number, number, number]>;

export function roomAt(rooms: Rooms, p: Vec3): string | null {
  for (const [id, b] of Object.entries(rooms)) if (p[0] >= b[0] - 0.3 && p[0] <= b[2] + 0.3 && p[2] >= b[1] - 0.3 && p[2] <= b[3] + 0.3) return id;
  return null;
}

export const flat = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
