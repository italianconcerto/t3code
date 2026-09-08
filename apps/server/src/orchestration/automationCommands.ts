import type { GoalCommand } from "../provider/goal.ts";

export type AutomationCommand =
  | { readonly kind: "goal"; readonly command: GoalCommand }
  | { readonly kind: "loop"; readonly action: "status" | "stop" }
  | {
      readonly kind: "loop";
      readonly action: "start";
      readonly intervalMs: number;
      readonly prompt: string;
    }
  | { readonly kind: "invalid"; readonly detail: string };

export const LOOP_LIFETIME_MS = 3 * 24 * 60 * 60 * 1_000;
export const MAX_ACTIVE_LOOPS = 50;

/** Only whole leading commands are reserved. Quoted text and /goalkeeper remain prompts. */
export function parseAutomationCommand(text: string): AutomationCommand | undefined {
  const match = /^\/(goal|loop)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return undefined;
  const argument = (match[2] ?? "").trim();
  if (match[1]?.toLowerCase() === "goal") {
    const action = argument.toLowerCase();
    if (!action || action === "status") return { kind: "goal", command: { action: "status" } };
    if (action === "pause" || action === "resume" || action === "clear") {
      return { kind: "goal", command: { action } };
    }
    const budgetMatch = /^--budget\s+(\d+)\s+([\s\S]+)$/.exec(argument);
    if (argument.startsWith("--") && !budgetMatch) {
      return {
        kind: "invalid",
        detail:
          "Usage: /goal [--budget positive-token-count] objective | status | pause | resume | clear",
      };
    }
    const objective = (budgetMatch?.[2] ?? argument).trim();
    const tokenBudget = budgetMatch ? Number(budgetMatch[1]) : undefined;
    if (
      !objective ||
      objective.length > 4_000 ||
      (tokenBudget !== undefined && (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0))
    ) {
      return {
        kind: "invalid",
        detail:
          "Goals require an objective of 1–4,000 characters and a positive integer token budget.",
      };
    }
    return {
      kind: "goal",
      command: { action: "set", objective, ...(tokenBudget !== undefined ? { tokenBudget } : {}) },
    };
  }
  if (!argument || argument.toLowerCase() === "status") return { kind: "loop", action: "status" };
  if (argument.toLowerCase() === "stop") return { kind: "loop", action: "stop" };
  const interval = /^(\d+(?:\.\d+)?)(s|m|h|d)\s+([\s\S]+)$/i.exec(argument);
  const intervalMs = interval
    ? Number(interval[1]) *
      ({ s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[interval[2]!.toLowerCase()] ?? 0)
    : 600_000;
  const prompt = (interval?.[3] ?? argument).trim();
  if (
    (/^\d/.test(argument) && !interval) ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 1_000 ||
    intervalMs > LOOP_LIFETIME_MS
  ) {
    return {
      kind: "invalid",
      detail:
        "Usage: /loop [interval] prompt, e.g. /loop 5m check the build. Interval must be between 1s and 3d.",
    };
  }
  if (/^\/(?:goal|loop)(?:\s|$)/i.test(prompt)) {
    return { kind: "invalid", detail: "A loop cannot schedule /goal or /loop commands." };
  }
  return { kind: "loop", action: "start", intervalMs, prompt };
}

export interface ScheduledLoop {
  readonly prompt: string;
  readonly intervalMs: number;
  readonly expiresAt: number;
  nextRunAt: number;
  runs: number;
}

/** Missed intervals coalesce into one run; a busy thread never accumulates a backlog. */
export function claimLoopRun(loop: ScheduledLoop, now: number, busy: boolean): boolean {
  if (busy || now < loop.nextRunAt || now >= loop.expiresAt) return false;
  loop.nextRunAt = now + loop.intervalMs;
  loop.runs++;
  return true;
}
