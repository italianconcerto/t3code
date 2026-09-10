import { ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { PersistenceDecodeError, PersistenceSqlError } from "./Errors.ts";

export const ScheduledLoop = Schema.Struct({
  threadId: ThreadId,
  prompt: Schema.String,
  intervalMs: Schema.Finite,
  nextRunAt: Schema.Finite,
  expiresAt: Schema.Finite,
  runs: Schema.Finite,
  awaitingCompletion: Schema.Boolean,
  expectedProviderInstanceId: Schema.NullOr(ProviderInstanceId),
  expectedTurnId: Schema.NullOr(TurnId),
});
export type ScheduledLoop = typeof ScheduledLoop.Type;

const ScheduledLoopRow = Schema.Struct({
  threadId: Schema.String,
  prompt: Schema.Unknown,
  intervalMs: Schema.Unknown,
  nextRunAt: Schema.Unknown,
  expiresAt: Schema.Unknown,
  runs: Schema.Unknown,
  awaitingCompletion: Schema.Number,
  expectedProviderInstanceId: Schema.NullOr(Schema.String),
  expectedTurnId: Schema.NullOr(Schema.String),
});

type ScheduledLoopRepositoryError = PersistenceDecodeError | PersistenceSqlError;

export class ScheduledLoopRepository extends Context.Service<
  ScheduledLoopRepository,
  {
    readonly get: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<ScheduledLoop>, ScheduledLoopRepositoryError>;
    readonly list: () => Effect.Effect<ReadonlyArray<ScheduledLoop>, ScheduledLoopRepositoryError>;
    readonly upsert: (loop: ScheduledLoop) => Effect.Effect<void, ScheduledLoopRepositoryError>;
    readonly delete: (threadId: ThreadId) => Effect.Effect<void, ScheduledLoopRepositoryError>;
  }
>()("t3/persistence/ScheduledLoops/ScheduledLoopRepository") {}

const decode = Schema.decodeUnknownEffect(ScheduledLoop);
const mapError = (operation: string) => (cause: unknown) =>
  Schema.isSchemaError(cause)
    ? PersistenceDecodeError.fromSchemaError(`${operation}:decode`, cause)
    : new PersistenceSqlError({ operation, cause });

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const select = (threadId?: ThreadId) => sql`
    SELECT
      thread_id AS "threadId",
      prompt,
      interval_ms AS "intervalMs",
      next_run_at AS "nextRunAt",
      expires_at AS "expiresAt",
      runs,
      awaiting_completion AS "awaitingCompletion",
      expected_provider_instance_id AS "expectedProviderInstanceId",
      expected_turn_id AS "expectedTurnId"
    FROM scheduled_loops
    ${threadId === undefined ? sql`` : sql`WHERE thread_id = ${threadId}`}
    ORDER BY next_run_at ASC
  `;
  const decodeRow = (row: typeof ScheduledLoopRow.Type) =>
    decode({ ...row, awaitingCompletion: row.awaitingCompletion === 1 });
  const decodeRows = (rows: ReadonlyArray<typeof ScheduledLoopRow.Type>) =>
    Effect.forEach(rows, decodeRow);

  return ScheduledLoopRepository.of({
    get: (threadId) =>
      select(threadId).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ScheduledLoopRow))),
        Effect.flatMap((rows) =>
          rows[0] === undefined ? Effect.succeedNone : decodeRow(rows[0]).pipe(Effect.asSome),
        ),
        Effect.mapError(mapError("ScheduledLoopRepository.get")),
      ),
    list: () =>
      select().pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ScheduledLoopRow))),
        Effect.flatMap(decodeRows),
        Effect.mapError(mapError("ScheduledLoopRepository.list")),
      ),
    upsert: (loop) =>
      sql`
        INSERT INTO scheduled_loops (
          thread_id, prompt, interval_ms, next_run_at, expires_at, runs,
          awaiting_completion, expected_provider_instance_id, expected_turn_id
        ) VALUES (
          ${loop.threadId}, ${loop.prompt}, ${loop.intervalMs}, ${loop.nextRunAt},
          ${loop.expiresAt}, ${loop.runs}, ${loop.awaitingCompletion ? 1 : 0},
          ${loop.expectedProviderInstanceId}, ${loop.expectedTurnId}
        )
        ON CONFLICT(thread_id) DO UPDATE SET
          prompt = excluded.prompt,
          interval_ms = excluded.interval_ms,
          next_run_at = excluded.next_run_at,
          expires_at = excluded.expires_at,
          runs = excluded.runs,
          awaiting_completion = excluded.awaiting_completion,
          expected_provider_instance_id = excluded.expected_provider_instance_id,
          expected_turn_id = excluded.expected_turn_id
      `.pipe(Effect.asVoid, Effect.mapError(mapError("ScheduledLoopRepository.upsert"))),
    delete: (threadId) =>
      sql`DELETE FROM scheduled_loops WHERE thread_id = ${threadId}`.pipe(
        Effect.asVoid,
        Effect.mapError(mapError("ScheduledLoopRepository.delete")),
      ),
  });
});

export const layer = Layer.effect(ScheduledLoopRepository, make);
