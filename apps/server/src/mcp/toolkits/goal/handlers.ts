import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ManagedGoals from "../../../persistence/ManagedGoals.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { GoalToolkit, GoalToolError } from "./tools.ts";

const toResult = (goal: ManagedGoals.ManagedGoal, now: number, message: string) => ({
  goalId: goal.goalId,
  turnNumber: goal.turnNumber,
  objective: goal.objective,
  status: goal.status,
  tokensUsed: goal.tokensUsed,
  tokenBudget: goal.tokenBudget,
  timeUsedSeconds: Math.max(0, Math.floor((now - goal.startedAtMs) / 1_000)),
  message,
});

const requireGoal = Effect.fn("GoalToolkit.requireGoal")(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  if (!scope.capabilities.has("goal")) {
    return yield* new GoalToolError({
      message: "MCP credential does not grant the goal capability.",
    });
  }
  const repository = yield* ManagedGoals.ManagedGoalRepository;
  const goal = yield* repository
    .get(scope.threadId)
    .pipe(
      Effect.mapError(() => new GoalToolError({ message: "Could not read the persistent goal." })),
    );
  if (Option.isNone(goal)) {
    return yield* new GoalToolError({ message: "No T3-managed goal is active for this thread." });
  }
  return { goal: goal.value, repository };
});

export const goalToolkitHandlers = {
  t3_get_goal: () =>
    Effect.gen(function* () {
      const { goal } = yield* requireGoal();
      return toResult(goal, yield* Clock.currentTimeMillis, "Goal state loaded.");
    }),
  t3_update_goal: ({ goalId, turnNumber, status, reason }) =>
    Effect.gen(function* () {
      const { goal, repository } = yield* requireGoal();
      const now = yield* Clock.currentTimeMillis;
      const blocker = reason?.trim() || "Unspecified blocker";
      const updated = yield* repository
        .modify(goal.threadId, (current) => {
          if (
            current.goalId !== goalId ||
            current.turnNumber !== turnNumber ||
            current.status !== "active"
          )
            return current;
          if (status === "complete")
            return {
              ...current,
              status: "complete",
              awaitingTurn: false,
              blockedAttempts: 0,
              blockedReason: null,
              lastBlockedTurn: -1,
              updatedAtMs: now,
            };
          if (current.lastBlockedTurn === turnNumber) return current;
          const consecutive =
            current.lastBlockedTurn === turnNumber - 1 && current.blockedReason === blocker;
          const blockedAttempts = consecutive ? current.blockedAttempts + 1 : 1;
          return {
            ...current,
            blockedAttempts,
            blockedReason: blocker,
            lastBlockedTurn: turnNumber,
            status: blockedAttempts >= 3 ? "blocked" : "active",
            awaitingTurn: blockedAttempts >= 3 ? false : current.awaitingTurn,
            updatedAtMs: now,
          };
        })
        .pipe(
          Effect.mapError(
            () => new GoalToolError({ message: "Could not update the persistent goal." }),
          ),
        );
      if (
        Option.isNone(updated) ||
        updated.value.goalId !== goalId ||
        updated.value.turnNumber !== turnNumber
      ) {
        return yield* new GoalToolError({
          message: "Goal or turn changed. This stale report was not applied.",
        });
      }
      const blocked = updated.value;
      return toResult(
        blocked,
        now,
        blocked.status === "blocked"
          ? "Goal blocked after three consecutive turns reporting the same blocker."
          : blocked.status === "active"
            ? `Blocker recorded (${blocked.blockedAttempts}/3 distinct turns). Continue with any remaining useful work.`
            : `Goal is ${blocked.status}.`,
      );
    }),
} satisfies Parameters<typeof GoalToolkit.toLayer>[0];

export const GoalToolkitHandlersLive = GoalToolkit.toLayer(goalToolkitHandlers);
