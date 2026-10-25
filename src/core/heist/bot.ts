// Scripted player for the heist sim. Plays a heist round by round from a plan
// (the heist's `solutions`), each round becoming an echo for the next, exactly
// as a person would. Used by the tests, and later by the hint ghost.
import type { Vec3 } from "../schedule";
import { Round, Env, Track, Act } from "./round";
import { HeistDef, BotStep, WALK, RUN, TICK, ROUND_TICKS } from "./defs";
import { flat } from "./geo";

export interface BotResult { round: Round; track: Track; log: string[] }

/** Where a named thing is: a spot, a device, an item, the exit, or a person. */
function locate(r: Round, name: string): Vec3 {
  if (name === "exit") return r.def.exit.pos;
  if (name === "spawn") return r.def.spawn.pos;
  const d = r.devices.get(name);
  if (d) return d.def.pos;
  const it = r.items.get(name);
  if (it) return it.pos;
  const n = r.npc(name);
  if (n) return n.pos;
  const s = r.env.spots[name];
  if (s) return s.pos;
  throw new Error(`bot: nowhere called "${name}"`);
}

/** Play one round with `script`, given earlier rounds' echoes. */
export function playRound(def: HeistDef, env: Env, echoes: Track[], script: BotStep[]): BotResult {
  const r = new Round(def, env, echoes);
  const log: string[] = [];
  let pos: Vec3 = [...def.spawn.pos];
  let yaw = (def.spawn.yaw * Math.PI) / 180;
  let i = 0, path: Vec3[] | null = null, waitUntil = -1;
  const say = (m: string) => log.push(`${r.seconds.toFixed(2)}s ${m}`);
  while (r.status === "running" && r.tick < ROUND_TICKS) {
    const acts: Act[] = [];
    let moved = false;
    // run as many instant steps as possible this tick, then one movement tick
    for (let guard = 0; guard < 20 && i < script.length; guard++) {
      const s = script[i];
      const k = s[0];
      if (k === "go" || k === "to") {
        const target = k === "go" ? locate(r, s[1] as string) : (s[1] as Vec3);
        if (!path) path = r.pathTo(pos, target);
        // people move: keep homing on them
        if (k === "go" && r.npc(s[1] as string)) path[path.length - 1] = [...target];
        const speed = (s[2] === "run" ? RUN : WALK) * TICK;
        let step = speed;
        while (step > 1e-6 && path.length) {
          const t = path[0], d = flat(pos, t);
          const stop = path.length === 1 && k === "go" && !r.env.spots[s[1] as string] && r.devices.get(s[1] as string)?.def.kind !== "plate" && s[1] !== "exit" ? 0.8 : 0; // stand in front of things
          if (d <= stop + 1e-6) {
            path.shift();
            continue;
          }
          const move = Math.min(step, d - stop);
          const next: Vec3 = [pos[0] + ((t[0] - pos[0]) * move) / d, pos[1] + ((t[1] - pos[1]) * move) / d, pos[2] + ((t[2] - pos[2]) * move) / d];
          if (r.blockingGate(pos, next)) break; // wait at a shut door
          yaw = Math.atan2(t[0] - pos[0], t[2] - pos[2]);
          pos = next;
          step -= move;
          if (move >= d - stop - 1e-6) path.shift();
        }
        moved = true;
        if (!path.length) {
          path = null;
          i++;
        }
        break;
      }
      if (k === "wait" || k === "until") {
        if (waitUntil < 0) waitUntil = k === "wait" ? r.tick + Math.round((s[1] as number) / TICK) : Math.round((s[1] as number) / TICK);
        if (r.tick < waitUntil) break;
        waitUntil = -1;
        i++;
        continue;
      }
      if (k === "waitFor") {
        const name = s[1] as string;
        const d = r.devices.get(name), it = r.items.get(name), door = r.doors.get(name);
        const ready = d ? d.done : it ? it.free && it.carrier === null : door ? door.open : false;
        if (!ready) break;
        i++;
        continue;
      }
      if (k === "end") {
        say("ends the round");
        r.endEarly();
        i++;
        break;
      }
      // an action
      acts.push(k === "drop" ? { verb: "drop" } : { verb: k as Act["verb"], target: s[1] as string });
      say(`${k} ${s[1] ?? ""}`);
      i++;
      break; // one action per tick, like a person pressing E
    }
    void moved;
    if (r.status !== "running") break;
    r.step(pos, yaw, acts);
    for (const e of r.drain()) {
      if (e.kind === "toast") say(`toast: ${e.text}`);
      else if (e.kind === "stall") say(`echo ${e.body + 1} stalls: ${e.reason}`);
      else if (e.kind === "caught") say(`${e.body === r.player.id ? "player" : `echo ${e.body + 1}`} caught by ${e.by}`);
      else if (e.kind === "alarm") say(`${e.npc} chases ${e.body === r.player.id ? "player" : `echo ${e.body + 1}`}`);
      else if (e.kind === "escaped") say(`${e.item} escapes`);
      else if (e.kind === "opened") say(`${e.id} opens`);
      else if (e.kind === "ko") say(`${e.npc} knocked out`);
      else if (e.kind === "device") say(`${e.id} triggered`);
      else if (e.kind === "end") say(`round ends: ${e.status}`);
    }
    if (i >= script.length && !path && waitUntil < 0) {
      // script finished: stand still until the round ends
      while (r.status === "running" && r.tick < ROUND_TICKS) {
        r.step(pos, yaw, []);
        for (const e of r.drain()) if (e.kind === "caught" || e.kind === "escaped" || e.kind === "end" || e.kind === "stall") say(JSON.stringify(e));
      }
    }
  }
  return { round: r, track: r.recording(), log };
}

/** Play a whole plan: each round's recording joins the crew for the next. */
export function playPlan(def: HeistDef, env: Env, rounds: BotStep[][]) {
  const echoes: Track[] = [];
  const results: BotResult[] = [];
  for (const script of rounds) {
    const res = playRound(def, env, echoes, script);
    results.push(res);
    echoes.push(res.track);
  }
  return { results, last: results[results.length - 1], echoes };
}
