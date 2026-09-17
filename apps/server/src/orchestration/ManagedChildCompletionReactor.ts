import { CommandId, MessageId, type OrchestrationEvent, type ThreadId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./Services/ProjectionSnapshotQuery.ts";

export class ManagedChildCompletionReactor extends Context.Service<
  ManagedChildCompletionReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration/ManagedChildCompletionReactor") {}

type ChildSessionSetEvent = Extract<OrchestrationEvent, { type: "thread.session-set" }>;

function settledChildSession(event: OrchestrationEvent): event is ChildSessionSetEvent {
  return (
    event.type === "thread.session-set" &&
    event.payload.session.status !== "idle" &&
    event.payload.session.status !== "starting" &&
    event.payload.session.status !== "running"
  );
}

function isActiveSession(status: string | undefined): boolean {
  return status === "starting" || status === "running";
}

/** Resume a parent once for every terminal child turn. */
export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;

  const wakeParent = Effect.fn("ManagedChildCompletionReactor.wakeParent")(function* (
    event: ChildSessionSetEvent,
  ) {
    const snapshot = yield* snapshots.getShellSnapshot();
    const child = snapshot.threads.find((thread) => thread.id === event.payload.threadId);
    const parentThreadId = child?.parentThreadId;
    if (child === undefined || parentThreadId === undefined || child.archivedAt !== null) {
      return;
    }
    const parent = snapshot.threads.find((thread) => thread.id === parentThreadId);
    if (
      parent === undefined ||
      parent.archivedAt !== null ||
      isActiveSession(parent.session?.status)
    ) {
      return;
    }

    // A provider may write more than one terminal session status for a turn.
    // The command receipt makes these writes idempotent without retaining a
    // second in-memory completion registry.
    const completionId =
      event.payload.session.activeTurnId ??
      child.latestTurn?.turnId ??
      event.payload.session.updatedAt;
    const commandId = CommandId.make(`server:managed-child-complete:${child.id}:${completionId}`);
    const messageId = MessageId.make(`internal:child-complete:${child.id}:${completionId}`);
    yield* engine.dispatch({
      type: "thread.turn.start",
      commandId,
      threadId: parentThreadId as ThreadId,
      message: {
        messageId,
        role: "user",
        text: `A managed child agent (${child.id}) has settled. Read its result with t3_agent_get, then continue the parent task.`,
        attachments: [],
      },
      modelSelection: parent.modelSelection,
      runtimeMode: parent.runtimeMode,
      interactionMode: parent.interactionMode,
      createdAt: event.occurredAt,
    });
  });

  const processSafely = (event: ChildSessionSetEvent) =>
    wakeParent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
        return Effect.logWarning("managed child completion did not wake parent", {
          childThreadId: event.payload.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processSafely);
  const start: ManagedChildCompletionReactor["Service"]["start"] = Effect.fn(
    "ManagedChildCompletionReactor.start",
  )(function* () {
    const events = yield* engine.subscribeDomainEvents;
    yield* forkParked(
      Stream.runForEach(events, (event) =>
        settledChildSession(event) ? worker.enqueue(event) : Effect.void,
      ),
    );
  });

  return { start, drain: worker.drain } satisfies ManagedChildCompletionReactor["Service"];
});

export const layer = Layer.effect(ManagedChildCompletionReactor, make);
