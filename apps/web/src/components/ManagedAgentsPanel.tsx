import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight, Square } from "lucide-react";

import { useThread, useThreadShell, useThreadShells } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { newMessageId } from "~/lib/utils";
import { buildThreadRouteParams } from "~/threadRoutes";
import { Button } from "./ui/button";

function agentStatus(thread: EnvironmentThreadShell) {
  return thread.session?.status ?? (thread.latestUserMessageAt ? "pending" : "idle");
}

function textTail(text: string, limit: number) {
  let start = Math.max(0, text.length - limit);
  const first = text.charCodeAt(start);
  if (first >= 0xdc00 && first <= 0xdfff) start++;
  return text.slice(start);
}

export function managedMessageExcerpt(
  messages: ReadonlyArray<{ id: string; role: string; text: string }>,
) {
  let remaining = 20_000;
  const excerpt = [];
  for (
    let index = messages.length - 1;
    index >= 0 && excerpt.length < 50 && remaining > 0;
    index--
  ) {
    const message = messages[index];
    if (!message) continue;
    const text = textTail(message.text, Math.min(remaining, 6000));
    remaining -= text.length;
    excerpt.push({
      id: message.id,
      role: message.role,
      text,
      truncated: text.length < message.text.length,
    });
  }
  return excerpt.toReversed();
}

export function ManagedAgentChat({
  parent,
  child,
  onBack,
}: {
  parent: EnvironmentThreadShell;
  child: EnvironmentThreadShell;
  onBack: () => void;
}) {
  const detail = useThread({ environmentId: child.environmentId, threadId: child.id });
  const send = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const interrupt = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  useLayoutEffect(() => {
    if (!detail) return;
    const scroll = scrollRef.current;
    if (scroll && followLatest.current) scroll.scrollTop = scroll.scrollHeight;
  }, [detail]);
  const managedChild = {
    parentThreadId: parent.id,
    parentCreatedAt: parent.createdAt,
    childCreatedAt: child.createdAt,
  };
  const sendInstructions = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    const result = await send({
      environmentId: child.environmentId,
      input: {
        threadId: child.id,
        managedChild,
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
      setFeedback(
        "Instructions sent. A working agent receives them as steering; an idle agent resumes.",
      );
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
    <section className="flex h-full min-h-0 flex-col" aria-label="Subagent side chat">
      <header className="flex items-center gap-2 border-b p-2">
        <Button variant="ghost" size="icon" aria-label="Back to agents" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium">{child.title}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {child.modelSelection.instanceId} · {child.modelSelection.model}
          </p>
          <p className="text-xs" role="status">
            {agentStatus(child)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open full agent chat"
          onClick={() =>
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams({
                environmentId: child.environmentId,
                threadId: child.id,
              }),
            })
          }
        >
          <ArrowUpRight className="size-4" />
        </Button>
        <Button variant="outline" size="sm" disabled={stopping} onClick={() => void stop()}>
          <Square className="size-3" />
          {stopping ? "Stopping…" : "Stop agent"}
        </Button>
      </header>
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const scroll = event.currentTarget;
          followLatest.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 48;
        }}
        className="min-h-0 flex-1 overflow-y-auto p-3"
        aria-label="Agent messages and activity"
      >
        {!detail ? (
          <p className="text-sm text-muted-foreground">Loading agent chat…</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              Recent messages. Open the full chat for earlier history, approvals, questions and file
              changes.
            </p>
            {managedMessageExcerpt(detail.messages).map((message) => (
              <article key={message.id} className="mb-4">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {message.role === "user" ? "Instructions" : "Agent"}
                </p>
                {message.truncated && (
                  <p className="text-xs text-muted-foreground">
                    Earlier text omitted. Open full chat to read it.
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
              </article>
            ))}
            {detail.activities.length > 0 && (
              <details open>
                <summary className="mb-2 text-xs font-medium">Recent activity</summary>
                <ul className="space-y-1">
                  {detail.activities.slice(-10).map((activity) => (
                    <li key={activity.id} className="break-words text-xs text-muted-foreground">
                      {activity.summary.length > 500
                        ? `…${textTail(activity.summary, 500)}`
                        : activity.summary}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
      <form
        className="space-y-2 border-t p-3"
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
          <p role="status" className="text-xs text-muted-foreground">
            {feedback}
          </p>
        )}
        <textarea
          aria-label="Instructions for subagent"
          className="min-h-20 w-full resize-y rounded-md border bg-background p-2 text-sm"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Change direction, add context, or resume work…"
        />
        <Button type="submit" size="sm" disabled={sending || !draft.trim()}>
          {sending ? "Sending…" : "Send instructions"}
        </Button>
      </form>
    </section>
  );
}

export function ManagedAgentsPanel({
  environmentId,
  threadId,
  children,
  hasNativeAgents,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  children: ReactNode;
  hasNativeAgents: boolean;
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
    <div className="flex h-full min-h-0 flex-col">
      {agents.length > 0 && (
        <section
          className="max-h-[50%] shrink-0 overflow-y-auto border-b p-2"
          aria-label="T3-managed agents"
        >
          <h3 className="mb-2 px-1 text-xs font-medium text-muted-foreground">
            T3 agents · open to steer or stop
          </h3>
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => setSelectedId(agent.id)}
              className="mb-1 flex w-full items-center justify-between gap-2 rounded-md p-2 text-left hover:bg-accent"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm">{agent.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {agent.modelSelection.instanceId} · {agent.modelSelection.model}
                </span>
              </span>
              <span className="text-xs">{agentStatus(agent)}</span>
            </button>
          ))}
        </section>
      )}
      {hasNativeAgents || agents.length === 0 ? (
        <div className="min-h-0 flex-1">{children}</div>
      ) : null}
    </div>
  );
}
