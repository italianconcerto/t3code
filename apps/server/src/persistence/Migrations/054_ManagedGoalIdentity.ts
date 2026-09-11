import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE managed_goals ADD COLUMN goal_id TEXT NOT NULL DEFAULT ''`;
  yield* sql`ALTER TABLE managed_goals ADD COLUMN turn_number INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE managed_goals ADD COLUMN last_blocked_turn INTEGER NOT NULL DEFAULT -1`;
  yield* sql`UPDATE managed_goals SET goal_id = lower(hex(randomblob(16)))`;
});
