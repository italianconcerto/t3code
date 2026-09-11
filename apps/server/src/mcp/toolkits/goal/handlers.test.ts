import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import * as ManagedGoals from "../../../persistence/ManagedGoals.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { goalToolkitHandlers } from "./handlers.ts";
import { GoalToolkit } from "./tools.ts";

const decodeUpdateGoal = Schema.decodeUnknownEffect(
  GoalToolkit.tools.t3_update_goal.parametersSchema,
);
const threadId = ThreadId.make("goal-tool-thread");
const invocation = McpInvocationContext.McpInvocationContext.of({
  environmentId: EnvironmentId.make("goal-tool-environment"),
  threadId,
  providerSessionId: "goal-tool-session",
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  capabilities: new Set(["goal"]),
  issuedAt: 1000,
});
const layer = ManagedGoals.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory));

it.layer(layer)("goal MCP tools", (it) => {
  it.effect("completes a verified goal", () =>
    Effect.gen(function* () {
      const repository = yield* ManagedGoals.ManagedGoalRepository;
      yield* repository.upsert({
        threadId,
        goalId: "complete-goal",
        turnNumber: 1,
        lastBlockedTurn: -1,
        objective: "Finish it",
        status: "active",
        tokenBudget: null,
        tokensUsed: 42,
        startedAtMs: 1000,
        updatedAtMs: 1000,
        awaitingTurn: true,
        expectedProviderInstanceId: ProviderInstanceId.make("claudeAgent"),
        expectedTurnId: null,
        blockedAttempts: 0,
        blockedReason: null,
      });

      const input = yield* decodeUpdateGoal({
        goalId: "complete-goal",
        turnNumber: 1,
        status: "complete",
        reason: null,
      });
      const result = yield* goalToolkitHandlers
        .t3_update_goal(input)
        .pipe(Effect.provideService(McpInvocationContext.McpInvocationContext, invocation));
      assert.equal(result.status, "complete");
      assert.equal(Option.getOrUndefined(yield* repository.get(threadId))?.status, "complete");
    }),
  );

  it.effect("requires three consecutive distinct turns and rejects stale goal reports", () =>
    Effect.gen(function* () {
      const repository = yield* ManagedGoals.ManagedGoalRepository;
      yield* repository.upsert({
        threadId,
        goalId: "blocked-goal",
        turnNumber: 1,
        lastBlockedTurn: -1,
        objective: "Finish it",
        status: "active",
        tokenBudget: null,
        tokensUsed: 0,
        startedAtMs: 1000,
        updatedAtMs: 1000,
        awaitingTurn: true,
        expectedProviderInstanceId: ProviderInstanceId.make("claudeAgent"),
        expectedTurnId: null,
        blockedAttempts: 0,
        blockedReason: null,
      });
      const update = (turnNumber: number, reason: string) =>
        goalToolkitHandlers
          .t3_update_goal({ goalId: "blocked-goal", turnNumber, status: "blocked", reason })
          .pipe(Effect.provideService(McpInvocationContext.McpInvocationContext, invocation));

      const reports = yield* Effect.all(
        Array.from({ length: 3 }, () => update(1, "missing credential")),
        { concurrency: "unbounded" },
      );
      assert.equal(
        reports.every((report) => report.status === "active"),
        true,
      );
      assert.equal(Option.getOrThrow(yield* repository.get(threadId)).blockedAttempts, 1);
      yield* repository.modify(threadId, (goal) => ({ ...goal, turnNumber: 2 }));
      assert.equal((yield* update(1, "missing credential").pipe(Effect.exit))._tag, "Failure");
      assert.equal((yield* update(2, "missing credential")).status, "active");
      // A turn without a blocker report breaks the consecutive-turn audit.
      yield* repository.modify(threadId, (goal) => ({ ...goal, turnNumber: 4 }));
      assert.equal((yield* update(4, "missing credential")).status, "active");
      assert.equal(Option.getOrThrow(yield* repository.get(threadId)).blockedAttempts, 1);
      yield* repository.modify(threadId, (goal) => ({ ...goal, turnNumber: 5 }));
      assert.equal((yield* update(5, "missing credential")).status, "active");
      yield* repository.modify(threadId, (goal) => ({ ...goal, turnNumber: 6 }));
      assert.equal((yield* update(6, "missing credential")).status, "blocked");
      yield* repository.modify(threadId, (goal) => ({
        ...goal,
        goalId: "replacement-goal",
        status: "active",
      }));
      const stale = yield* goalToolkitHandlers
        .t3_update_goal({ goalId: "blocked-goal", turnNumber: 6, status: "complete" })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.exit,
        );
      assert.equal(stale._tag, "Failure");
      assert.equal(Option.getOrThrow(yield* repository.get(threadId)).status, "active");
    }),
  );
});
