// Heist content types. A heist is pure data (src/content/heists/*.json):
// where you start and leave, the guards' rounds, the gadgets in the rooms,
// the loot, and the scripted plans the test bot uses to prove every approach.
import type { Vec3 } from "../schedule";

/** One sim tick is 1/30 s; a round is 60 s. */
export const TICK = 1 / 30;
export const ROUND_SECONDS = 60;
export const ROUND_TICKS = Math.round(ROUND_SECONDS / TICK);

export const WALK = 3.4; // m/s, same as the player controller
export const RUN = 6.2;
export const GUARD_WALK = 1.7;
export const GUARD_RUN = 4.6; // slower than a sprint, faster than a walk
export const REACH = 1.6; // how close you must be to use something

export type DeviceKind =
  | "plate" // holds doors open while anyone stands on it
  | "safe" // hold-to-crack; two crackers work twice as fast
  | "noise" // lures listed guards to a spot for a while
  | "blackout" // guards see only 2 m for a while
  | "announce" // everyone in the room turns to look at a spot for a while
  | "chandelier" // drops: knocks out anyone under it, everyone in the room stares
  | "bell"; // every guard hurries to a spot for a while

export interface DeviceDef {
  id: string;
  kind: DeviceKind;
  label: string;
  pos: Vec3;
  /** plate: radius; chandelier: knock-out radius */
  r?: number;
  /** plate: doors it holds open */
  doors?: string[];
  /** safe: seconds for one cracker; the loot inside */
  time?: number;
  loot?: string;
  /** noise/bell: who comes and where they stand; blackout/announce/noise: seconds */
  lure?: string[];
  spot?: string;
  for?: number;
  /** announce/chandelier: what everyone looks at */
  look?: Vec3;
}

export interface DoorDef {
  open?: boolean;
  locked?: boolean;
  /** an item that unlocks it */
  key?: string;
}

export interface ItemDef {
  id: string;
  label: string;
  pos: Vec3;
  /** the thing you came for: carrying it out wins */
  main?: boolean;
  /** inside a safe until it's cracked */
  inside?: string;
  /** keys are not loot: nobody minds you holding one */
  key?: boolean;
  /** bonus loot: a star if it leaves too */
  bonus?: boolean;
}

export interface GuardDef {
  npc: string;
  /** looping round: [spot, seconds to stand there] */
  patrol: [string, number][];
  /** seconds into the loop at round start */
  offset?: number;
}

export interface GuestDef {
  npc: string;
  spot: string;
  /** degrees; defaults to the spot's facing */
  yaw?: number;
  act?: string;
}

export type BotStep =
  | ["go", string, ("run" | "walk")?]
  | ["to", Vec3, ("run" | "walk")?]
  | ["use" | "take" | "punch" | "chat", string]
  | ["drop"]
  | ["wait", number]
  | ["until", number]
  | ["waitFor", string] // device done / door open / item free
  | ["end"];

export interface HeistDef {
  id: string;
  n: number;
  title: string;
  blurb: string;
  goal: string;
  cap: number; // most echoes you may keep
  par: number; // echoes for the second star
  timeGoal: number; // finish by this second for the third star (or carry out the bonus)
  spawn: { pos: Vec3; yaw: number };
  exit: { pos: Vec3; r: number; label: string };
  rooms: string[]; // rooms that are part of this job (others are dressing)
  restricted?: string[]; // rooms where a guard will question you
  doors?: Record<string, DoorDef>;
  devices: DeviceDef[];
  items: ItemDef[];
  guards: GuardDef[];
  guests?: GuestDef[];
  /** shown when a round ends without a win, keyed by round number (1-based), "*" for any */
  tips?: Record<string, string>;
  /** scripted plans, one list of rounds per approach; the last round wins */
  solutions: Record<"quiet" | "social" | "loud" | "chaos" | string, BotStep[][]>;
}
