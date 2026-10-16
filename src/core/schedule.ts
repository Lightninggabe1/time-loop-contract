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
export const WALK_SPEED = 1.25;

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

export function compileSchedule(npc: NpcDef, spots: Record<string, Spot>): Compiled[] {
  const hit = cache.get(npc);
  if (hit) return hit;
  const get = (id: string) => {
    const s = spots[id];
    if (!s) throw new Error(`${npc.id}: unknown spot "${id}"`);
    return s;
  };
  const out: Compiled[] = [];
  let prev = get(npc.schedule[0].spot).pos;
  let lastStart = -Infinity;
  for (const entry of npc.schedule) {
    const start = parseTime(entry.at);
    if (start < lastStart) throw new Error(`${npc.id}: schedule out of order at ${entry.at}`);
    lastStart = start;
    const target = get(entry.spot);
    const path: Vec3[] = [prev, ...(entry.via ?? []).map((v) => get(v).pos), target.pos];
    const cumulative = [0];
    for (let i = 1; i < path.length; i++) cumulative.push(cumulative[i - 1] + dist(path[i - 1], path[i]));
    const length = cumulative[cumulative.length - 1];
    // metres → real seconds of walking → game minutes
    const travel = (length / WALK_SPEED) * RATE;
    out.push({ start, path, cumulative, length, travel, entry, yaw: ((target.yaw ?? 0) * Math.PI) / 180 });
    prev = target.pos;
  }
  cache.set(npc, out);
  return out;
}

export function evalSchedule(npc: NpcDef, minute: number, spots: Record<string, Spot>): NpcPose {
  const plan = compileSchedule(npc, spots);
  let i = 0;
  while (i + 1 < plan.length && plan[i + 1].start <= minute) i++;
  const c = plan[i];
  const into = minute - c.start;
  if (minute < c.start || into >= c.travel || c.length < 1e-6) {
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
export function nextOccurrence(npc: NpcDef, from: number, match: { tag?: string; spot?: string }, spots: Record<string, Spot>) {
  const plan = compileSchedule(npc, spots);
  for (const c of plan) {
    const arrive = c.start + c.travel;
    if (arrive < from) continue;
    if ((match.tag && c.entry.tag === match.tag) || (match.spot && c.entry.spot === match.spot)) return arrive;
  }
  return null;
}
