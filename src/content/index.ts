// Shared world data (pure JSON → core types): waypoints and routes, rooms,
// anchors, and who's who. The heists themselves live in ./heists.
import spotsJson from "./spots.json";
import npcsJson from "./npcs.json";
import { Spot, Router, RouteGraph } from "../core/schedule";

export interface NpcMeta { id: string; name: string; short: string; role: string; blurb: string; body: string }

export const spots: Record<string, Spot> = Object.fromEntries(Object.entries(spotsJson.spots).map(([id, s]) => [id, { id, pos: s.pos as [number, number, number], yaw: (s as { yaw?: number }).yaw }]));
export const router = new Router(spots, spotsJson as unknown as RouteGraph);
export const npcMeta: Record<string, NpcMeta> = Object.fromEntries(npcsJson.npcs.map((n) => [n.id, { id: n.id, name: n.name, short: n.short, role: n.role, blurb: n.blurb, body: n.body }]));
export const anchors = spotsJson.anchors as unknown as Record<string, [number, number, number]>;
export const roomBounds = spotsJson.rooms as unknown as Record<string, [number, number, number, number]>;
