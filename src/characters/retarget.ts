// Quaternius Universal Animation Library (Rigify "DEF-" names) → Universal
// Base Characters (Unreal-style names). Rest-pose differences are handled by
// Babylon's AnimatorAvatar retargeting.
const side = (s: "L" | "R") => s.toLowerCase();
const map = new Map<string, string>([
  ["DEF-hips", "pelvis"],
  ["DEF-spine.001", "spine_01"],
  ["DEF-spine.002", "spine_02"],
  ["DEF-spine.003", "spine_03"],
  ["DEF-neck", "neck_01"],
  ["DEF-head", "Head"],
]);
for (const s of ["L", "R"] as const) {
  const x = side(s);
  map.set(`DEF-shoulder.${s}`, `clavicle_${x}`);
  map.set(`DEF-upper_arm.${s}`, `upperarm_${x}`);
  map.set(`DEF-forearm.${s}`, `lowerarm_${x}`);
  map.set(`DEF-hand.${s}`, `hand_${x}`);
  for (const f of ["index", "middle", "pinky", "ring"]) for (const n of [1, 2, 3]) map.set(`DEF-f_${f}.0${n}.${s}`, `${f}_0${n}_${x}`);
  for (const n of [1, 2, 3]) map.set(`DEF-thumb.0${n}.${s}`, `thumb_0${n}_${x}`);
  map.set(`DEF-thigh.${s}`, `thigh_${x}`);
  map.set(`DEF-shin.${s}`, `calf_${x}`);
  map.set(`DEF-foot.${s}`, `foot_${x}`);
  map.set(`DEF-toe.${s}`, `ball_${x}`);
}
export const UAL_TO_UBC = map;
