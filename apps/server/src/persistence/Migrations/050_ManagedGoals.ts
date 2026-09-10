import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS managed_goals (
      thread_id TEXT PRIMARY KEY,
      objective TEXT NOT NULL,
      status TEXT NOT NULL,
      token_budget INTEGER,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      started_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      awaiting_turn INTEGER NOT NULL DEFAULT 0,
      expected_provider_instance_id TEXT,
      expected_turn_id TEXT,
      blocked_attempts INTEGER NOT NULL DEFAULT 0,
      blocked_reason TEXT
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_managed_goals_status
    ON managed_goals(status)
  `;
});
