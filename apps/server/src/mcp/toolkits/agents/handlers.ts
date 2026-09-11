import * as NodeCrypto from "node:crypto";
import { stableStringify } from "@t3tools/shared/relaySigning";
import {
  CommandId,
  MessageId,
  ThreadId,
  type OrchestrationThreadShell,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../../../provider/Services/ProviderRegistry.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";
import { AgentsToolkit, AgentToolError } from "./tools.ts";

const requestKey = (parent: ThreadId, requestId: string, operation: string) =>
  NodeCrypto.createHash("sha256")
    .update(JSON.stringify([parent, requestId, operation]))
    .digest("hex");

const available = (provider: ServerProvider) =>
  provider.enabled &&
  provider.installed &&
  provider.availability !== "unavailable" &&
  provider.auth.status !== "unauthenticated";

const summarize = (thread: OrchestrationThreadShell) => ({
  threadId: thread.id,
  title: thread.title,
  modelSelection: thread.modelSelection,
  status: thread.session?.status ?? (thread.latestUserMessageAt ? "pending" : "idle"),
});

const childPrecondition = (parent: OrchestrationThreadShell, child: OrchestrationThreadShell) => ({
  parentThreadId: parent.id,
  parentCreatedAt: parent.createdAt,
  childCreatedAt: child.createdAt,
});

const context = Effect.fn("AgentsToolkit.context")(function* () {
  const scope = yield* McpInvocationContext;
  if (!scope.capabilities.has("agents")) {
    return yield* new AgentToolError({
      message: "MCP credential does not grant the agents capability.",
    });
  }
  const query = yield* ProjectionSnapshotQuery;
  const parent = yield* query
    .getThreadShellById(scope.threadId)
    .pipe(
      Effect.mapError(() => new AgentToolError({ message: "Could not read the parent chat." })),
    );
  if (Option.isNone(parent) || parent.value.archivedAt !== null) {
    return yield* new AgentToolError({ message: "The parent chat is no longer active." });
  }
  return { scope, query, parent: parent.value };
});

const childContext = Effect.fn("AgentsToolkit.childContext")(function* (threadId: ThreadId) {
  const owner = yield* context();
  const child = yield* owner.query
    .getThreadShellById(threadId)
    .pipe(Effect.mapError(() => new AgentToolError({ message: "Could not read the child chat." })));
  if (
    Option.isNone(child) ||
    child.value.parentThreadId !== owner.parent.id ||
    child.value.projectId !== owner.parent.projectId
  ) {
    return yield* new AgentToolError({ message: "No accessible child chat with that id." });
  }
  return { ...owner, child: child.value };
});

export const agentsToolkitHandlers = {
  t3_agent_models: ({ instanceId, offset = 0 } = {}) =>
    Effect.gen(function* () {
      yield* context();
      const registry = yield* ProviderRegistry;
      const catalog = (yield* registry.getProviders)
        .filter(
          (provider) =>
            available(provider) && (instanceId === undefined || provider.instanceId === instanceId),
        )
        .flatMap((provider) =>
          provider.models.map((model) => ({
            modelSelection: { instanceId: provider.instanceId, model: model.slug },
            providerName: provider.displayName ?? provider.driver,
            modelName: model.name,
          })),
        );
      catalog.sort(
        (a, b) =>
          a.modelSelection.instanceId.localeCompare(b.modelSelection.instanceId) ||
          a.modelSelection.model.localeCompare(b.modelSelection.model),
      );
      const models = catalog.slice(offset, offset + 50);
      // MCP encodes results as both text and structured content. Bound each page in bytes.
      while (Buffer.byteLength(stableStringify(models), "utf8") > 24_000) {
        if (models.length <= 1) {
          return yield* new AgentToolError({
            message: "Model metadata exceeds the response limit.",
          });
        }
        models.pop();
      }
      const nextOffset = offset + models.length < catalog.length ? offset + models.length : null;
      return { models, nextOffset };
    }),
  t3_agent_spawn: ({ requestId, title, prompt, modelSelection }) =>
    Effect.gen(function* () {
      const { parent } = yield* context();
      const registry = yield* ProviderRegistry;
      const provider = (yield* registry.getProviders).find(
        (entry) => entry.instanceId === modelSelection.instanceId && available(entry),
      );
      if (!provider?.models.some((model) => model.slug === modelSelection.model)) {
        return yield* new AgentToolError({
          message: "Choose an available provider instance and model from t3_agent_models.",
        });
      }
      const engine = yield* OrchestrationEngineService;
      const key = requestKey(parent.id, requestId, `spawn:${parent.createdAt}`);
      // A fixed command id plus a payload-addressed aggregate lets the engine's
      // atomic receipt conflict check reject changed retry payloads, even when
      // two callers race before either has written the child.
      const payloadKey = NodeCrypto.createHash("sha256")
        .update(stableStringify({ key, title, prompt, modelSelection }))
        .digest("hex");
      const threadId = ThreadId.make(`agent-${payloadKey}`);
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* engine
        .dispatch({
          type: "thread.create",
          commandId: CommandId.make(`agent-create-${key}`),
          threadId,
          parentThreadId: parent.id,
          projectId: parent.projectId,
          title,
          modelSelection,
          runtimeMode: parent.runtimeMode,
          interactionMode: parent.interactionMode,
          branch: parent.branch,
          worktreePath: parent.worktreePath,
          createdAt,
        })
        .pipe(
          Effect.mapError(
            () =>
              new AgentToolError({
                message:
                  "Could not create the child chat. Retry with identical input, or use a new requestId for a new task.",
              }),
          ),
        );
      const { child } = yield* childContext(threadId);
      if (child.archivedAt !== null) {
        return yield* new AgentToolError({
          message:
            "This spawn request belongs to an archived child. Restore it or use a new requestId.",
        });
      }
      const started = yield* engine
        .dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(`agent-start-${key}`),
          threadId,
          managedChild: childPrecondition(parent, child),
          message: {
            messageId: MessageId.make(`agent-message-${key}`),
            role: "user",
            text: prompt,
            attachments: [],
          },
          modelSelection,
          runtimeMode: parent.runtimeMode,
          interactionMode: parent.interactionMode,
          createdAt,
        })
        .pipe(
          Effect.mapError(
            () =>
              new AgentToolError({
                message: `Child ${threadId} was created, but start failed. Inspect its state; use t3_agent_send with a new requestId to recover an active child.`,
              }),
          ),
        );
      return {
        threadId,
        sequence: started.sequence,
        message: "Child chat created; its first turn has been requested.",
      };
    }),
  t3_agent_list: () =>
    Effect.gen(function* () {
      const { query, parent } = yield* context();
      const snapshot = yield* query
        .getShellSnapshot()
        .pipe(
          Effect.mapError(() => new AgentToolError({ message: "Could not list child chats." })),
        );
      return snapshot.threads
        .filter(
          (thread) => thread.parentThreadId === parent.id && thread.projectId === parent.projectId,
        )
        .map(summarize);
    }),
  t3_agent_get: ({ threadId }) =>
    Effect.gen(function* () {
      const { child, query } = yield* childContext(threadId);
      const detail = yield* query
        .getThreadDetailSnapshot(threadId, { turnLimit: 1 })
        .pipe(
          Effect.mapError(
            () =>
              new AgentToolError({ message: "Could not read the child chat's recent activity." }),
          ),
        );
      if (Option.isNone(detail)) {
        return yield* new AgentToolError({ message: "The child chat is no longer available." });
      }
      const result = {
        ...summarize(child),
        sequence: detail.value.snapshotSequence,
        truncated:
          detail.value.thread.messages.length > 10 || detail.value.thread.activities.length > 20,
        messages: detail.value.thread.messages.slice(-10).map((message) => ({
          role: message.role,
          text: message.text.slice(-8000),
          truncated: message.text.length > 8000,
        })),
        activities: detail.value.thread.activities
          .slice(-20)
          .map((activity) => ({ kind: activity.kind, summary: activity.summary.slice(-1000) })),
      };
      // MCP may encode both text and structured content. Leave room for both
      // copies, JSON escaping and transport metadata, including multibyte text.
      while (Buffer.byteLength(stableStringify(result), "utf8") > 24_000) {
        result.truncated = true;
        if (result.activities.length > 0) result.activities.shift();
        else if (result.messages.length > 1) result.messages.shift();
        else if (result.messages[0] && result.messages[0].text.length > 0) {
          const message = result.messages[0];
          message.text = message.text.slice(Math.ceil(message.text.length / 2));
          message.truncated = true;
        } else {
          return yield* new AgentToolError({
            message: "Child metadata exceeds the MCP result limit. Open the child chat directly.",
          });
        }
      }
      result.truncated ||=
        result.messages.some((message) => message.truncated) ||
        detail.value.thread.activities.some((activity) => activity.summary.length > 1000);
      return result;
    }),
  t3_agent_stop: ({ threadId, requestId }) =>
    Effect.gen(function* () {
      const { parent, child } = yield* childContext(threadId);
      const engine = yield* OrchestrationEngineService;
      yield* engine
        .dispatch({
          type: "thread.turn.interrupt",
          commandId: CommandId.make(`agent-stop-${requestKey(parent.id, requestId, threadId)}`),
          threadId: child.id,
          managedChild: childPrecondition(parent, child),
          createdAt: DateTime.formatIso(yield* DateTime.now),
        })
        .pipe(
          Effect.mapError(
            () => new AgentToolError({ message: "Could not request child interruption." }),
          ),
        );
      return {
        threadId,
        message: "Interruption requested. The child chat and history are retained.",
      };
    }),
  t3_agent_send: ({ threadId, requestId, prompt }) =>
    Effect.gen(function* () {
      const { parent, child, query } = yield* childContext(threadId);
      if (child.archivedAt !== null) {
        return yield* new AgentToolError({
          message: "Restore the archived child chat before sending instructions.",
        });
      }
      const key = requestKey(parent.id, requestId, `send:${threadId}`);
      const engine = yield* OrchestrationEngineService;
      yield* engine
        .dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(`agent-send-${key}`),
          threadId,
          managedChild: childPrecondition(parent, child),
          message: {
            messageId: MessageId.make(`agent-message-${key}`),
            role: "user",
            text: prompt,
            attachments: [],
          },
          runtimeMode: child.runtimeMode,
          interactionMode: child.interactionMode,
          createdAt: DateTime.formatIso(yield* DateTime.now),
        })
        .pipe(
          Effect.mapError(
            () =>
              new AgentToolError({
                message: "Could not send child instructions. Retry with the same requestId.",
              }),
          ),
        );
      const recorded = yield* query
        .getTurnStartMessage({ threadId, messageId: MessageId.make(`agent-message-${key}`) })
        .pipe(
          Effect.mapError(
            () =>
              new AgentToolError({ message: "Could not confirm the recorded child instructions." }),
          ),
        );
      if (Option.isNone(recorded) || recorded.value.message.text !== prompt) {
        return yield* new AgentToolError({
          message:
            "This requestId was already used for different instructions. Use a new requestId.",
        });
      }
      return { threadId, message: "Instructions recorded and delivery requested." };
    }),
  t3_agent_wait: ({ threadId, afterSequence, timeoutSeconds = 30 }) =>
    Effect.gen(function* () {
      const original = yield* childContext(threadId);
      const engine = yield* OrchestrationEngineService;
      const events = yield* engine.subscribeDomainEvents;
      const head = yield* engine.latestSequence;
      if (afterSequence > head) {
        return yield* new AgentToolError({
          message: "The sequence is ahead of this environment. Read the child state again.",
        });
      }
      const missed = yield* engine
        .readThreadEvents({
          threadId,
          fromSequenceExclusive: afterSequence,
          toSequenceInclusive: head,
          limit: 1,
        })
        .pipe(
          Stream.runHead,
          Effect.mapError(
            () => new AgentToolError({ message: "Could not replay child activity." }),
          ),
        );
      const next = Option.isSome(missed)
        ? missed
        : yield* events.pipe(
            Stream.filter(
              (event) =>
                event.aggregateKind === "thread" &&
                event.aggregateId === threadId &&
                event.sequence > afterSequence,
            ),
            Stream.runHead,
            Effect.timeoutOrElse({
              duration: `${timeoutSeconds} seconds`,
              orElse: () => Effect.succeed(Option.none()),
            }),
          );
      const current = yield* childContext(threadId);
      if (
        current.child.createdAt !== original.child.createdAt ||
        current.parent.createdAt !== original.parent.createdAt
      ) {
        return yield* new AgentToolError({
          message: "The child or parent chat was replaced while waiting.",
        });
      }
      return {
        threadId,
        sequence: Option.isSome(next) ? next.value.sequence : afterSequence,
        timedOut: Option.isNone(next),
      };
    }).pipe(Effect.scoped),
} satisfies Parameters<typeof AgentsToolkit.toLayer>[0];

export const AgentsToolkitHandlersLive = AgentsToolkit.toLayer(agentsToolkitHandlers);
