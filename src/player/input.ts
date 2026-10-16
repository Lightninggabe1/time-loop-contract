// Unified input: keyboard + mouse (pointer lock, drag fallback), touch
// (left virtual stick, right-side look, context + item buttons), gamepad.
export interface InputState {
  move: { x: number; y: number }; // x = strafe right, y = forward; |v| ≤ 1
  look: { x: number; y: number }; // accumulated radians this frame
  sprint: boolean;
  interact: boolean; // edge-triggered
  item: boolean; // edge-triggered
  board: boolean; // edge-triggered
}

export class Input {
  private keys = new Set<string>();
  private lookAcc = { x: 0, y: 0 };
  private edges = { interact: false, item: false, board: false };
  private stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private lookTouch = { id: -1, x: 0, y: 0 };
  private dragging = false;
  sensitivity = 0.0024;
  touchSensitivity = 0.0055;
  locked = false;
  onLockChange?: (locked: boolean) => void;

  constructor(private canvas: HTMLCanvasElement, private stickEl?: HTMLElement) {
    addEventListener("keydown", (e) => {
      if (e.code === "Tab") e.preventDefault();
      if (!e.repeat) {
        if (e.code === "KeyE") this.edges.interact = true;
        if (e.code === "KeyQ" || e.code === "KeyF") this.edges.item = true;
        if (e.code === "Tab") this.edges.board = true;
      }
      this.keys.add(e.code);
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => this.keys.clear());

    canvas.addEventListener("click", () => {
      if (matchMedia("(pointer: coarse)").matches) return;
      if (!this.locked) canvas.requestPointerLock?.()?.catch?.(() => undefined);
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange?.(this.locked);
    });
    addEventListener("mousemove", (e) => {
      if (this.locked || this.dragging) {
        this.lookAcc.x += e.movementX * this.sensitivity;
        this.lookAcc.y += e.movementY * this.sensitivity;
      }
    });
    // drag-to-look fallback when pointer lock is unavailable
    canvas.addEventListener("mousedown", (e) => {
      if (!this.locked && e.button === 0 && !document.pointerLockElement) this.dragging = true;
    });
    addEventListener("mouseup", () => (this.dragging = false));

    canvas.addEventListener("touchstart", (e) => this.touch(e, "start"), { passive: false });
    canvas.addEventListener("touchmove", (e) => this.touch(e, "move"), { passive: false });
    canvas.addEventListener("touchend", (e) => this.touch(e, "end"), { passive: false });
    canvas.addEventListener("touchcancel", (e) => this.touch(e, "end"), { passive: false });
  }

  press(button: "interact" | "item" | "board") {
    this.edges[button] = true;
  }

  private touch(e: TouchEvent, phase: "start" | "move" | "end") {
    e.preventDefault();
    const w = this.canvas.clientWidth;
    for (const t of Array.from(e.changedTouches)) {
      if (phase === "start") {
        if (t.clientX < w * 0.42 && this.stick.id < 0) {
          this.stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 };
          this.showStick(t.clientX, t.clientY, 0, 0);
        } else if (this.lookTouch.id < 0) {
          this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
        }
      } else if (phase === "move") {
        if (t.identifier === this.stick.id) {
          const R = 56;
          let dx = (t.clientX - this.stick.ox) / R, dy = (t.clientY - this.stick.oy) / R;
          const l = Math.hypot(dx, dy);
          if (l > 1) (dx /= l), (dy /= l);
          this.stick.x = dx;
          this.stick.y = dy;
          this.showStick(this.stick.ox, this.stick.oy, dx * R, dy * R);
        } else if (t.identifier === this.lookTouch.id) {
          this.lookAcc.x += (t.clientX - this.lookTouch.x) * this.touchSensitivity;
          this.lookAcc.y += (t.clientY - this.lookTouch.y) * this.touchSensitivity;
          this.lookTouch.x = t.clientX;
          this.lookTouch.y = t.clientY;
        }
      } else {
        if (t.identifier === this.stick.id) {
          this.stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
          this.hideStick();
        }
        if (t.identifier === this.lookTouch.id) this.lookTouch.id = -1;
      }
    }
  }

  private showStick(x: number, y: number, kx: number, ky: number) {
    if (!this.stickEl) return;
    this.stickEl.style.display = "block";
    this.stickEl.style.left = `${x}px`;
    this.stickEl.style.top = `${y}px`;
    (this.stickEl.firstElementChild as HTMLElement).style.transform = `translate(${kx}px, ${ky}px)`;
  }
  private hideStick() {
    if (this.stickEl) this.stickEl.style.display = "none";
  }

  read(): InputState {
    const k = this.keys;
    let x = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    let y = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    let sprint = k.has("ShiftLeft") || k.has("ShiftRight");
    if (this.stick.id >= 0) {
      x += this.stick.x;
      y -= this.stick.y;
      sprint ||= Math.hypot(this.stick.x, this.stick.y) > 0.95;
    }
    // gamepad
    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      x += dz(pad.axes[0]);
      y -= dz(pad.axes[1]);
      this.lookAcc.x += dz(pad.axes[2]) * 0.05;
      this.lookAcc.y += dz(pad.axes[3]) * 0.05;
      sprint ||= !!pad.buttons[10]?.pressed || !!pad.buttons[4]?.pressed;
      if (pad.buttons[0]?.pressed) this.edges.interact = true;
      if (pad.buttons[2]?.pressed) this.edges.item = true;
    }
    const l = Math.hypot(x, y);
    if (l > 1) (x /= l), (y /= l);
    const s: InputState = {
      move: { x, y },
      look: { ...this.lookAcc },
      sprint,
      ...this.edges,
    };
    this.lookAcc.x = this.lookAcc.y = 0;
    this.edges = { interact: false, item: false, board: false };
    return s;
  }
}
