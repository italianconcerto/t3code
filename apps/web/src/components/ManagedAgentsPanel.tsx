import type { EnvironmentId, ThreadId, ModelSelection } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowUp, ArrowUpRight, Square } from "lucide-react";

import { useThread, useThreadShell, useThreadShells } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { newMessageId } from "~/lib/utils";
import { buildThreadRouteParams } from "~/threadRoutes";
import { Button } from "./ui/button";
import { ManagedAgentModelPicker } from "./ManagedAgentModelPicker";
import { ManagedAgentTimeline } from "./ManagedAgentTimeline";
import { AgentConversationRow, agentStatusLabel } from "./AgentConversationRow";

function agentStatus(thread: EnvironmentThreadShell) {
  return thread.session?.status ?? (thread.latestUserMessageAt ? "pending" : "idle");
}

export function ManagedAgentChat({
  parent,
  child,
  onBack,
  sideDiscussion = false,
}: {
  parent: EnvironmentThreadShell;
  child: EnvironmentThreadShell;
  onBack: () => void;
  sideDiscussion?: boolean;
}) {
  const detail = useThread({ environmentId: child.environmentId, threadId: child.id });
  const send = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const interrupt = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const updateModel = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [changingModel, setChangingModel] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const persistedModelKey = JSON.stringify(child.modelSelection);
  const [pendingModel, setPendingModel] = useState<{
    baseKey: string;
    selection: ModelSelection;
  } | null>(null);
  const modelSelection =
    pendingModel?.baseKey === persistedModelKey ? pendingModel.selection : child.modelSelection;
  if (pendingModel !== null && pendingModel.baseKey !== persistedModelKey) {
    setPendingModel(null);
  }
  const working = child.session?.status === "running" || child.session?.status === "starting";
  const openFullChat = () =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams({ environmentId: child.environmentId, threadId: child.id }),
    });
  const managedChild = {
    parentThreadId: parent.id,
    parentCreatedAt: parent.createdAt,
    childCreatedAt: child.createdAt,
  };
  const changeModel = async (selection: ModelSelection) => {
    if (
      working ||
      sending ||
      changingModel ||
      pendingModel !== null ||
      JSON.stringify(selection) === persistedModelKey
    )
      return;
    setChangingModel(true);
    setPendingModel({ baseKey: persistedModelKey, selection });
    setError(null);
    const result = await updateModel({
      environmentId: child.environmentId,
      input: { threadId: child.id, modelSelection: selection },
    });
    setChangingModel(false);
    if (result._tag === "Failure") {
      setPendingModel(null);
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not change the model.");
    }
  };
  const sendInstructions = async () => {
    const text = draft.trim();
    if (!text || sending || changingModel) return;
    setSending(true);
    setError(null);
    const result = await send({
      environmentId: child.environmentId,
      input: {
        threadId: child.id,
        managedChild,
        modelSelection,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        runtimeMode: child.runtimeMode,
        interactionMode: child.interactionMode,
      },
    });
    setSending(false);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not send instructions.");
    } else {
      setDraft((current) => (current === draft ? "" : current));
      setFeedback(working ? "Message sent to the working agent." : "Message sent.");
    }
  };
  const stop = async () => {
    if (stopping) return;
    setStopping(true);
    setError(null);
    const result = await interrupt({
      environmentId: child.environmentId,
      input: { threadId: child.id, managedChild },
    });
    setStopping(false);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not stop the agent.");
    } else setFeedback("Stop requested. Watch the agent status for confirmation.");
  };
  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={sideDiscussion ? "BTW side chat" : "Subagent side chat"}
    >
      <header className="flex shrink-0 items-center gap-2 border-b p-2 pr-20">
        <Button
          variant="ghost"
          size="icon"
          aria-label={sideDiscussion ? "Close and discard BTW" : "Back to agents"}
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium">{child.title}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {modelSelection.instanceId} · {modelSelection.model}
          </p>
          <p className="text-xs" role="status">
            {agentStatusLabel(agentStatus(child))}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open full agent chat"
          onClick={openFullChat}
        >
          <ArrowUpRight className="size-4" />
        </Button>
      </header>
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        aria-label="Agent messages and activity"
      >
        {!detail ? (
          <p className="text-sm text-muted-foreground">Loading agent chat…</p>
        ) : (
          <ManagedAgentTimeline
            detail={detail}
            sideDiscussion={sideDiscussion}
            openFullChat={openFullChat}
          />
        )}
      </div>
      <form
        className="shrink-0 space-y-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void sendInstructions();
        }}
      >
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {feedback && !error && (
          <p role="status" className="sr-only">
            {feedback}
          </p>
        )}
        {sideDiscussion && (
          <p className="text-xs text-muted-foreground">
            Independent side chat · not sent to the main agent.
          </p>
        )}
        {(child.hasPendingApprovals || child.hasPendingUserInput) && (
          <Button type="button" variant="outline" size="sm" onClick={openFullChat}>
            Respond in full chat
          </Button>
        )}
        <div className="rounded-2xl border bg-background p-2">
          <textarea
            aria-label={sideDiscussion ? "BTW follow-up" : "Instructions for subagent"}
            className="min-h-20 max-h-60 w-full resize-y bg-transparent p-2 text-sm outline-none"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void sendInstructions();
              }
            }}
            placeholder={
              sideDiscussion ? "Ask a follow-up…" : "Change direction, add context, or resume work…"
            }
          />
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0">
              <ManagedAgentModelPicker
                environmentId={child.environmentId}
                selection={modelSelection}
                disabled={sending || working || changingModel || pendingModel !== null}
                onChange={(selection) => void changeModel(selection)}
              />
            </div>
            <div className="flex shrink-0 gap-2">
              {working && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={sideDiscussion ? "Stop BTW" : "Stop agent"}
                  title="Stop generation"
                  disabled={stopping}
                  onClick={() => void stop()}
                >
                  <Square className="size-4" />
                </Button>
              )}
              <Button
                type="submit"
                size="icon"
                className="rounded-full"
                aria-label="Send message"
                title="Send message"
                disabled={sending || changingModel || !draft.trim()}
              >
                <ArrowUp className="size-4" />
              </Button>
            </div>
          </div>
          {working && (
            <p className="mt-1 text-xs text-muted-foreground">Stop generation to change model.</p>
          )}
        </div>
      </form>
    </section>
  );
}

