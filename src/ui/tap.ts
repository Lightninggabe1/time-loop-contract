// One handler for taps and clicks (see the note below).
/** Fire on a tap or a click, once. Touch "click"s are dropped by some phones while
 *  another finger is down (e.g. still on the joystick), so react to touchend directly. */
export function tap(e: Element, fn: () => void) {
  let touched = 0, sx = 0, sy = 0;
  e.addEventListener("touchstart", (ev) => {
    const t = (ev as TouchEvent).changedTouches[0];
    (sx = t.clientX), (sy = t.clientY);
  }, { passive: true });
  e.addEventListener("touchend", (ev) => {
    const t = (ev as TouchEvent).changedTouches[0];
    if (Math.hypot(t.clientX - sx, t.clientY - sy) > 14) return; // that was a scroll, not a tap
    ev.preventDefault();
    touched = performance.now();
    fn();
  });
  e.addEventListener("click", () => {
    if (performance.now() - touched > 600) fn();
  });
}
