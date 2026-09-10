import { ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { PersistenceDecodeError, PersistenceSqlError } from "./Errors.ts";

export const ManagedGoalStatus = Schema.Literals([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
]);
export type ManagedGoalStatus = typeof ManagedGoalStatus.Type;

export const ManagedGoal = Schema.Struct({
  threadId: ThreadId,
  objective: Schema.String,
  status: ManagedGoalStatus,
  tokenBudget: Schema.NullOr(Schema.Finite),
  tokensUsed: Schema.Finite,
  startedAtMs: Schema.Finite,
  updatedAtMs: Schema.Finite,
  awaitingTurn: Schema.Boolean,
  expectedProviderInstanceId: Schema.NullOr(ProviderInstanceId),
  expectedTurnId: Schema.NullOr(TurnId),
  blockedAttempts: Schema.Finite,
  blockedReason: Schema.NullOr(Schema.String),
});
export type ManagedGoal = typeof ManagedGoal.Type;

const ManagedGoalRow = Schema.Struct({
  threadId: Schema.String,
  objective: Schema.Unknown,
  status: Schema.Unknown,
  tokenBudget: Schema.Unknown,
  tokensUsed: Schema.Unknown,
  startedAtMs: Schema.Unknown,
  updatedAtMs: Schema.Unknown,
  awaitingTurn: Schema.Unknown,
  expectedProviderInstanceId: Schema.Unknown,
  expectedTurnId: Schema.Unknown,
  blockedAttempts: Schema.Unknown,
  blockedReason: Schema.Unknown,
});

type ManagedGoalRepositoryError = PersistenceDecodeError | PersistenceSqlError;

export class ManagedGoalRepository extends Context.Service<
  ManagedGoalRepository,
  {
    readonly get: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<ManagedGoal>, ManagedGoalRepositoryError>;
    readonly listActive: () => Effect.Effect<
      ReadonlyArray<ManagedGoal>,
      ManagedGoalRepositoryError
    >;
    readonly upsert: (goal: ManagedGoal) => Effect.Effect<void, ManagedGoalRepositoryError>;
    readonly delete: (threadId: ThreadId) => Effect.Effect<void, ManagedGoalRepositoryError>;
  }
>()("t3/persistence/ManagedGoals/ManagedGoalRepository") {}

const decode = Schema.decodeUnknownEffect(ManagedGoal);
const mapError = (operation: string) => (cause: unknown) =>
  Schema.isSchemaError(cause)
    ? PersistenceDecodeError.fromSchemaError(`${operation}:decode`, cause)
    : new PersistenceSqlError({ operation, cause });

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const select = (where: "thread" | "active", threadId?: ThreadId) =>
    sql`
      SELECT
        thread_id AS "threadId",
        objective,
        status,
        token_budget AS "tokenBudget",
        tokens_used AS "tokensUsed",
        started_at_ms AS "startedAtMs",
        updated_at_ms AS "updatedAtMs",
        awaiting_turn AS "awaitingTurn",
        expected_provider_instance_id AS "expectedProviderInstanceId",
        expected_turn_id AS "expectedTurnId",
        blocked_attempts AS "blockedAttempts",
        blocked_reason AS "blockedReason"
      FROM managed_goals
      WHERE ${where === "thread" ? sql`thread_id = ${threadId}` : sql`status = 'active'`}
      ORDER BY updated_at_ms ASC
    `;
  const decodeRow = (row: typeof ManagedGoalRow.Type) =>
    decode({
      ...row,
      awaitingTurn: row.awaitingTurn === 1 || row.awaitingTurn === true,
    });

  return ManagedGoalRepository.of({
    get: (threadId) =>
      select("thread", threadId).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ManagedGoalRow))),
        Effect.flatMap((rows) =>
          rows[0] === undefined ? Effect.succeedNone : decodeRow(rows[0]).pipe(Effect.asSome),
        ),
        Effect.mapError(mapError("ManagedGoalRepository.get")),
      ),
    listActive: () =>
      select("active").pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ManagedGoalRow))),
        Effect.flatMap((rows) => Effect.forEach(rows, decodeRow)),
        Effect.mapError(mapError("ManagedGoalRepository.listActive")),
      ),
    upsert: (goal) =>
      sql`
        INSERT INTO managed_goals (
          thread_id, objective, status, token_budget, tokens_used, started_at_ms,
          updated_at_ms, awaiting_turn, blocked_attempts, blocked_reason
          , expected_provider_instance_id, expected_turn_id
        ) VALUES (
          ${goal.threadId}, ${goal.objective}, ${goal.status}, ${goal.tokenBudget},
          ${goal.tokensUsed}, ${goal.startedAtMs}, ${goal.updatedAtMs},
          ${goal.awaitingTurn ? 1 : 0}, ${goal.blockedAttempts}, ${goal.blockedReason},
          ${goal.expectedProviderInstanceId}, ${goal.expectedTurnId}
        )
        ON CONFLICT(thread_id) DO UPDATE SET
          objective = excluded.objective,
          status = excluded.status,
          token_budget = excluded.token_budget,
          tokens_used = excluded.tokens_used,
          started_at_ms = excluded.started_at_ms,
          updated_at_ms = excluded.updated_at_ms,
          awaiting_turn = excluded.awaiting_turn,
          expected_provider_instance_id = excluded.expected_provider_instance_id,
          expected_turn_id = excluded.expected_turn_id,
          blocked_attempts = excluded.blocked_attempts,
          blocked_reason = excluded.blocked_reason
      `.pipe(Effect.asVoid, Effect.mapError(mapError("ManagedGoalRepository.upsert"))),
    delete: (threadId) =>
      sql`DELETE FROM managed_goals WHERE thread_id = ${threadId}`.pipe(
        Effect.asVoid,
        Effect.mapError(mapError("ManagedGoalRepository.delete")),
      ),
  });
});

export const layer = Layer.effect(ManagedGoalRepository, make);
