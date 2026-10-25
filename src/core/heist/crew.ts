// The crew: the echoes you've kept for each heist, and your stars. Saved
// through the storage adapter, so a crew survives closing the page.
import type { Storage } from "../storage";
import type { Track } from "./round";
import type { HeistDef } from "./defs";

interface Saved {
  version: 2;
  stars: Record<string, number>;
  crews: Record<string, Track[]>;
  last?: string;
}

export class Crew {
  private s: Saved;
  constructor(private storage: Storage, readonly heists: HeistDef[]) {
    const old = storage.load<Saved>("heist");
    this.s = old?.version === 2 ? old : { version: 2, stars: {}, crews: {} };
  }

  private save() {
    this.storage.save("heist", this.s);
  }

  heist(id: string) {
    return this.heists.find((h) => h.id === id)!;
  }
  stars(id: string) {
    return this.s.stars[id] ?? 0;
  }
  get totalStars() {
    return Object.values(this.s.stars).reduce((a, b) => a + b, 0);
  }
  /** A heist opens once the one before it has been pulled off. */
  unlocked(id: string) {
    const h = this.heist(id);
    const prev = this.heists.find((x) => x.n === h.n - 1);
    return !prev || this.stars(prev.id) > 0;
  }
  /** The heist to start on: the last one played, else the first not yet won. */
  get current() {
    if (this.s.last && this.unlocked(this.s.last)) return this.s.last;
    return (this.heists.find((h) => !this.stars(h.id)) ?? this.heists[0]).id;
  }
  set current(id: string) {
    this.s.last = id;
    this.save();
  }

  echoes(id: string): Track[] {
    return this.s.crews[id] ?? [];
  }
  /** Keep a round as an echo: added at the end, or replacing `slot`. */
  keep(id: string, t: Track, slot?: number) {
    const list = [...this.echoes(id)];
    if (slot !== undefined && slot < list.length) list[slot] = t;
    else list.push(t);
    this.s.crews[id] = list.slice(0, this.heist(id).cap);
    this.save();
  }
  drop(id: string, slot: number) {
    this.s.crews[id] = this.echoes(id).filter((_, i) => i !== slot);
    this.save();
  }
  clear(id: string) {
    this.s.crews[id] = [];
    this.save();
  }
  won(id: string, stars: number) {
    this.s.stars[id] = Math.max(this.stars(id), stars);
    this.save();
  }
}
