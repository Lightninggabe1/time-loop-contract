// Loads and validates all game content (pure data → core types).
import spotsJson from "./spots.json";
import npcsJson from "./npcs.json";
import intelJson from "./intel.json";
import contractsJson from "./contracts.json";
import interactionsJson from "./interactions.json";
import eventsJson from "./events.json";
import talkJson from "./talk.json";
import { NpcDef, ScheduleEntry, Spot, Router, RouteGraph, Activity } from "../core/schedule";
import { parseTime, Cond } from "../core/conditions";
import { IntelDef, IntelBoard } from "../core/intel";
import { ContractDef, validateContract } from "../core/contracts";
import { EventDef, Action } from "../core/world";
import { PerkDef, Content } from "../core/loop";

export interface NpcMeta { id: string; name: string; short: string; role: string; blurb: string; body: string }
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
  /** a social move: offered inside the conversation menu instead of as a world prompt */
  talk?: boolean;
  /** (talk) when to list it at all, greyed out if `when` fails; defaults to `when` */
  show?: Cond;
  /** (talk) why it's greyed out */
  notYet?: string;
  do: Action[];
}
export interface TalkTopic { id: string; ask: string; line: string; learn?: string; tip?: string; when?: Cond }

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
export const npcMeta: Record<string, NpcMeta> = Object.fromEntries(npcsJson.npcs.map((n) => [n.id, { id: n.id, name: n.name, short: n.short, role: n.role, blurb: n.blurb, body: n.body }]));
export const intelDefs = intelJson.intel as unknown as IntelDef[];
export const board = new IntelBoard(intelDefs);
export const observeRules = intelJson.observe as ObserveRule[];
export const lookRules = intelJson.look as LookRule[];
export const contracts = contractsJson.contracts as unknown as ContractDef[];
export const perks = contractsJson.perks as unknown as PerkDef[];
export const interactions = interactionsJson.interactions as unknown as InteractionDef[];
export const barks = interactionsJson.barks as Record<string, string[]>;
export const events = eventsJson.events as unknown as EventDef[];
export const talk = talkJson.people as unknown as Record<string, TalkTopic[]>;
export const anchorNames = interactionsJson.anchorNames as Record<string, string>;
for (const [npc, topics] of Object.entries(talk)) {
  if (!npcsJson.npcs.some((n) => n.id === npc)) throw new Error(`talk.json: unknown npc ${npc}`);
  for (const t of topics) for (const i of [t.learn, t.tip]) if (i && !intelDefs.some((d) => d.id === i)) throw new Error(`talk.json: ${npc}.${t.id} unknown intel ${i}`);
}
/** Where the Lead marker points for each clue: an explicit pin, else the thing you look at, else the person you overhear. */
export const leadTargets: Record<string, { npc?: string; anchor?: string }> = Object.fromEntries(
  intelDefs.map((d) => {
    const pin = (d as IntelDef & { pin?: { npc?: string; anchor?: string } }).pin;
    const look = (intelJson.look as LookRule[]).find((l) => l.intel === d.id);
    const obs = (intelJson.observe as ObserveRule[]).find((o) => o.intel === d.id);
    return [d.id, pin ?? (look ? { anchor: look.anchor } : obs ? { npc: obs.npc } : {})];
  }),
);

for (const c of contracts) validateContract(c);

export const anchors = spotsJson.anchors as unknown as Record<string, [number, number, number]>;
export const roomBounds = spotsJson.rooms as unknown as Record<string, [number, number, number, number]>;
export const spawn = spotsJson.spawn as { pos: [number, number, number]; yaw: number };

export const content: Content = { npcs, spots, events, contracts, perks, router };
