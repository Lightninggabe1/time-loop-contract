// NPC schedules: position, facing and activity are a pure function of game
// time. An entry says "at HH:MM, set off for <spot> (optionally via
// waypoints) and, on arrival, do <act>".
import { parseTime } from "./conditions";
import { RATE } from "./clock";

export type Vec3 = [number, number, number];
export type Activity = "idle" | "talk" | "drink" | "dance" | "sit" | "work" | "play" | "smoke" | "walk";

export interface Spot {
  id: string;
  pos: Vec3;
  yaw?: number; // degrees, facing on arrival
}

export interface ScheduleEntry {
  at: string;
  spot: string;
  via?: string[];
  act: Activity;
  /** free-form label other systems can key on, e.g. "alone", "toast" */
  tag?: string;
}

export interface NpcDef {
  id: string;
  name: string;
  role: string;
  look: { body: string; outfit: string; accent?: string; height?: number };
  schedule: ScheduleEntry[];
}

/** Waypoint graph: hubs per room + explicit links; every other spot attaches to its room's nearest hub. */
export interface RouteGraph {
  hubs: Record<string, string[]>;
  links: [string, string][];
  rooms: Record<string, [number, number, number, number]>;
}

export class Router {
  private adj = new Map<string, Set<string>>();
  private cache = new Map<string, string[]>();
  constructor(private spots: Record<string, Spot>, graph: RouteGraph) {
    const link = (a: string, b: string) => {
      if (!spots[a] || !spots[b]) throw new Error(`route link to unknown spot ${spots[a] ? b : a}`);
      (this.adj.get(a) ?? this.adj.set(a, new Set()).get(a)!).add(b);
      (this.adj.get(b) ?? this.adj.set(b, new Set()).get(b)!).add(a);
    };
    for (const [a, b] of graph.links) link(a, b);
    const roomOf = (id: string) => {
      const [x, , z] = spots[id].pos;
      return Object.entries(graph.rooms).find(([, r]) => x >= r[0] - 0.3 && x <= r[2] + 0.3 && z >= r[1] - 0.3 && z <= r[3] + 0.3)?.[0];
    };
    for (const id of Object.keys(spots)) {
      if (this.adj.has(id)) continue;
      const room = roomOf(id);
      const hubs = (room && graph.hubs[room]) || [];
      let best = "", bd = Infinity;
      for (const h of hubs) {
        const d = dist(spots[id].pos, spots[h].pos);
        if (d < bd) (bd = d), (best = h);
      }
      if (best) link(id, best);
    }
  }
  /** Shortest spot path from a to b (inclusive), deterministic (ties broken by name). */
  route(a: string, b: string): string[] {
    if (a === b) return [a];
    const key = `${a}>${b}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const D = new Map<string, number>([[a, 0]]), prev = new Map<string, string>(), done = new Set<string>();
    while (true) {
      let u = "", ud = Infinity;
      for (const [k, d] of D) if (!done.has(k) && (d < ud || (d === ud && k < u))) (u = k), (ud = d);
      if (!u || u === b) break;
      done.add(u);
      for (const v of [...(this.adj.get(u) ?? [])].sort()) {
        const nd = ud + dist(this.spots[u].pos, this.spots[v].pos);
        if (nd < (D.get(v) ?? Infinity)) (D.set(v, nd), prev.set(v, u));
      }
    }
    if (!prev.has(b)) throw new Error(`no route ${a} → ${b}`);
    const path = [b];
    while (path[0] !== a) path.unshift(prev.get(path[0])!);
    this.cache.set(key, path);
    return path;
  }
}

export interface NpcPose {
  pos: Vec3;
  yaw: number; // radians
  act: Activity;
  spot: string; // destination spot
  entry: number; // index of the active schedule entry
  tag?: string;
  moving: boolean;
}

/** walking speed in metres per real second */
export const WALK_SPEED = 1.45;

interface Compiled {
  start: number; // game minute the entry begins
  path: Vec3[]; // from previous spot through waypoints to target
  cumulative: number[]; // metres along path at each vertex
  length: number;
  travel: number; // game minutes spent walking
  entry: ScheduleEntry;
  yaw: number;
}

const cache = new WeakMap<NpcDef, Compiled[]>();

const dist = (a: Vec3, b: Vec3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

export function compileSchedule(npc: NpcDef, spots: Record<string, Spot>, router?: Router): Compiled[] {
  const hit = cache.get(npc);
  if (hit) return hit;
  const get = (id: string) => {
    const s = spots[id];
    if (!s) throw new Error(`${npc.id}: unknown spot "${id}"`);
    return s;
  };
  const out: Compiled[] = [];
  let prev = get(npc.schedule[0].spot).pos;
  let prevId: string | null = npc.schedule[0].spot;
  let prevArrive = -Infinity;
  for (const entry of npc.schedule) {
    const at = parseTime(entry.at);
    const target = get(entry.spot);
    const via = entry.via ?? (router && prevId ? router.route(prevId, entry.spot).slice(1, -1) : []);
    const path: Vec3[] = [prev, ...via.map((v) => get(v).pos), target.pos];
    const cumulative = [0];
    for (let i = 1; i < path.length; i++) cumulative.push(cumulative[i - 1] + dist(path[i - 1], path[i]));
    const length = cumulative[cumulative.length - 1];
    // metres → real seconds of walking → game minutes
    const travel = (length / WALK_SPEED) * RATE;
    // "at" is the arrival time: set off early enough, but not before the last beat began
    const start = out.length === 0 ? at : Math.max(prevArrive, at - travel);
    if (out.length && at < parseTime(out[out.length - 1].entry.at)) throw new Error(`${npc.id}: schedule out of order at ${entry.at}`);
    out.push({ start, path, cumulative, length, travel, entry, yaw: ((target.yaw ?? 0) * Math.PI) / 180 });
    prev = target.pos;
    prevId = entry.spot;
    prevArrive = start + travel;
  }
  cache.set(npc, out);
  return out;
}

export function evalSchedule(npc: NpcDef, minute: number, spots: Record<string, Spot>, router?: Router): NpcPose {
  const plan = compileSchedule(npc, spots, router);
  let i = 0;
  while (i + 1 < plan.length && plan[i + 1].start <= minute) i++;
  const c = plan[i];
  const into = minute - c.start;
  if (minute < c.start || into >= c.travel - 1e-9 || c.length < 1e-6) {
    const p = c.path[c.path.length - 1];
    return { pos: [...p], yaw: c.yaw, act: c.entry.act, spot: c.entry.spot, entry: i, tag: c.entry.tag, moving: false };
  }
  const d = (into / c.travel) * c.length;
  let k = 1;
  while (k < c.path.length - 1 && c.cumulative[k] < d) k++;
  const a = c.path[k - 1], b = c.path[k];
  const seg = c.cumulative[k] - c.cumulative[k - 1] || 1;
  const t = (d - c.cumulative[k - 1]) / seg;
  const pos: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const yaw = Math.atan2(b[0] - a[0], b[2] - a[2]);
  return { pos, yaw, act: "walk", spot: c.entry.spot, entry: i, tag: c.entry.tag, moving: true };
}

/** When does this NPC next have `tag` (or arrive at `spot`)? Used by the intel board. */
export function nextOccurrence(npc: NpcDef, from: number, match: { tag?: string; spot?: string }, spots: Record<string, Spot>, router?: Router) {
  const plan = compileSchedule(npc, spots, router);
  for (const c of plan) {
    const arrive = c.start + c.travel;
    if (arrive < from) continue;
    if ((match.tag && c.entry.tag === match.tag) || (match.spot && c.entry.spot === match.spot)) return arrive;
  }
  return null;
}
