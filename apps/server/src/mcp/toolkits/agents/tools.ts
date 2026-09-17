import {
  ModelSelection,
  NonNegativeInt,
  ProviderInstanceId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../../../provider/Services/ProviderRegistry.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";

export class AgentToolError extends Schema.TaggedError<AgentToolError>()("AgentToolError", {
  message: Schema.String,
}) {}

// MCP advertises new calls, not legacy persisted selections with unknown input fields.
const AgentModelSelection = Schema.toType(ModelSelection);

export const AgentSummary = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String,
  modelSelection: AgentModelSelection,
  status: Schema.String,
});

const dependencies = [
  McpInvocationContext,
  ProjectionSnapshotQuery,
  OrchestrationEngineService,
  ProviderRegistry,
];
const noParameters = Schema.Record(Schema.String, Schema.Never);

const Models = Tool.make("t3_agent_models", {
  description:
    "List the live model catalog before choosing a T3-managed child agent. Optionally filter by provider instance; pass nextOffset as offset to read more, and null means the end. A child may use any configured provider or subscription independently of its parent, including OpenRouter models such as DeepSeek. Restart pagination if provider configuration changes.",
  parameters: Schema.Struct({
    instanceId: Schema.optional(ProviderInstanceId),
    offset: Schema.optional(NonNegativeInt),
  }),
  success: Schema.Struct({
    models: Schema.Array(
      Schema.Struct({
        modelSelection: AgentModelSelection,
        providerName: Schema.String,
        modelName: Schema.String,
      }),
    ),
    nextOffset: Schema.NullOr(NonNegativeInt),
  }),
  failure: AgentToolError,
  dependencies,
}).annotate(Tool.Readonly, true);

const Spawn = Tool.make("t3_agent_spawn", {
  description:
    "Create and start a durable T3 child chat. Always choose a live modelSelection returned by t3_agent_models; it may belong to a different provider or subscription than the parent. Use a unique requestId for each new task; reuse it only when retrying the same spawn. The child inherits the project, checkout and permission mode, but has its own provider session. Give it a finite, self-contained task and tell it to finish with its result: it must not wait for the parent or user unless genuinely blocked. Include all context it needs in prompt.",
  parameters: Schema.Struct({
    requestId: TrimmedNonEmptyString,
    title: TrimmedNonEmptyString,
    prompt: TrimmedNonEmptyString,
    modelSelection: AgentModelSelection,
  }),
  success: Schema.Struct({ threadId: ThreadId, message: Schema.String, sequence: NonNegativeInt }),
  failure: AgentToolError,
  dependencies,
});

const List = Tool.make("t3_agent_list", {
  description:
    "List this thread's T3-managed child chats and current runtime status. Native provider subagents are separate and are not controlled by these tools.",
  parameters: noParameters,
  success: Schema.Array(AgentSummary),
  failure: AgentToolError,
  dependencies,
}).annotate(Tool.Readonly, true);

const Get = Tool.make("t3_agent_get", {
  description:
    "Read a child agent's status, latest messages and recent activity. Returns a bounded excerpt of the latest turn, not the entire chat. Open the child chat for full history.",
  parameters: Schema.Struct({ threadId: ThreadId }),
  success: Schema.Struct({
    ...AgentSummary.fields,
    sequence: NonNegativeInt,
    truncated: Schema.Boolean,
    messages: Schema.Array(
      Schema.Struct({ role: Schema.String, text: Schema.String, truncated: Schema.Boolean }),
    ),
    activities: Schema.Array(Schema.Struct({ kind: Schema.String, summary: Schema.String })),
  }),
  failure: AgentToolError,
  dependencies,
}).annotate(Tool.Readonly, true);

const Stop = Tool.make("t3_agent_stop", {
  description:
    "Request interruption of one of this thread's T3-managed children. Does not delete its chat or history. Delivery is asynchronous; read status to confirm it has stopped.",
  parameters: Schema.Struct({ threadId: ThreadId, requestId: TrimmedNonEmptyString }),
  success: Schema.Struct({ threadId: ThreadId, message: Schema.String }),
  failure: AgentToolError,
  dependencies,
});

const Send = Tool.make("t3_agent_send", {
  description:
    "Send instructions to a T3-managed child. If working, the provider receives them as steering; if idle or stopped, this resumes work in the same child chat. Use a unique requestId per message and reuse it only for retries. Delivery is asynchronous.",
  parameters: Schema.Struct({
    threadId: ThreadId,
    requestId: TrimmedNonEmptyString,
    prompt: TrimmedNonEmptyString,
  }),
  success: Schema.Struct({ threadId: ThreadId, message: Schema.String }),
  failure: AgentToolError,
  dependencies,
});

const Wait = Tool.make("t3_agent_wait", {
  description:
    "Wait for a child after the sequence returned by spawn or get. By default it returns only when the child settles (ready, interrupted, stopped or error), which notifies and unblocks the parent. It replays missed events, so completion is not lost between calls or reconnects. Use untilSettled=false only when progress notifications are specifically needed. A timeout does not mean the agent stopped.",
  parameters: Schema.Struct({
    threadId: ThreadId,
    afterSequence: NonNegativeInt,
    timeoutSeconds: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60 })),
    ),
    untilSettled: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({
    threadId: ThreadId,
    sequence: NonNegativeInt,
    timedOut: Schema.Boolean,
    status: Schema.String,
    settled: Schema.Boolean,
  }),
  failure: AgentToolError,
  dependencies,
}).annotate(Tool.Readonly, true);

export const AgentsToolkit = Toolkit.make(Models, Spawn, List, Get, Stop, Send, Wait);
