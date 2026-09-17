import type { EnvironmentId, ThreadId, ProviderSubagentResult } from "@t3tools/contracts";
import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { isActiveSubagentStatus } from "@t3tools/client-runtime/state/subagentRuntime";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "./ui/button";
import ChatMarkdown from "./ChatMarkdown";
import { NativeAgentConversation } from "./NativeAgentConversation";
import { ArrowLeft, ArrowUp } from "lucide-react";
import { agentStatusLabel } from "./AgentConversationRow";

export function NativeAgentDetail({
  agent,
  environmentId,
  threadId,
  onBack,
}: {
  agent: RuntimeSubagent;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  onBack: () => void;
}) {
  const command = useAtomCommand(orchestrationEnvironment.subagent, { reportFailure: false });
  const [detail, setDetail] = useState<ProviderSubagentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const pageOffset = useRef<number | undefined>(undefined);
  const [olderOffset, setOlderOffset] = useState<number | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const following = useRef(true);
  const refreshPending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (action: "read" | "steer", offset = pageOffset.current, older = false) => {
    if (!environmentId || !threadId || pending.current) return;
    if (
      action === "steer" &&
      (!draft.trim() || !detail?.canSteer || !isActiveSubagentStatus(agent.status))
    )
      return;
    pending.current = true;
    setBusy(true);
    setError(null);
    const sent = draft.trim();
    try {
      const result = await command({
        environmentId,
        input:
          action === "read"
            ? {
                threadId,
                agentId: agent.id,
                action,
                ...(offset === undefined ? { tail: true } : { offset }),
              }
            : { threadId, agentId: agent.id, action, message: sent },
      });
      if (!mounted.current) return;
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : "Could not contact the subagent.");
      } else if (action === "read") {
        if (older || pageOffset.current === undefined) setOlderOffset(result.value.previousOffset);
        if (!older) pageOffset.current = result.value.offset ?? offset ?? 0;
        setDetail((previous) => {
          const first = older ? result.value.steps : (previous?.steps ?? []);
          const last = older ? (previous?.steps ?? []) : result.value.steps;
          const steps = new Map(first.map((step) => [step.id, step]));
          for (const step of last) steps.set(step.id, step);
          return { ...(older && previous ? previous : result.value), steps: [...steps.values()] };
        });
      } else {
        setDraft((current) => (current.trim() === sent ? "" : current));
        setFeedback(
          result.value.steeringDelivery === "parent-relay"
            ? "Steering requested through the parent agent. Delivery to the child is not yet confirmed."
            : "Steering delivered to the selected subagent.",
        );
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
      if (mounted.current && refreshPending.current) {
        refreshPending.current = false;
        void run("read");
      }
    }
  };
  const loadOnOpen = useEffectEvent(() => {
    void run("read");
  });
  useEffect(() => {
    loadOnOpen();
  }, [agent.id, environmentId, threadId]);
  const loadNext = useEffectEvent((offset: number) => void run("read", offset));
  useEffect(() => {
    const next = detail?.nextOffset;
    if (!busy && !error && next !== undefined && next > (pageOffset.current ?? -1)) loadNext(next);
  }, [busy, error, detail?.nextOffset]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, [detail?.steps]);
  const refreshLivePage = useEffectEvent(() => {
    if (detail?.nextOffset === undefined) void run("read");
  });
  const previousStatus = useRef(agent.status);
  const refreshFinalPage = useEffectEvent(() => {
    if (pending.current) refreshPending.current = true;
    else void run("read");
  });
  useEffect(() => {
    if (isActiveSubagentStatus(previousStatus.current) && !isActiveSubagentStatus(agent.status))
      refreshFinalPage();
    previousStatus.current = agent.status;
  }, [agent.status]);
  useEffect(() => {
    if (!isActiveSubagentStatus(agent.status)) return;
    const timer = window.setInterval(() => refreshLivePage(), 3000);
    return () => window.clearInterval(timer);
  }, [agent.status]);
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Native subagent detail">
      <header className="flex shrink-0 items-center gap-2 border-b p-2 pr-20">
        <Button variant="ghost" size="icon" aria-label="Back to agents" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium">{agent.title}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {agent.model ? `${agent.model} · ` : ""}
            {agentStatusLabel(agent.status)}
          </p>
        </div>
      </header>
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
        }}
        className="min-h-0 flex-1 overflow-y-auto space-y-5 px-5 py-6"
        aria-busy={busy}
      >
        {olderOffset !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              following.current = false;
              void run("read", olderOffset, true);
            }}
          >
            Load earlier messages
          </Button>
        )}
        {!detail?.steps.length &&
          agent.recentActivity.map((step, index) => (
            <details key={`${step.at}:${index}`}>
              <summary className="cursor-pointer text-xs">{step.summary.slice(0, 120)}</summary>
              <pre className="whitespace-pre-wrap break-words text-xs">{step.summary}</pre>
            </details>
          ))}
        {!detail?.steps.length && agent.result && (
          <ChatMarkdown
            text={agent.result}
            cwd={undefined}
            environmentId={environmentId ?? undefined}
          />
        )}
        {detail && <NativeAgentConversation steps={detail.steps} environmentId={environmentId} />}
        {detail?.steps.length === 0 && (
          <p className="text-xs text-muted-foreground">No conversation history available.</p>
        )}
        {detail?.notice && <p className="text-xs text-muted-foreground">{detail.notice}</p>}
        {detail?.nextOffset !== undefined && !error && (
          <p role="status" className="sr-only">
            Loading conversation…
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="border-t p-3 text-xs text-destructive">
          {error}
        </p>
      )}
      {detail?.canSteer && isActiveSubagentStatus(agent.status) && (
        <form
          className="shrink-0 space-y-2 border-t p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run("steer");
          }}
        >
          {feedback && !error && (
            <p role="status" className="text-xs text-muted-foreground">
              {feedback}
            </p>
          )}
          <div className="rounded-2xl border bg-background p-2">
            <textarea
              aria-label="Steering for subagent"
              className="min-h-20 max-h-60 w-full resize-y bg-transparent p-2 text-sm outline-none"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void run("steer");
                }
              }}
              maxLength={20_000}
              placeholder="Change direction, add context, or resume work…"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-muted-foreground">
                {agent.model ?? "Agent"}
              </span>
              <Button
                type="submit"
                size="icon"
                className="shrink-0 rounded-full"
                aria-label="Send message to subagent"
                disabled={
                  busy ||
                  !draft.trim() ||
                  !detail?.canSteer ||
                  !isActiveSubagentStatus(agent.status)
                }
              >
                <ArrowUp className="size-4" />
              </Button>
            </div>
          </div>
        </form>
      )}
      {detail && !(detail.canSteer && isActiveSubagentStatus(agent.status)) && (
        <p className="shrink-0 border-t px-5 py-4 text-xs text-muted-foreground">
          {isActiveSubagentStatus(agent.status)
            ? "Messaging currently unavailable."
            : "No active turn. Conversation is read-only."}
        </p>
      )}
    </section>
  );
}
