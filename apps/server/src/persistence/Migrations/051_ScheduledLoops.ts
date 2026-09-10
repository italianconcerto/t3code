import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS scheduled_loops (
      thread_id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      interval_ms INTEGER NOT NULL,
      next_run_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      runs INTEGER NOT NULL DEFAULT 0,
      awaiting_completion INTEGER NOT NULL DEFAULT 0,
      expected_provider_instance_id TEXT,
      expected_turn_id TEXT
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_scheduled_loops_next_run
    ON scheduled_loops(next_run_at)
  `;
});
