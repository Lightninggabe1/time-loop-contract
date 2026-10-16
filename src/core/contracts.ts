// Contracts: JSON-defined objectives, each solvable through several
// approaches (quiet / social / loud / chaos) shown as a simple checklist.
import { Cond, CondCtx, test } from "./conditions";

export type ApproachKind = "quiet" | "social" | "loud" | "chaos";

export interface StepDef {
  text: string;
  done: Cond;
}

export interface ApproachDef {
  id: string;
  kind: ApproachKind;
  title: string;
  steps: StepDef[];
  /** contract succeeds via this approach when this holds */
  complete: Cond;
}

export interface ContractDef {
  id: string;
  title: string;
  client: string;
  target: string; // npc id
  brief: string;
  unlock?: Cond;
  approaches: ApproachDef[];
  reward: number; // memory points
}

export interface ApproachStatus {
  approach: ApproachDef;
  steps: { text: string; done: boolean }[];
  progress: number; // 0..1
  complete: boolean;
}

export interface ContractStatus {
  contract: ContractDef;
  approaches: ApproachStatus[];
  complete: ApproachDef | null;
  /** the approach the player is furthest along (for the HUD checklist) */
  focus: ApproachStatus;
}

export function contractStatus(c: ContractDef, ctx: CondCtx): ContractStatus {
  const approaches = c.approaches.map((a) => {
    const steps = a.steps.map((s) => ({ text: s.text, done: test(s.done, ctx) }));
    const complete = test(a.complete, ctx);
    return { approach: a, steps, complete, progress: complete ? 1 : steps.filter((s) => s.done).length / Math.max(1, steps.length) };
  });
  const complete = approaches.find((a) => a.complete)?.approach ?? null;
  const focus = [...approaches].sort((a, b) => b.progress - a.progress)[0];
  return { contract: c, approaches, complete, focus };
}

export function validateContract(c: ContractDef) {
  const kinds = new Set(c.approaches.map((a) => a.kind));
  for (const k of ["quiet", "social", "loud", "chaos"] as const) {
    if (!kinds.has(k)) throw new Error(`Contract ${c.id} has no ${k} approach (hard rule: 4 ways)`);
  }
}
