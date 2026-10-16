// Game HUD (HTML overlay): prompt, toasts, speech bubbles, contract tracker,
// intel board, intro cards and the midnight summary. Plain DOM: crisp text,
// cheap updates, works the same on phones.
import type { Offer } from "../game/session";
import type { ContractStatus, ApproachKind } from "../core/contracts";
import type { IntelBoard, Lead } from "../core/intel";
import type { CondCtx, FlagValue } from "../core/conditions";
import type { LoopSummary, Meta, PerkDef } from "../core/loop";

export interface UIHooks {
  onAct(id: string): void;
  onWait(): void;
  onHint(): void;
  onAgain(): void;
  onBuy(id: string): boolean;
  onPause(paused: boolean): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const KIND_ICON: Record<ApproachKind, string> = { quiet: "◐", social: "❝", loud: "✊", chaos: "✸" };
const KIND_NAME: Record<ApproachKind, string> = { quiet: "Quiet", social: "Social", loud: "Loud", chaos: "Chaos" };

export class GameUI {
  private root = document.getElementById("hud")!;
  private prompt = el("div", "g-prompt");
  private toasts = el("div", "g-toasts");
  private bubbles = el("div", "g-bubbles");
  private tracker = el("div", "g-tracker");
  private board = el("div", "g-board");
  private end = el("div", "g-end");
  private introEl = el("div", "g-intro");
  private flashEl = el("div", "g-flash");
  private offers: Offer[] = [];
  private bubbleEls = new Map<string, HTMLDivElement>();
  private focus = 0; // which contract the tracker follows
  private lastTrack = "";

  constructor(private hooks: UIHooks) {
    for (const e of [this.bubbles, this.prompt, this.toasts, this.tracker, this.board, this.end, this.introEl, this.flashEl]) this.root.appendChild(e);
    this.board.hidden = this.end.hidden = this.introEl.hidden = true;
    document.getElementById("hint")?.remove();
    // touch buttons
    const ctx = document.getElementById("btn-context")!;
    ctx.addEventListener("touchstart", (e) => (e.preventDefault(), this.offers[0] && hooks.onAct(this.offers[0].id)));
    const item = document.getElementById("btn-item")!;
    item.textContent = "⏱";
    item.addEventListener("touchstart", (e) => (e.preventDefault(), hooks.onWait()));
    const touch = document.getElementById("touch")!;
    const boardBtn = el("button", "g-touch-board", "Board");
    boardBtn.addEventListener("touchstart", (e) => (e.preventDefault(), this.toggleBoard(this.lastBoard!, this.lastCtx!)));
    touch.appendChild(boardBtn);
    addEventListener("keydown", (e) => {
      if (!this.end.hidden && (e.code === "Space" || e.code === "Enter")) hooks.onAgain();
      if (!this.introEl.hidden) this.hideIntro();
      if (!this.board.hidden && e.code === "Escape") this.closeBoard();
    });
  }

  // ---------------------------------------------------------------- prompt
  setOffers(offers: Offer[]) {
    const key = offers.map((o) => o.id).join("|");
    if (key === this.offers.map((o) => o.id).join("|")) return;
    this.offers = offers;
    this.prompt.innerHTML = "";
    offers.forEach((o, i) => {
      const b = el("button", `g-offer${o.crime ? " risky" : ""}${i === 0 ? " primary" : ""}`);
      b.innerHTML = `<kbd>${i === 0 ? "E" : i + 1}</kbd><span>${esc(o.label)}</span>${o.crime ? '<i title="Risky if seen">!</i>' : ""}`;
      b.addEventListener("click", () => this.hooks.onAct(o.id));
      b.addEventListener("touchstart", (e) => (e.preventDefault(), this.hooks.onAct(o.id)));
      this.prompt.appendChild(b);
    });
    this.prompt.classList.toggle("show", offers.length > 0);
  }

