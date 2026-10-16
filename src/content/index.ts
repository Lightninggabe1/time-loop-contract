// Loads and validates all game content (pure data → core types).
import spotsJson from "./spots.json";
import npcsJson from "./npcs.json";
import intelJson from "./intel.json";
import contractsJson from "./contracts.json";
import interactionsJson from "./interactions.json";
import eventsJson from "./events.json";
import { NpcDef, ScheduleEntry, Spot, Router, RouteGraph, Activity } from "../core/schedule";
import { parseTime, Cond } from "../core/conditions";
import { IntelDef, IntelBoard } from "../core/intel";
import { ContractDef, validateContract } from "../core/contracts";
import { EventDef, Action } from "../core/world";
import { PerkDef, Content } from "../core/loop";

export interface NpcMeta { id: string; name: string; role: string; blurb: string; body: string }
export interface ObserveRule { intel: string; npc: string; tag?: string; radius: number; line: string }
export interface LookRule { intel: string; anchor: string; radius: number }
export interface InteractionDef {
  id: string;
  label: string;
  target: { npc?: string; anchor?: string };
  npcTag?: string[];
  when?: Cond;
  requires?: Cond;
  denied?: string;
  crime?: boolean;
  gesture?: string;
  do: Action[];
}

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

type RawNpc = (typeof npcsJson.npcs)[number] & { loop?: { from: string; to: string; every: number; route: string[][] } };

function expand(raw: RawNpc): NpcDef {
  const entries: ScheduleEntry[] = (raw.schedule as string[][]).map(([at, spot, act, tag]) => ({ at, spot, act: act as Activity, tag }));
  if (raw.loop) {
    const { from, to, every, route } = raw.loop;
    const step = every / route.length;
    for (let t = parseTime(from); t < parseTime(to); t += every)
      route.forEach(([spot, act, tag], i) => entries.push({ at: hhmm(t + i * step), spot, act: act as Activity, tag }));
    entries.sort((a, b) => parseTime(a.at) - parseTime(b.at));
  }
  return { id: raw.id, name: raw.name, role: raw.role, look: { body: raw.body, outfit: "" }, schedule: entries };
}

export const spots: Record<string, Spot> = Object.fromEntries(Object.entries(spotsJson.spots).map(([id, s]) => [id, { id, pos: s.pos as [number, number, number], yaw: (s as { yaw?: number }).yaw }]));
export const router = new Router(spots, spotsJson as unknown as RouteGraph);
export const npcs: NpcDef[] = (npcsJson.npcs as RawNpc[]).map(expand);
export const npcMeta: Record<string, NpcMeta> = Object.fromEntries(npcsJson.npcs.map((n) => [n.id, { id: n.id, name: n.name, role: n.role, blurb: n.blurb, body: n.body }]));
export const intelDefs = intelJson.intel as unknown as IntelDef[];
export const board = new IntelBoard(intelDefs);
export const observeRules = intelJson.observe as ObserveRule[];
export const lookRules = intelJson.look as LookRule[];
export const contracts = contractsJson.contracts as unknown as ContractDef[];
export const perks = contractsJson.perks as unknown as PerkDef[];
export const interactions = interactionsJson.interactions as unknown as InteractionDef[];
export const barks = interactionsJson.barks as Record<string, string[]>;
export const events = eventsJson.events as unknown as EventDef[];

for (const c of contracts) validateContract(c);

export const anchors = spotsJson.anchors as unknown as Record<string, [number, number, number]>;
export const roomBounds = spotsJson.rooms as unknown as Record<string, [number, number, number, number]>;
export const spawn = spotsJson.spawn as { pos: [number, number, number]; yaw: number };

export const content: Content = { npcs, spots, events, contracts, perks, router };
