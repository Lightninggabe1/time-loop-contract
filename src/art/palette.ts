// The one palette. Every colour in the game comes from here.
// Art direction: warm art-deco — gold, emerald, deep burgundy, cream marble,
// lacquered black. Light: warm tungsten interiors against cool moonlight.
import { Color3 } from "@babylonjs/core";

const hex = (h: string) => Color3.FromHexString(h).toLinearSpace();

export const Palette = {
  // primaries
  gold: hex("#E2B25C"),
  goldPale: hex("#F3D9A0"),
  brass: hex("#C9A15A"),
  emerald: hex("#124A3A"),
  emeraldLight: hex("#2E7A5E"),
  burgundy: hex("#5C1222"),
  burgundyDeep: hex("#3A0A16"),
  // neutrals
  cream: hex("#ECE2CE"),
  ivory: hex("#F6EEDC"),
  lacquer: hex("#141214"),
  walnut: hex("#4A2A1A"),
  // light colours (not linearised: Babylon light colours are used as-is)
  tungsten: Color3.FromHexString("#FFC27A"),
  candle: Color3.FromHexString("#FFA552"),
  moon: Color3.FromHexString("#7894FF"),
  glowWarm: Color3.FromHexString("#FFD9A0"),
  bankerGreen: Color3.FromHexString("#E4E6A2"), // tungsten under green glass
  // UI (CSS)
  ui: {
    ink: "#F6EEDC",
    gold: "#E2B25C",
    emerald: "#124A3A",
    burgundy: "#5C1222",
    shadow: "rgba(10,6,8,0.72)",
  },
} as const;