  // ---------------------------------------------------------------- toasts & bubbles
  toast(text: string, kind?: "intel" | "warn") {
    const t = el("div", `g-toast${kind ? " " + kind : ""}`, esc(text));
    this.toasts.prepend(t);
    while (this.toasts.children.length > 3) this.toasts.lastElementChild!.remove();
    setTimeout(() => t.classList.add("out"), 3600);
    setTimeout(() => t.remove(), 4200);
  }

  flash() {
    this.flashEl.classList.remove("on");
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add("on");
  }

  setBubbles(list: { id: string; x: number; y: number; text: string; name: string }[]) {
    // stack overlapping bubbles (two people talking at once)
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

  setClock(hm: string, ampm: string, room: string) {
    const t = document.getElementById("clocktime")!;
    if (t.textContent !== hm) t.textContent = hm;
    const small = document.querySelector("#clock small")!;
    if (small.textContent !== ampm) small.textContent = ampm;
    const r = document.getElementById("room")!;
    if (r.textContent !== room) r.textContent = room;
  }

  // ---------------------------------------------------------------- tracker
  setTracker(list: ContractStatus[], loop: number, lead: Lead | null, flags: Readonly<Record<string, FlagValue>>) {
    const firstLoop = loop <= 1;
    const c = list[this.focus % list.length];
    const key = JSON.stringify([firstLoop, this.focus, lead?.intel.id, c.approaches.map((a) => a.steps.map((s) => s.done)), c.complete?.id, !!flags["has.jacket"]]);
    if (key === this.lastTrack) return;
    this.lastTrack = key;
    let html = "";
    if (firstLoop) {
      html += `<h3>Tonight</h3><p class="g-goal">Just watch. Everything you notice goes on your board <kbd>Tab</kbd>.</p>`;
    } else {
      html += `<h3><button class="g-cycle" title="Next contract">‹</button> ${esc(c.contract.title)} <button class="g-cycle next" title="Next contract">›</button></h3>`;
      html += `<p class="g-brief">${esc(c.contract.brief)}</p>`;
      if (c.complete) html += `<p class="g-done">✓ Done — ${KIND_NAME[c.complete.kind]}: ${esc(c.complete.title)}</p>`;
      const a = c.focus;
      html += `<div class="g-approaches">${c.approaches.map((x) => `<span class="${x === a ? "on" : ""}${x.complete ? " done" : ""}" title="${KIND_NAME[x.approach.kind]}">${KIND_ICON[x.approach.kind]}</span>`).join("")}</div>`;
      html += `<p class="g-appr">${KIND_NAME[a.approach.kind]}: ${esc(a.approach.title)}</p><ul>${a.steps.map((s) => `<li class="${s.done ? "ok" : ""}">${esc(s.text)}</li>`).join("")}</ul>`;
    }
    if (lead) html += `<div class="g-lead"><span>Lead</span>${esc(lead.intel.title)}<button class="g-hint" title="Free hint">?</button></div>`;
    if (flags["has.jacket"]) html += `<div class="g-badge">Disguised as a waiter</div>`;
    this.tracker.innerHTML = html;
    this.tracker.querySelectorAll(".g-cycle").forEach((b) =>
      b.addEventListener("click", () => {
        this.focus = (this.focus + (b.classList.contains("next") ? 1 : list.length - 1)) % list.length;
        this.lastTrack = "";
      }),
    );
    this.tracker.querySelector(".g-hint")?.addEventListener("click", () => this.hooks.onHint());
  }

  // ---------------------------------------------------------------- board
  private lastBoard?: IntelBoard;
  private lastCtx?: CondCtx;
  toggleBoard(b: IntelBoard, ctx: CondCtx) {
    this.lastBoard = b;
    this.lastCtx = ctx;
    if (!this.board.hidden) return this.closeBoard();
    const known = new Set(b.known(ctx).map((d) => d.id));
    const lead = b.lead(ctx);
    const kinds: [string, string][] = [["person", "People"], ["secret", "Secrets"], ["schedule", "Schedules"], ["key", "Keys & items"], ["place", "Places"]];
    let html = `<div class="g-board-in"><h2>The Board <small>${known.size} / ${b.defs.length} noted</small></h2><div class="g-cols">`;
    for (const [k, name] of kinds) {
      const items = b.defs.filter((d) => d.kind === k);
      html += `<section><h4>${name}</h4>`;
      for (const d of items) {
        if (known.has(d.id)) html += `<article class="known"><b>${esc(d.title)}</b><p>${esc(d.text)}</p></article>`;
        else if (lead?.intel.id === d.id) html += `<article class="lead"><b>? Lead</b><p>${esc(d.hint)}</p></article>`;
        else html += `<article class="unknown"><b>?</b></article>`;
      }
      html += `</section>`;
    }
    html += `</div><button class="g-close">Back to the party</button></div>`;
    this.board.innerHTML = html;
    this.board.hidden = false;
    this.board.querySelector(".g-close")!.addEventListener("click", () => this.closeBoard());
    document.exitPointerLock?.();
    this.hooks.onPause(true);
  }
  closeBoard() {
    this.board.hidden = true;
    this.hooks.onPause(false);
  }

  // ---------------------------------------------------------------- intro & end
  intro(loop: number, contracts: number) {
    const first = loop <= 1;
    this.introEl.innerHTML = first
      ? `<div class="g-card"><div class="sun"></div><h2>New Year's Eve, 1929.</h2><p>Again.</p>
         <p>Tonight, just <b>watch</b>. Follow the guests, listen in, poke around.
         Everything you notice is written on your <b>board</b>.</p>
         <p class="g-small">WASD / left thumb to walk · mouse / right thumb to look · <kbd>E</kbd> act · <kbd>Q</kbd> pocket watch (skip 10 min) · <kbd>Tab</kbd> board</p>
         <button>Enter the party</button></div>`
      : `<div class="g-card"><div class="sun"></div><h2>Loop ${loop}.</h2><p>You remember everything.</p>
         <p>${contracts} contracts are open. Each can be done <b>quietly</b>, <b>socially</b>, <b>loudly</b> or with <b>chaos</b>. Being seen isn't the end — it just gets lively.</p>
         <button>Again, then</button></div>`;
    this.introEl.hidden = false;
    this.introEl.querySelector("button")!.addEventListener("click", () => this.hideIntro());
    this.hooks.onPause(true);
  }
  hideIntro() {
    if (this.introEl.hidden) return;
    this.introEl.hidden = true;
    this.hooks.onPause(false);
  }

  renderEnd(s: LoopSummary, meta: Meta, perks: PerkDef[]) {
    const reason = { midnight: "Midnight.", caught: "Caught.", contract: "Done.", restart: "Rewind." }[s.reason];
    let html = `<div class="g-card wide"><div class="sun"></div><h2>${reason}</h2><p class="g-quip">${esc(s.quip)}</p>`;
    html += `<div class="g-stats"><div><b>${s.newIntel}</b>new clues</div><div><b>${s.completed.length}</b>contracts</div><div><b>+${s.memoryEarned}</b>memory</div></div>`;
    html += `<h4>Memories to spend: <b>${meta.memory}</b></h4><div class="g-perks">`;
    for (const p of perks) {
      const owned = meta.perks.includes(p.id);
      html += `<button class="g-perk${owned ? " owned" : ""}" data-id="${p.id}" ${owned || meta.memory < p.cost ? "disabled" : ""}><b>${esc(p.title)}</b><span>${esc(p.text)}</span><em>${owned ? "Owned" : `${p.cost} memories`}</em></button>`;
    }
    html += `</div><button class="g-again">Again <kbd>Space</kbd></button></div>`;
    this.end.innerHTML = html;
    this.end.hidden = false;
    this.end.querySelector(".g-again")!.addEventListener("click", () => this.hooks.onAgain());
    this.end.querySelectorAll(".g-perk").forEach((b) => b.addEventListener("click", () => this.hooks.onBuy((b as HTMLElement).dataset.id!)));
  }
  hideEnd() {
    this.end.hidden = true;
  }
}
