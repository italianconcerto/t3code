import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Early installations of migration 51 predate durable turn correlation.
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(scheduled_loops)`;
  if (!columns.some((column) => column.name === "awaiting_completion")) {
    yield* sql`ALTER TABLE scheduled_loops ADD COLUMN awaiting_completion INTEGER NOT NULL DEFAULT 0`;
  }
  if (!columns.some((column) => column.name === "expected_provider_instance_id")) {
    yield* sql`ALTER TABLE scheduled_loops ADD COLUMN expected_provider_instance_id TEXT`;
  }
  if (!columns.some((column) => column.name === "expected_turn_id")) {
    yield* sql`ALTER TABLE scheduled_loops ADD COLUMN expected_turn_id TEXT`;
  }
});
