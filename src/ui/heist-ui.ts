// Heist HUD (HTML overlay): the minute timer, your crew of echoes, the
// prompt, toasts and bubbles, plus the cards between rounds (briefing,
// "keep this echo?", heist list). Plain DOM: crisp text, cheap updates.
import type { HeistDef } from "../core/heist/defs";
import type { BodyStatus, RoundStatus } from "../core/heist/round";
import { tap } from "./tap";

export const ECHO_COLORS = ["#E2B25C", "#4FD1A5", "#F07A8E", "#6FB7F2", "#B48CF0", "#F29A4A"];

export interface HeistUIHooks {
  onAct(i: number): void;
  onRewind(): void;
  onHint(): void;
  onPause(paused: boolean): void;
  onStart(): void;
  /** after a round: keep it as an echo (in `slot`, or a new one), or throw it away */
  onKeep(slot: number | null): void;
  onRedo(): void;
  onClearCrew(): void;
  onPick(heist: string): void;
}

export interface CrewChip { slot: number; status: BodyStatus | "you"; label: string }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const stars = (n: number, of = 3) => `<span class="h-stars">${"★".repeat(n)}<i>${"★".repeat(of - n)}</i></span>`;
const coarse = () => matchMedia("(pointer: coarse)").matches;

export class HeistUI {
  private root = document.getElementById("hud")!;
  private timer = el("div", "h-timer");
  private panel = el("div", "h-panel");
  private prompt = el("div", "g-prompt");
  private toasts = el("div", "g-toasts");
  private bubbles = el("div", "g-bubbles");
  private tags = el("div", "g-tags");
  private card = el("div", "g-end h-card");
  private flashEl = el("div", "g-flash");
  private tagEls = new Map<string, HTMLDivElement>();
  private bubbleEls = new Map<string, HTMLDivElement>();
  private offerKey = "";
  private panelKey = "";
  private timerKey = "";
  private cardKeys: (() => void) | null = null;

  constructor(private hooks: HeistUIHooks) {
    for (const e of [this.tags, this.bubbles, this.prompt, this.toasts, this.timer, this.panel, this.card, this.flashEl]) this.root.appendChild(e);
    this.card.hidden = true;
    document.getElementById("hint")?.remove();
    document.getElementById("clock")?.remove();
    const item = document.getElementById("btn-item")!;
    item.textContent = "⟲";
    item.setAttribute("aria-label", "Rewind");
    addEventListener("keydown", (e) => {
      if (!this.card.hidden && this.cardKeys && (e.code === "Space" || e.code === "Enter")) {
        e.preventDefault();
        this.cardKeys();
      }
    });
  }

  get open() {
    return !this.card.hidden;
  }

  // ---------------------------------------------------------------- in-round HUD
  setTimer(left: number, total: number) {
    const s = Math.ceil(left);
    const key = `${s}`;
    if (key === this.timerKey) return;
    this.timerKey = key;
    const frac = left / total;
    this.timer.className = `h-timer${s <= 10 ? " late" : ""}`;
    this.timer.innerHTML = `<b>${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}</b><span><i style="width:${(frac * 100).toFixed(1)}%"></i></span><small>to midnight</small>`;
  }

  setPanel(h: HeistDef, round: number, chips: CrewChip[], goal: string) {
    const key = JSON.stringify([h.id, round, chips, goal]);
    if (key === this.panelKey) return;
    this.panelKey = key;
    const chip = (c: CrewChip) =>
      c.status === "you"
        ? `<span class="h-chip you" style="--c:${ECHO_COLORS[c.slot % 6]}" title="You">You</span>`
        : `<span class="h-chip ${c.status}" style="--c:${ECHO_COLORS[c.slot % 6]}" title="${esc(c.label)}">${c.slot + 1}<em>${c.status === "stalled" ? "?" : c.status === "caught" ? "✕" : c.status === "out" ? "✓" : ""}</em></span>`;
    this.panel.innerHTML = `<h3>${h.n}. ${esc(h.title)}</h3><p class="h-goal">${esc(goal)}</p>
      <div class="h-crew"><span class="h-round">Round ${round}</span>${chips.map(chip).join("")}</div>
      <div class="h-btns"><button class="h-rewind" title="End this round now (Q)">⟲ Rewind <kbd>Q</kbd></button><button class="h-hint" title="Hint">?</button></div>`;
    tap(this.panel.querySelector(".h-rewind")!, () => this.hooks.onRewind());
    tap(this.panel.querySelector(".h-hint")!, () => this.hooks.onHint());
  }

