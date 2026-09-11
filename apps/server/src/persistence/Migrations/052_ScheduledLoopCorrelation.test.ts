import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import migrate from "./052_ScheduledLoopCorrelation.ts";

it.layer(NodeSqliteClient.layerMemory())("052_ScheduledLoopCorrelation", (it) => {
  it.effect("upgrades early loop schemas without losing scheduled work", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 50 });
      yield* sql`CREATE TABLE scheduled_loops (
        thread_id TEXT PRIMARY KEY, prompt TEXT NOT NULL, interval_ms INTEGER NOT NULL,
        next_run_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, runs INTEGER NOT NULL DEFAULT 0
      )`;
      yield* sql`INSERT INTO scheduled_loops VALUES ('thread-1', 'Check CI', 30000, 31000, 86400000, 2)`;
      yield* runMigrations();
      const rows = yield* sql`SELECT * FROM scheduled_loops`;
      assert.deepEqual(rows, [
        {
          thread_id: "thread-1",
          prompt: "Check CI",
          interval_ms: 30000,
          next_run_at: 31000,
          expires_at: 86400000,
          runs: 2,
          awaiting_completion: 0,
          expected_provider_instance_id: null,
          expected_turn_id: null,
        },
      ]);
      yield* sql`UPDATE scheduled_loops SET awaiting_completion = 1,
        expected_provider_instance_id = 'openrouter', expected_turn_id = 'turn-1'`;
      const before = yield* sql`SELECT * FROM scheduled_loops`;
      yield* migrate;
      assert.deepEqual(yield* sql`SELECT * FROM scheduled_loops`, before);
    }),
  );
});