export function ManagedAgentsPanel({
  environmentId,
  threadId,
  children,
  hasNativeAgents = false,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  children?: ReactNode;
  hasNativeAgents?: boolean;
}) {
  const shells = useThreadShells();
  const parent = useThreadShell({ environmentId, threadId });
  const [selectedId, setSelectedId] = useState<ThreadId | null>(null);
  const agents = shells.filter(
    (thread) =>
      thread.environmentId === environmentId &&
      thread.parentThreadId === threadId &&
      thread.archivedAt === null,
  );
  const selected = agents.find((thread) => thread.id === selectedId);
  if (selected && parent)
    return (
      <ManagedAgentChat
        key={selected.id}
        parent={parent}
        child={selected}
        onBack={() => setSelectedId(null)}
      />
    );
  return (
    <div className="h-full min-h-0 overflow-y-auto py-3" aria-label="Agents">
      {agents.length === 0 && !hasNativeAgents ? (
        <p className="px-6 py-4 text-sm text-muted-foreground">No agents yet.</p>
      ) : (
        <div className="flex min-h-0 flex-col gap-1">
          {agents.map((agent) => (
            <div key={agent.id} className="px-3">
              <AgentConversationRow
                title={agent.title}
                subtitle={agent.title.startsWith("BTW") ? "Side chat" : agent.modelSelection.model}
                status={agentStatus(agent)}
                onOpen={() => setSelectedId(agent.id)}
              />
            </div>
          ))}
          {hasNativeAgents ? <div>{children}</div> : null}
        </div>
      )}
    </div>
  );
}
