// HTML overlay HUD: crisp text at any DPR, cheap to update.
import type { Quality } from "../render/quality";
import type { Input } from "../player/input";

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  onQuality?: (q: Quality) => void;
  private lastTime = "";

  constructor() {
    $("settings-btn").addEventListener("click", () => this.toggleSettings(true));
    $("settings-close").addEventListener("click", () => this.toggleSettings(false));
    for (const b of Array.from($("quality").querySelectorAll("button"))) {
      b.addEventListener("click", () => this.onQuality?.(b.dataset.q as Quality));
    }
    addEventListener("keydown", (e) => {
      if (e.code === "Escape" && !$("settings").hidden) this.toggleSettings(false);
    });
  }

  bindInput(input: Input) {
    const hint = $("hint");
    if (matchMedia("(pointer: coarse)").matches) hint.textContent = "Left thumb to walk · right thumb to look";
    input.onLockChange = (locked) => {
      hint.textContent = locked ? "WASD to move · Shift to sprint · Esc to free the mouse" : "Click to look around";
      hint.classList.remove("gone");
      if (locked) setTimeout(() => hint.classList.add("gone"), 4000);
    };
    $("btn-context").addEventListener("touchstart", (e) => (e.preventDefault(), input.press("interact")));
    $("btn-item").addEventListener("touchstart", (e) => (e.preventDefault(), input.press("item")));
    setTimeout(() => hint.classList.add("gone"), 9000);
  }

  show() {
    $("hud").hidden = false;
  }

  toggleSettings(open: boolean) {
    $("settings").hidden = !open;
    if (open) document.exitPointerLock?.();
  }

  setQuality(q: Quality) {
    for (const b of Array.from($("quality").querySelectorAll("button"))) b.classList.toggle("on", b.dataset.q === q);
  }

  setFps(ms: number, q: Quality, api: string) {
    if ($("settings").hidden) return;
    $("fps").textContent = `${(1000 / ms).toFixed(0)} fps · ${ms.toFixed(1)} ms · ${q} · ${api}`;
  }

  setTime(h24: number, m: number) {
    const h = ((h24 + 11) % 12) + 1;
    const s = `${h}:${m.toString().padStart(2, "0")}`;
    if (s !== this.lastTime) {
      $("clocktime").textContent = s;
      this.lastTime = s;
    }
  }
}
