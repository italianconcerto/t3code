import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layerMemory())("054_ManagedGoalIdentity", (it) => {
  it.effect(
    "assigns distinct identities without losing goal state and does not rotate on restart",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 53 });
        yield* sql`INSERT INTO managed_goals (
      thread_id, objective, status, token_budget, tokens_used, started_at_ms, updated_at_ms,
      awaiting_turn, blocked_attempts, blocked_reason
    ) VALUES ('one', 'Ship it', 'active', 10000, 123, 1, 2, 1, 2, 'Missing credential'),
      ('two', 'Review it', 'paused', NULL, 456, 3, 4, 0, 0, NULL)`;
        const before =
          yield* sql`SELECT thread_id, objective, status, tokens_used, token_budget, blocked_attempts FROM managed_goals ORDER BY thread_id`;
        yield* runMigrations();
        assert.deepEqual(
          yield* sql`SELECT thread_id, objective, status, tokens_used, token_budget, blocked_attempts FROM managed_goals ORDER BY thread_id`,
          before,
        );
        const identities = yield* sql<{
          goal_id: string;
          turn_number: number;
          last_blocked_turn: number;
        }>`SELECT goal_id, turn_number, last_blocked_turn FROM managed_goals ORDER BY thread_id`;
        assert.equal(new Set(identities.map((goal) => goal.goal_id)).size, 2);
        assert.equal(
          identities.every(
            (goal) =>
              goal.goal_id.length > 0 && goal.turn_number === 0 && goal.last_blocked_turn === -1,
          ),
          true,
        );
        yield* runMigrations();
        assert.deepEqual(
          yield* sql`SELECT goal_id, turn_number, last_blocked_turn FROM managed_goals ORDER BY thread_id`,
          identities,
        );
      }),
  );
});
