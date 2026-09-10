import { ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { SqlitePersistenceMemory } from "./Layers/Sqlite.ts";
import * as ScheduledLoops from "./ScheduledLoops.ts";

it.layer(SqlitePersistenceMemory)("ScheduledLoopRepository", (it) => {
  it.effect("persists, lists, updates, and deletes loops", () =>
    Effect.gen(function* () {
      const repository = yield* ScheduledLoops.ScheduledLoopRepository;
      const threadId = ThreadId.make("scheduled-loop-persistence");
      const loop: ScheduledLoops.ScheduledLoop = {
        threadId,
        prompt: "Check the deployment",
        intervalMs: 30_000,
        nextRunAt: 31_000,
        expiresAt: 86_400_000,
        runs: 0,
        awaitingCompletion: false,
        expectedProviderInstanceId: null,
        expectedTurnId: null,
      };

      yield* repository.upsert(loop);
      assert.deepEqual(Option.getOrUndefined(yield* repository.get(threadId)), loop);
      assert.deepEqual(yield* repository.list(), [loop]);

      yield* repository.upsert({ ...loop, nextRunAt: 61_000, runs: 1 });
      assert.deepEqual(Option.getOrUndefined(yield* repository.get(threadId)), {
        ...loop,
        nextRunAt: 61_000,
        runs: 1,
      });

      yield* repository.delete(threadId);
      assert.equal(Option.isNone(yield* repository.get(threadId)), true);
    }),
  );
});
