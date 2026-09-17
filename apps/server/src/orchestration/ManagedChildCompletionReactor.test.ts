import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationShellSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { ServerActivation } from "../serverActivation.ts";
import * as ManagedChildCompletionReactor from "./ManagedChildCompletionReactor.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

const NOW = "2026-09-17T12:00:00.000Z";
const PROJECT_ID = ProjectId.make("project");
const PARENT_ID = ThreadId.make("parent");
const CHILD_ID = ThreadId.make("child");

function thread(
  id: ThreadId,
  overrides: Partial<OrchestrationShellSnapshot["threads"][number]> = {},
): OrchestrationShellSnapshot["threads"][number] {
  return {
    id,
    projectId: PROJECT_ID,
    title: id,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: NOW,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function childFinished(): Extract<OrchestrationEvent, { type: "thread.session-set" }> {
  return {
    type: "thread.session-set",
    sequence: 1,
    eventId: EventId.make("child-finished"),
    aggregateKind: "thread",
    aggregateId: CHILD_ID,
    occurredAt: NOW,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      threadId: CHILD_ID,
      session: {
        threadId: CHILD_ID,
        status: "ready",
        providerName: "Codex",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: NOW,
      },
    },
  };
}

describe("ManagedChildCompletionReactor", () => {
  it.effect("wakes the settled parent when a managed child terminates", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const events = yield* PubSub.unbounded<OrchestrationEvent>();
        const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
        const subscribed = yield* Deferred.make<void>();
        const dispatched = yield* Deferred.make<void>();
        const snapshot = yield* Ref.make<OrchestrationShellSnapshot>({
          snapshotSequence: 1,
          projects: [],
          threads: [thread(PARENT_ID), thread(CHILD_ID, { parentThreadId: PARENT_ID })],
          updatedAt: NOW,
        });
        const activation = yield* Deferred.make<void>();
        const dependencies = Layer.mergeAll(
          Layer.succeed(ServerActivation, Deferred.await(activation)),
          Layer.mock(ProjectionSnapshotQuery)({ getShellSnapshot: () => Ref.get(snapshot) }),
          Layer.mock(OrchestrationEngineService)({
            subscribeDomainEvents: PubSub.subscribe(events).pipe(
              Effect.tap(() => Deferred.succeed(subscribed, undefined)),
              Effect.map((subscription) => Stream.fromSubscription(subscription)),
            ),
            dispatch: (command) =>
              Ref.update(commands, (current) => [...current, command]).pipe(
                Effect.tap(() => Deferred.succeed(dispatched, undefined)),
                Effect.as({ sequence: 2 }),
              ),
          }),
        );
        const program = Effect.gen(function* () {
          const reactor = yield* ManagedChildCompletionReactor.ManagedChildCompletionReactor;
          yield* reactor.start();
          yield* Deferred.succeed(activation, undefined);
          yield* Deferred.await(subscribed);
          yield* PubSub.publish(events, childFinished());
          yield* Deferred.await(dispatched);
          yield* reactor.drain;
          return yield* Ref.get(commands);
        }).pipe(
          Effect.provide(ManagedChildCompletionReactor.layer.pipe(Layer.provide(dependencies))),
        );

        const dispatchedCommands = yield* program;
        expect(dispatchedCommands).toHaveLength(1);
        expect(dispatchedCommands[0]).toMatchObject({
          type: "thread.turn.start",
          threadId: PARENT_ID,
          message: { messageId: "internal:child-complete:child:2026-09-17T12:00:00.000Z" },
        });
      }),
    ),
  );

  it.effect("does not interrupt a parent that is already working", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const events = yield* PubSub.unbounded<OrchestrationEvent>();
        const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
        const subscribed = yield* Deferred.make<void>();
        const snapshot = yield* Ref.make<OrchestrationShellSnapshot>({
          snapshotSequence: 1,
          projects: [],
          threads: [
            thread(PARENT_ID, {
              session: {
                threadId: PARENT_ID,
                status: "running",
                providerName: "Codex",
                runtimeMode: "full-access",
                activeTurnId: null,
                lastError: null,
                updatedAt: NOW,
              },
            }),
            thread(CHILD_ID, { parentThreadId: PARENT_ID }),
          ],
          updatedAt: NOW,
        });
        const dependencies = Layer.mergeAll(
          Layer.mock(ProjectionSnapshotQuery)({ getShellSnapshot: () => Ref.get(snapshot) }),
          Layer.mock(OrchestrationEngineService)({
            subscribeDomainEvents: PubSub.subscribe(events).pipe(
              Effect.tap(() => Deferred.succeed(subscribed, undefined)),
              Effect.map((subscription) => Stream.fromSubscription(subscription)),
            ),
            dispatch: (command) =>
              Ref.update(commands, (current) => [...current, command]).pipe(
                Effect.as({ sequence: 2 }),
              ),
          }),
        );
        const program = Effect.gen(function* () {
          const reactor = yield* ManagedChildCompletionReactor.ManagedChildCompletionReactor;
          yield* reactor.start();
          yield* Deferred.await(subscribed);
          yield* PubSub.publish(events, childFinished());
          yield* reactor.drain;
          return yield* Ref.get(commands);
        }).pipe(
          Effect.provide(ManagedChildCompletionReactor.layer.pipe(Layer.provide(dependencies))),
        );

        expect(yield* program).toHaveLength(0);
      }),
    ),
  );
});
