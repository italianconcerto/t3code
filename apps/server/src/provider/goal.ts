export type GoalCommand =
  | { readonly action: "status" | "pause" | "resume" | "clear" }
  | { readonly action: "set"; readonly objective: string; readonly tokenBudget?: number };

export interface ThreadGoal {
  readonly objective: string;
  readonly status: "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";
  readonly tokensUsed: number;
  readonly tokenBudget?: number | null;
  readonly timeUsedSeconds: number;
}

export const GOAL_SLASH_COMMAND = {
  name: "goal",
  description: "Manage a persistent goal: objective, status, pause, resume, clear",
  input: { hint: "[--budget tokens] objective | status | pause | resume | clear" },
};

export const BTW_SLASH_COMMAND = {
  name: "btw",
  description: "Open an independent side discussion with this conversation's context",
  input: { hint: "question" },
};