  setOffers(labels: { label: string; risky?: boolean }[]) {
    const key = labels.map((o) => o.label).join("|");
    if (key === this.offerKey) return;
    this.offerKey = key;
    this.prompt.innerHTML = "";
    labels.forEach((o, i) => {
      const b = el("button", `g-offer${o.risky ? " risky" : ""}${i === 0 ? " primary" : ""}`);
      b.innerHTML = `<kbd>${i === 0 ? "E" : i + 1}</kbd><span>${esc(o.label)}</span>${o.risky ? '<i title="Risky if seen">!</i>' : ""}`;
      tap(b, () => this.hooks.onAct(i));
      this.prompt.appendChild(b);
    });
    this.prompt.classList.toggle("show", labels.length > 0);
  }

  toast(text: string, kind?: "intel" | "warn" | "good") {
    const t = el("div", `g-toast${kind ? " " + (kind === "good" ? "intel" : kind) : ""}`, esc(text));
    this.toasts.prepend(t);
    while (this.toasts.children.length > (coarse() ? 2 : 3)) this.toasts.lastElementChild!.remove();
    setTimeout(() => t.classList.add("out"), 3600);
    setTimeout(() => t.remove(), 4200);
  }

  flash() {
    this.flashEl.classList.remove("on");
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add("on");
  }

  setBubbles(list: { id: string; x: number; y: number; text: string; name: string }[]) {
    const sorted = [...list].sort((a, b) => b.y - a.y);
    for (let i = 0; i < sorted.length; i++)
      for (let j = 0; j < i; j++) {
        const a = sorted[i], b = sorted[j];
        if (Math.abs(a.x - b.x) < 250 && Math.abs(a.y - b.y) < 62) a.y = b.y - 64;
      }
    const seen = new Set<string>();
    for (const b of list) {
      seen.add(b.id);
      let e = this.bubbleEls.get(b.id);
      if (!e) {
        e = el("div", "g-bubble");
        this.bubbles.appendChild(e);
        this.bubbleEls.set(b.id, e);
      }
      const html = `<b>${esc(b.name)}</b>${esc(b.text)}`;
      if (e.innerHTML !== html) e.innerHTML = html;
      e.style.transform = `translate(${b.x}px, ${b.y}px) translate(-50%, -100%)`;
    }
    for (const [id, e] of this.bubbleEls) if (!seen.has(id)) (e.remove(), this.bubbleEls.delete(id));
  }

