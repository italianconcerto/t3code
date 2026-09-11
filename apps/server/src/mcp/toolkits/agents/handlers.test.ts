import {
  CommandId,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { stableStringify } from "@t3tools/shared/relaySigning";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { McpSchema, McpServer } from "effect/unstable/ai";

import { ServerConfig } from "../../../config.ts";
import { OrchestrationEngineLive } from "../../../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../../../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../../../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../../../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../../../orchestration/ThreadPlanProgress.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../../project/RepositoryIdentityResolver.ts";
import { ProviderRegistry } from "../../../provider/Services/ProviderRegistry.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";
import { AgentsToolkitRegistrationLive } from "../../McpHttpServer.ts";
import { agentsToolkitHandlers } from "./handlers.ts";

const parentId = ThreadId.make("agents-parent");
const projectId = ProjectId.make("agents-project");
const createdAt = "2026-09-10T00:00:00.000Z";
const instanceId = ProviderInstanceId.make("claude-subscription-two");
const providers: ReadonlyArray<ServerProvider> = [
  {
    instanceId,
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: "Second subscription",
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: createdAt,
    models: [{ slug: "child-model", name: "Child Model", isCustom: false, capabilities: null }],
    slashCommands: [],
    skills: [],
  },
];
const registry = ProviderRegistry.of({
  getProviders: Effect.succeed(providers),
  refresh: () => Effect.succeed(providers),
  refreshInstance: () => Effect.succeed(providers),
  refreshWorkspaceSnapshot: () => Effect.succeed(providers),
  getProviderMaintenanceCapabilitiesForInstance: () => Effect.die("Not used by agent tools"),
  setProviderMaintenanceActionState: () => Effect.die("Not used by agent tools"),
  streamChanges: Stream.empty,
});
const invocation = McpInvocationContext.of({
  environmentId: EnvironmentId.make("agents-environment"),
  threadId: parentId,
  providerSessionId: "parent-session",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["agents"]),
  issuedAt: 1000,
});
const layer = OrchestrationEngineLive.pipe(
  Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provideMerge(OrchestrationProjectionPipelineLive),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-managed-agents-" })),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(Layer.succeed(ProviderRegistry, registry)),
  Layer.provideMerge(Layer.succeed(McpInvocationContext, invocation)),
);

const registeredLayer = AgentsToolkitRegistrationLive.pipe(
  Layer.provideMerge(layer),
  Layer.provideMerge(McpServer.McpServer.layer),
);

