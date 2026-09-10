import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import * as ManagedGoals from "../../../persistence/ManagedGoals.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { goalToolkitHandlers } from "./handlers.ts";

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

      const result = yield* goalToolkitHandlers
        .t3_update_goal({ status: "complete" })
        .pipe(Effect.provideService(McpInvocationContext.McpInvocationContext, invocation));
      assert.equal(result.status, "complete");
      assert.equal(Option.getOrUndefined(yield* repository.get(threadId))?.status, "complete");
    }),
  );

  it.effect("requires three consecutive reports of the same blocker", () =>
    Effect.gen(function* () {
      const repository = yield* ManagedGoals.ManagedGoalRepository;
      yield* repository.upsert({
        threadId,
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
      const update = (reason: string) =>
        goalToolkitHandlers
          .t3_update_goal({ status: "blocked", reason })
          .pipe(Effect.provideService(McpInvocationContext.McpInvocationContext, invocation));

      assert.equal((yield* update("missing credential")).status, "active");
      assert.equal((yield* update("different blocker")).status, "active");
      assert.equal((yield* update("missing credential")).status, "active");
      assert.equal((yield* update("missing credential")).status, "active");
      assert.equal((yield* update("missing credential")).status, "blocked");
    }),
  );
});