  /** Labels over echoes (their number), people and usable things. */
  setTags(list: { key: string; x: number; y: number; text: string; cls: string; color?: string }[]) {
    const seen = new Set<string>();
    for (const t of list) {
      seen.add(t.key);
      let e = this.tagEls.get(t.key);
      if (!e) {
        e = el("div", "g-tag");
        this.tags.appendChild(e);
        this.tagEls.set(t.key, e);
      }
      const cls = `g-tag ${t.cls}`;
      if (e.className !== cls) e.className = cls;
      if (e.textContent !== t.text) e.textContent = t.text;
      if (t.color) e.style.setProperty("--c", t.color);
      e.style.transform = `translate(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const [k, e] of this.tagEls) if (!seen.has(k)) (e.remove(), this.tagEls.delete(k));
  }

  // ---------------------------------------------------------------- cards
  private show(html: string, onKey: (() => void) | null) {
    this.card.innerHTML = `<div class="g-card wide">${html}</div>`;
    this.card.hidden = false;
    this.cardKeys = onKey;
    document.exitPointerLock?.();
    this.hooks.onPause(true);
    this.setOffers([]);
  }
  hideCard() {
    if (this.card.hidden) return;
    this.card.hidden = true;
    this.cardKeys = null;
    this.hooks.onPause(false);
  }
  private on(sel: string, fn: () => void) {
    this.card.querySelectorAll(sel).forEach((b) => tap(b, fn));
  }

  /** The briefing before a heist's first round. */
  briefing(h: HeistDef, echoes: number, best: number) {
    const first = h.n === 1 && echoes === 0;
    const how = first
      ? `<p class="h-how"><b>One minute.</b> When it's up (or you press <b>⟲ Rewind</b>), the minute starts again — and an <b>echo</b> of you does exactly what you just did.</p><p class="h-how">Every round builds on the last. Your echoes are your crew.</p>`
      : `<p class="h-how">Up to <b>${h.cap}</b> echoes. Being seen isn't the end — a guard gives chase, and anyone he catches is out for the round.</p>`;
    this.show(
      `<div class="sun"></div><p class="h-kicker">Heist ${h.n}${best ? ` · ${stars(best)}` : ""}</p><h2>${esc(h.title)}</h2>
       <p>${esc(h.blurb)}</p><p class="h-goalcard">${esc(h.goal)}</p>${how}
       ${echoes ? `<p class="g-small">Your crew of ${echoes} echo${echoes > 1 ? "es" : ""} is waiting.</p>` : ""}
       <p class="g-small">${coarse() ? "Left thumb walk · right thumb look · big button act · ⟲ rewind" : "WASD walk · mouse look · Shift run · <kbd>E</kbd> act · <kbd>F</kbd> punch · <kbd>Q</kbd> rewind"}</p>
       <div class="h-row"><button class="h-go">Go <kbd>Space</kbd></button><button class="h-list ghost">All heists</button></div>`,
      () => this.hooks.onStart(),
    );
    this.on(".h-go", () => this.hooks.onStart());
    this.on(".h-list", () => this.hooks.onPick(""));
  }

  /** Between rounds: what happened, and what to do with the round you just played. */
  roundOver(h: HeistDef, o: { status: RoundStatus; round: number; echoes: number; tip?: string; stars: number; seconds: number }) {
    const title = { won: "Pulled it off!", caught: "Nabbed.", timeup: "Midnight.", ended: "Rewind.", running: "" }[o.status];
    const quip = {
      won: `Out with the loot in ${o.seconds.toFixed(1)} s.`,
      caught: "Escorted out. Politely. Firmly. Until the clock rewinds.",
      timeup: "The bells strike twelve. And then… it's 11:59 again.",
      ended: "You wind the minute back.",
      running: "",
    }[o.status];
    if (o.status === "won") {
      this.show(
        `<div class="sun"></div><h2>${title}</h2><p class="h-bigstars">${stars(o.stars)}</p><p class="g-quip">${esc(quip)}</p>
         <p class="g-small">★ the job · ★★ with ${h.par} echo${h.par === 1 ? "" : "es"} or fewer · ★★★ also out by ${h.timeGoal} s</p>
         <div class="h-row"><button class="h-next">Next heist <kbd>Space</kbd></button><button class="h-again ghost">Try for more stars</button></div>`,
        () => this.hooks.onPick("next"),
      );
      this.on(".h-next", () => this.hooks.onPick("next"));
      this.on(".h-again", () => this.hooks.onClearCrew());
      return;
    }
    const full = o.echoes >= h.cap;
    const keep = full
      ? `<p class="g-small">Your crew is full (${h.cap}). Replace one with this round:</p><div class="h-row">${Array.from({ length: h.cap }, (_, i) => `<button class="h-slot" data-i="${i}" style="--c:${ECHO_COLORS[i]}">Replace echo ${i + 1}</button>`).join("")}</div>`
      : `<div class="h-row"><button class="h-keep">Keep as echo ${o.echoes + 1} &amp; go <kbd>Space</kbd></button><button class="h-redo ghost">Throw this round away</button></div>`;
    this.show(
      `<h2>${title}</h2><p class="g-quip">${esc(quip)}</p>${o.tip ? `<p class="h-tip">${esc(o.tip)}</p>` : ""}${keep}
       ${full ? `<div class="h-row"><button class="h-redo ghost">Throw this round away</button></div>` : ""}
       <div class="h-row small"><button class="h-clear ghost">Start over with no echoes</button><button class="h-list ghost">All heists</button></div>`,
      full ? null : () => this.hooks.onKeep(null),
    );
    this.on(".h-keep", () => this.hooks.onKeep(null));
    this.on(".h-redo", () => this.hooks.onRedo());
    this.on(".h-clear", () => this.hooks.onClearCrew());
    this.on(".h-list", () => this.hooks.onPick(""));
    this.card.querySelectorAll<HTMLButtonElement>(".h-slot").forEach((b) => tap(b, () => this.hooks.onKeep(Number(b.dataset.i))));
  }

  heistList(list: { def: HeistDef; stars: number; open: boolean }[]) {
    this.show(
      `<h2>The Heists</h2><div class="h-list-grid">${list
        .map((x) => `<button class="h-pick${x.open ? "" : " locked"}" data-id="${x.def.id}" ${x.open ? "" : "disabled"}><b>${x.def.n}. ${esc(x.def.title)}</b><span>${x.open ? esc(x.def.goal) : "Pull off the one before to open"}</span>${stars(x.stars)}</button>`)
        .join("")}</div>`,
      null,
    );
    this.card.querySelectorAll<HTMLButtonElement>(".h-pick").forEach((b) => tap(b, () => !b.disabled && this.hooks.onPick(b.dataset.id!)));
  }
}
