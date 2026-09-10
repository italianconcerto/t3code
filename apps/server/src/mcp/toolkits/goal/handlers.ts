import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ManagedGoals from "../../../persistence/ManagedGoals.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { GoalToolkit, GoalToolError } from "./tools.ts";

const toResult = (goal: ManagedGoals.ManagedGoal, now: number, message: string) => ({
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
  t3_update_goal: ({ status, reason }) =>
    Effect.gen(function* () {
      const { goal, repository } = yield* requireGoal();
      const now = yield* Clock.currentTimeMillis;
      if (goal.status !== "active") {
        return toResult(goal, now, `Goal is already ${goal.status}.`);
      }
      if (status === "complete") {
        const completed = {
          ...goal,
          status: "complete" as const,
          awaitingTurn: false,
          blockedAttempts: 0,
          blockedReason: null,
          updatedAtMs: now,
        };
        yield* repository
          .upsert(completed)
          .pipe(
            Effect.mapError(
              () => new GoalToolError({ message: "Could not complete the persistent goal." }),
            ),
          );
        return toResult(completed, now, "Goal completed.");
      }

      const blocker = reason?.trim() || "Unspecified blocker";
      const sameBlocker = goal.blockedReason === blocker;
      const blockedAttempts = sameBlocker ? goal.blockedAttempts + 1 : 1;
      const blocked = {
        ...goal,
        status: blockedAttempts >= 3 ? ("blocked" as const) : ("active" as const),
        awaitingTurn: blockedAttempts >= 3 ? false : goal.awaitingTurn,
        blockedAttempts,
        blockedReason: blocker,
        updatedAtMs: now,
      };
      yield* repository
        .upsert(blocked)
        .pipe(
          Effect.mapError(
            () => new GoalToolError({ message: "Could not update the persistent goal." }),
          ),
        );
      return toResult(
        blocked,
        now,
        blocked.status === "blocked"
          ? "Goal blocked after three consecutive reports of the same blocker."
          : `Blocker recorded (${blockedAttempts}/3). Continue with any remaining useful work.`,
      );
    }),
} satisfies Parameters<typeof GoalToolkit.toLayer>[0];

export const GoalToolkitHandlersLive = GoalToolkit.toLayer(goalToolkitHandlers);
