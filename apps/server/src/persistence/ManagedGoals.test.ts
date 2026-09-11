import { ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { SqlitePersistenceMemory } from "./Layers/Sqlite.ts";
import * as ManagedGoals from "./ManagedGoals.ts";

const layer = ManagedGoals.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory));

it.layer(layer)("ManagedGoalRepository", (it) => {
  it.effect("persists, lists, updates, and deletes goals", () =>
    Effect.gen(function* () {
      const repository = yield* ManagedGoals.ManagedGoalRepository;
      const threadId = ThreadId.make("managed-goal-persistence");
      const goal: ManagedGoals.ManagedGoal = {
        threadId,
        goalId: "persistence-goal",
        turnNumber: 1,
        lastBlockedTurn: -1,
        objective: "Ship the migration",
        status: "active",
        tokenBudget: 5000,
        tokensUsed: 0,
        startedAtMs: 1000,
        updatedAtMs: 1000,
        awaitingTurn: true,
        expectedProviderInstanceId: ProviderInstanceId.make("codex"),
        expectedTurnId: TurnId.make("turn-1"),
        blockedAttempts: 0,
        blockedReason: null,
      };

      yield* repository.upsert(goal);
      assert.deepEqual(Option.getOrUndefined(yield* repository.get(threadId)), goal);
      assert.deepEqual(yield* repository.listActive(), [goal]);

      yield* repository.upsert({ ...goal, status: "complete", awaitingTurn: false });
      assert.equal((yield* repository.listActive()).length, 0);
      assert.equal(Option.getOrUndefined(yield* repository.get(threadId))?.status, "complete");

      yield* repository.delete(threadId);
      assert.equal(Option.isNone(yield* repository.get(threadId)), true);
    }),
  );
});
