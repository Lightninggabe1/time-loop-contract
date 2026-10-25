// Heist content: the campaign, plus the shared world the heist sim needs
// (waypoints, rooms, door gates from the level layout, display names).
import wingJson from "../level/layouts/wing.json";
import npcsJson from "./npcs.json";
import { spots, router, roomBounds } from "./index";
import { gatesFromLayout } from "../core/heist/geo";
import type { Env } from "../core/heist/round";
import type { HeistDef } from "../core/heist/defs";
import h1 from "./heists/h1.json";
import h2 from "./heists/h2.json";
import h3 from "./heists/h3.json";

export const gates = gatesFromLayout(wingJson as unknown as Parameters<typeof gatesFromLayout>[0]);

export const env: Env = {
  spots,
  router,
  rooms: roomBounds,
  gates,
  names: Object.fromEntries(npcsJson.npcs.map((n) => [n.id, n.short])),
};

export const heists: HeistDef[] = ([h1, h2, h3] as unknown as HeistDef[]).sort((a, b) => a.n - b.n);

for (const h of heists) {
  for (const id of Object.keys(h.doors ?? {})) if (!gates[id]) throw new Error(`${h.id}: unknown door ${id}`);
  for (const d of h.devices) for (const id of d.doors ?? []) if (!gates[id]) throw new Error(`${h.id}/${d.id}: unknown door ${id}`);
  for (const g of h.guards) for (const [s] of g.patrol) if (!spots[s]) throw new Error(`${h.id}: ${g.npc} patrols unknown spot ${s}`);
  for (const it of h.items) if (it.inside && !h.devices.some((d) => d.id === it.inside)) throw new Error(`${h.id}: ${it.id} inside unknown ${it.inside}`);
}
