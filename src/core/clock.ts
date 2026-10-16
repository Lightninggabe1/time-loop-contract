// World clock. Game time is measured in minutes since midnight:
// the loop runs 18:00 (1080) → 24:00 (1440) over LOOP_REAL_SECONDS.
export const LOOP_START = 18 * 60;
export const LOOP_END = 24 * 60;
export const LOOP_REAL_SECONDS = 9 * 60;
/** game minutes per real second (40× real time) */
export const RATE = (LOOP_END - LOOP_START) / LOOP_REAL_SECONDS;

export function minuteAt(realSeconds: number): number {
  return Math.min(LOOP_END, LOOP_START + realSeconds * RATE);
}

export function realSecondsAt(minute: number): number {
  return (minute - LOOP_START) / RATE;
}

/** 1170 → "7:30 PM", 1440 → "12:00 AM" */
export function formatTime(minute: number): { hm: string; ampm: string } {
  const total = Math.floor(minute) % (24 * 60);
  const h24 = Math.floor(total / 60), m = total % 60;
  const h = ((h24 + 11) % 12) + 1;
  return { hm: `${h}:${m.toString().padStart(2, "0")}`, ampm: h24 >= 12 ? "PM" : "AM" };
}
