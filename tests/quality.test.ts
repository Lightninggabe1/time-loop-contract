import { describe, it, expect } from "vitest";
import { stepDown, PRESETS } from "../src/render/quality";

describe("quality presets", () => {
  it("steps down only when frames are slow", () => {
    expect(stepDown("high", 12)).toBeNull();
    expect(stepDown("high", 25)).toBe("medium");
    expect(stepDown("medium", 35)).toBe("low");
    expect(stepDown("low", 80)).toBeNull();
  });
  it("presets get strictly cheaper", () => {
    expect(PRESETS.high.maxDpr).toBeGreaterThanOrEqual(PRESETS.medium.maxDpr);
    expect(PRESETS.medium.maxDpr).toBeGreaterThanOrEqual(PRESETS.low.maxDpr);
    expect(PRESETS.low.ssao).toBe(false);
    expect(PRESETS.low.reflections).toBe(0);
  });
});