it.layer(registeredLayer)("managed agent tools with real orchestration persistence", (it) => {
  it.effect(
    "spawns cross-provider exactly once, preserves permissions, isolates ownership and records stop",
    () =>
      Effect.gen(function* () {
        const engine = yield* OrchestrationEngineService;
        const query = yield* ProjectionSnapshotQuery;
        yield* engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("agents-project"),
          projectId,
          title: "Agents",
          workspaceRoot: "/tmp/managed-agents",
          defaultModelSelection: null,
          createdAt,
        });
        const createParent = (id: ThreadId) =>
          engine.dispatch({
            type: "thread.create",
            commandId: CommandId.make(`create-${id}`),
            threadId: id,
            projectId,
            title: "Parent",
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "parent-model" },
            runtimeMode: "approval-required",
            interactionMode: "default",
            branch: "task-branch",
            worktreePath: "/tmp/agent-checkout",
            createdAt,
          });
        yield* createParent(parentId);
        const siblingParent = ThreadId.make("other-parent");
        yield* createParent(siblingParent);
        const mcpServer = yield* McpServer.McpServer;
        const mcpClient = McpSchema.McpServerClient.of({
          clientId: 1,
          clientCapabilities: {},
          clientInfo: { name: "agent-tools-test", version: "1" },
          protocolVersion: "2025-06-18",
          initializePayload: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "agent-tools-test", version: "1" },
          },
          getClient: Effect.die("unused"),
        });
        const wireModels = yield* mcpServer
          .callTool({ name: "t3_agent_models", arguments: {} })
          .pipe(Effect.provideService(McpSchema.McpServerClient, mcpClient));
        assert.notEqual(wireModels.isError, true);
        assert.equal(
          wireModels.content.some(
            (item) => item.type === "text" && item.text.includes("Second subscription"),
          ),
          true,
        );
        const models = yield* agentsToolkitHandlers.t3_agent_models();
        assert.deepEqual(models, {
          models: [
            {
              modelSelection: { instanceId, model: "child-model" },
              providerName: "Second subscription",
              modelName: "Child Model",
            },
          ],
          nextOffset: null,
        });
        const manyModels = Array.from({ length: 125 }, (_, index) => ({
          slug: `model-${String(index).padStart(3, "0")}`,
          name: "漢🧪".repeat(100),
          isCustom: false,
          capabilities: null,
        }));
        const largeRegistry = {
          ...registry,
          getProviders: Effect.succeed(
            providers.map((provider) => ({ ...provider, models: manyModels })),
          ),
        };
        const seen: string[] = [];
        let offset: number | null = 0;
        do {
          const page: Effect.Success<ReturnType<typeof agentsToolkitHandlers.t3_agent_models>> =
            yield* agentsToolkitHandlers
              .t3_agent_models({ instanceId, offset })
              .pipe(Effect.provideService(ProviderRegistry, largeRegistry));
          assert.isAtMost(Buffer.byteLength(stableStringify(page), "utf8"), 24_100);
          assert.isAbove(page.models.length, 0);
          seen.push(...page.models.map((model) => model.modelSelection.model));
          if (page.nextOffset !== null) assert.isAbove(page.nextOffset, offset);
          offset = page.nextOffset;
        } while (offset !== null);
        assert.deepEqual(
          seen,
          manyModels.map((model) => model.slug),
        );
        assert.deepEqual(
          yield* agentsToolkitHandlers.t3_agent_models({
            instanceId: ProviderInstanceId.make("missing-provider"),
          }),
          { models: [], nextOffset: null },
        );
        const input = {
          requestId: "review-1",
          title: "Review",
          prompt: "Review the patch without editing files.",
          modelSelection: { instanceId, model: "child-model" },
        };
        const { first, second } = yield* Effect.all(
          {
            first: agentsToolkitHandlers.t3_agent_spawn(input),
            second: agentsToolkitHandlers.t3_agent_spawn(input),
          },
          { concurrency: 2 },
        );
        assert.equal(first.threadId, second.threadId);
        yield* Effect.gen(function* () {
          const subscribed = yield* Deferred.make<void>();
          const waitEngine = {
            ...engine,
            subscribeDomainEvents: engine.subscribeDomainEvents.pipe(
              Effect.tap(() => Deferred.succeed(subscribed, undefined)),
            ),
          };
          const waiting = yield* agentsToolkitHandlers
            .t3_agent_wait({
              threadId: first.threadId,
              afterSequence: first.sequence,
              timeoutSeconds: 5,
            })
            .pipe(Effect.provideService(OrchestrationEngineService, waitEngine), Effect.forkScoped);
          yield* Deferred.await(subscribed);
          yield* engine.dispatch({
            type: "thread.meta.update",
            commandId: CommandId.make("unrelated-wait-event"),
            threadId: siblingParent,
            title: "Unrelated event",
          });
          const changed = yield* engine.dispatch({
            type: "thread.meta.update",
            commandId: CommandId.make("child-wait-event"),
            threadId: first.threadId,
            title: "Review progress",
          });
          assert.deepEqual(yield* Fiber.join(waiting), {
            threadId: first.threadId,
            sequence: changed.sequence,
            timedOut: false,
          });
          // The same durable cursor works after the notification was consumed.
          assert.deepEqual(
            yield* agentsToolkitHandlers.t3_agent_wait({
              threadId: first.threadId,
              afterSequence: first.sequence,
            }),
            { threadId: first.threadId, sequence: changed.sequence, timedOut: false },
          );
          const timeoutSubscribed = yield* Deferred.make<void>();
          const timeoutEngine = {
            ...engine,
            subscribeDomainEvents: engine.subscribeDomainEvents.pipe(
              Effect.tap(() => Deferred.succeed(timeoutSubscribed, undefined)),
            ),
          };
          const timed = yield* agentsToolkitHandlers
            .t3_agent_wait({
              threadId: first.threadId,
              afterSequence: changed.sequence,
              timeoutSeconds: 1,
            })
            .pipe(
              Effect.provideService(OrchestrationEngineService, timeoutEngine),
              Effect.forkScoped,
            );
          yield* Deferred.await(timeoutSubscribed);
          yield* TestClock.adjust(1000);
          assert.deepEqual(yield* Fiber.join(timed), {
            threadId: first.threadId,
            sequence: changed.sequence,
            timedOut: true,
          });
          assert.equal(
            (yield* agentsToolkitHandlers
              .t3_agent_wait({ threadId: first.threadId, afterSequence: changed.sequence + 1000 })
              .pipe(Effect.exit))._tag,
            "Failure",
          );
        }).pipe(Effect.scoped);
        assert.equal(
          (yield* agentsToolkitHandlers
            .t3_agent_spawn({ ...input, prompt: "A different task" })
            .pipe(Effect.exit))._tag,
          "Failure",
        );
        assert.equal(
          (yield* agentsToolkitHandlers
            .t3_agent_spawn({
              ...input,
              modelSelection: { ...input.modelSelection, options: [{ id: "test", value: true }] },
            })
            .pipe(Effect.exit))._tag,
          "Failure",
        );
        const child = Option.getOrThrow(yield* query.getThreadDetailById(first.threadId));
        assert.equal(child.parentThreadId, parentId);
        assert.equal(child.runtimeMode, "approval-required");
        assert.equal(child.branch, "task-branch");
        assert.equal(child.worktreePath, "/tmp/agent-checkout");
        assert.deepEqual(child.modelSelection, input.modelSelection);
        assert.equal(child.session, null);
        assert.deepEqual(
          child.messages.map((message) => message.text),
          [input.prompt],
        );
        assert.equal((yield* agentsToolkitHandlers.t3_agent_list()).length, 1);
        const observed = yield* agentsToolkitHandlers.t3_agent_get({ threadId: first.threadId });
        assert.equal(observed.threadId, first.threadId);
        assert.equal(observed.status, "pending");
        assert.deepEqual(observed.messages, [
          { role: "user", text: input.prompt, truncated: false },
        ]);
        const foreignScope = { ...invocation, threadId: siblingParent };
        assert.equal(
          (yield* agentsToolkitHandlers
            .t3_agent_get({ threadId: first.threadId })
            .pipe(Effect.provideService(McpInvocationContext, foreignScope), Effect.exit))._tag,
          "Failure",
        );
        assert.equal(
          (yield* agentsToolkitHandlers
            .t3_agent_stop({ threadId: first.threadId, requestId: "foreign-stop" })
            .pipe(Effect.provideService(McpInvocationContext, foreignScope), Effect.exit))._tag,
          "Failure",
        );
        const beforeStop = yield* engine.latestSequence;
        yield* agentsToolkitHandlers.t3_agent_stop({
          threadId: first.threadId,
          requestId: "stop-1",
        });
        const events = yield* engine.readEvents(beforeStop).pipe(Stream.runCollect);
        assert.equal(
          events.some(
            (event) =>
              event.type === "thread.turn-interrupt-requested" &&
              event.aggregateId === first.threadId,
          ),
          true,
        );
        assert.equal(Option.isSome(yield* query.getThreadDetailById(first.threadId)), true);
        const steering = {
          threadId: first.threadId,
          requestId: "steer-1",
          prompt: "Focus on lifecycle bugs.",
        };
        yield* TestClock.adjust(1);
        yield* agentsToolkitHandlers.t3_agent_send(steering);
        yield* agentsToolkitHandlers.t3_agent_send(steering);
        assert.equal(
          (yield* agentsToolkitHandlers
            .t3_agent_send({ ...steering, prompt: "Different steering" })
            .pipe(Effect.exit))._tag,
          "Failure",
        );
        assert.deepEqual(
          Option.getOrThrow(yield* query.getThreadDetailById(first.threadId)).messages.map(
            (message) => message.text,
          ),
          [input.prompt, steering.prompt],
        );
        assert.equal(
          (yield* agentsToolkitHandlers
            .t3_agent_send({ ...steering, requestId: "foreign-send" })
            .pipe(Effect.provideService(McpInvocationContext, foreignScope), Effect.exit))._tag,
          "Failure",
        );
        assert.equal(
          (yield* agentsToolkitHandlers
            .t3_agent_spawn({
              ...input,
              requestId: "invalid-provider",
              modelSelection: {
                instanceId: ProviderInstanceId.make("missing"),
                model: "child-model",
              },
            })
            .pipe(Effect.exit))._tag,
          "Failure",
        );
        yield* TestClock.adjust(1);
        yield* agentsToolkitHandlers.t3_agent_send({
          threadId: first.threadId,
          requestId: "large-output",
          prompt: "漢🧪".repeat(20000) + "LATEST_MARKER",
        });
        const excerpt = yield* agentsToolkitHandlers.t3_agent_get({ threadId: first.threadId });
        assert.equal(excerpt.truncated, true);
        assert.equal(excerpt.messages.at(-1)?.text.endsWith("LATEST_MARKER"), true);
        const wireExcerpt = yield* mcpServer
          .callTool({ name: "t3_agent_get", arguments: { threadId: first.threadId } })
          .pipe(Effect.provideService(McpSchema.McpServerClient, mcpClient));
        assert.notEqual(wireExcerpt.isError, true);
        assert.isBelow(Buffer.byteLength(stableStringify(wireExcerpt), "utf8"), 60_000);
        const unauthenticated = {
          ...registry,
          getProviders: Effect.succeed(
            providers.map((provider) => ({
              ...provider,
              auth: { status: "unauthenticated" as const },
            })),
          ),
        };
        assert.deepEqual(
          yield* agentsToolkitHandlers
            .t3_agent_models()
            .pipe(Effect.provideService(ProviderRegistry, unauthenticated)),
          { models: [], nextOffset: null },
        );
        assert.equal(
          (yield* agentsToolkitHandlers
            .t3_agent_spawn({ ...input, requestId: "unauthenticated" })
            .pipe(Effect.provideService(ProviderRegistry, unauthenticated), Effect.exit))._tag,
          "Failure",
        );
        yield* engine.dispatch({
          type: "thread.archive",
          commandId: CommandId.make("archive-agent"),
          threadId: first.threadId,
        });
        assert.equal(
          (yield* agentsToolkitHandlers.t3_agent_spawn(input).pipe(Effect.exit))._tag,
          "Failure",
        );
        const raceChild = yield* agentsToolkitHandlers.t3_agent_spawn({
          ...input,
          requestId: "archive-race",
        });
        const archiveBeforeSend = {
          ...engine,
          dispatch: (command: Parameters<typeof engine.dispatch>[0]) =>
            Effect.gen(function* () {
              if (command.type === "thread.turn.start") {
                yield* engine.dispatch({
                  type: "thread.archive",
                  commandId: CommandId.make("archive-before-send"),
                  threadId: raceChild.threadId,
                });
              }
              return yield* engine.dispatch(command);
            }),
        };
        assert.equal(
          (yield* agentsToolkitHandlers
            .t3_agent_send({
              threadId: raceChild.threadId,
              requestId: "race-send",
              prompt: "Must not reach archived child",
            })
            .pipe(
              Effect.provideService(OrchestrationEngineService, archiveBeforeSend),
              Effect.exit,
            ))._tag,
          "Failure",
        );
        yield* engine.dispatch({
          type: "thread.unarchive",
          commandId: CommandId.make("restore-after-send-race"),
          threadId: raceChild.threadId,
        });
        assert.equal(
          Option.getOrThrow(yield* query.getThreadDetailById(raceChild.threadId)).messages.length,
          1,
        );
        const replacementChild = yield* agentsToolkitHandlers.t3_agent_spawn({
          ...input,
          requestId: "replace-race",
        });
        const replaceBeforeStop = {
          ...engine,
          dispatch: (command: Parameters<typeof engine.dispatch>[0]) =>
            Effect.gen(function* () {
              if (command.type === "thread.turn.interrupt") {
                yield* engine.dispatch({
                  type: "thread.delete",
                  commandId: CommandId.make("delete-before-stop"),
                  threadId: replacementChild.threadId,
                });
                yield* engine.dispatch({
                  type: "thread.create",
                  commandId: CommandId.make("replace-before-stop"),
                  threadId: replacementChild.threadId,
                  parentThreadId: siblingParent,
                  projectId,
                  title: "Foreign replacement",
                  modelSelection: input.modelSelection,
                  runtimeMode: "approval-required",
                  interactionMode: "default",
                  branch: null,
                  worktreePath: null,
                  createdAt,
                });
              }
              return yield* engine.dispatch(command);
            }),
        };
        assert.equal(
          (yield* agentsToolkitHandlers
            .t3_agent_stop({ threadId: replacementChild.threadId, requestId: "race-stop" })
            .pipe(
              Effect.provideService(OrchestrationEngineService, replaceBeforeStop),
              Effect.exit,
            ))._tag,
          "Failure",
        );
        assert.equal(
          Option.getOrThrow(yield* query.getThreadDetailById(replacementChild.threadId))
            .parentThreadId,
          siblingParent,
        );
        yield* engine.dispatch({
          type: "thread.delete",
          commandId: CommandId.make("delete-agent"),
          threadId: first.threadId,
        });
        assert.equal(
          (yield* agentsToolkitHandlers.t3_agent_spawn(input).pipe(Effect.exit))._tag,
          "Failure",
        );
        assert.equal(
          (yield* agentsToolkitHandlers.t3_agent_models().pipe(
            Effect.provideService(McpInvocationContext, {
              ...invocation,
              capabilities: new Set<"agents">(),
            }),
            Effect.exit,
          ))._tag,
          "Failure",
        );
      }),
  );
});
