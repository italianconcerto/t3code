import type { EnvironmentId, ThreadId, ProviderSubagentResult } from "@t3tools/contracts";
import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { isActiveSubagentStatus } from "@t3tools/client-runtime/state/subagentRuntime";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "./ui/button";
import ChatMarkdown from "./ChatMarkdown";
import { NativeAgentConversation } from "./NativeAgentConversation";

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
  const pageOffset = useRef(0);
  const refreshPending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (action: "read" | "steer", offset = pageOffset.current) => {
    if (!environmentId || !threadId || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    const sent = draft.trim();
    try {
      const result = await command({
        environmentId,
        input:
          action === "read"
            ? { threadId, agentId: agent.id, action, offset }
            : { threadId, agentId: agent.id, action, message: sent },
      });
      if (!mounted.current) return;
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : "Could not contact the subagent.");
      } else if (action === "read") {
        pageOffset.current = offset;
        setDetail((previous) => {
          const steps = new Map(previous?.steps.map((step) => [step.id, step]));
          for (const step of result.value.steps) steps.set(step.id, step);
          return { ...result.value, steps: [...steps.values()] };
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
      <header className="flex items-center gap-2 border-b p-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back to agents
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium">{agent.title}</h3>
          <p className="text-xs text-muted-foreground">{agent.status}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !environmentId || !threadId}
          onClick={() => void run("read")}
        >
          {busy ? "Loading…" : "Refresh"}
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto space-y-3 p-3">
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
        {detail?.nextOffset !== undefined && (
          <Button disabled={busy} onClick={() => void run("read", detail.nextOffset)}>
            Load more conversation
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Conversation history. The latest page refreshes while the agent is active.
        </p>
      </div>
      {error && (
        <p role="alert" className="border-t p-3 text-xs text-destructive">
          {error}
        </p>
      )}
      {detail?.canSteer && isActiveSubagentStatus(agent.status) && (
        <form
          className="space-y-2 border-t p-3"
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
          <textarea
            aria-label="Steering for subagent"
            className="min-h-20 w-full rounded-md border bg-background p-2 text-sm"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={20_000}
            placeholder="Change direction or add context…"
          />
          <Button
            type="submit"
            size="sm"
            disabled={
              busy || !draft.trim() || !detail?.canSteer || !isActiveSubagentStatus(agent.status)
            }
          >
            Send steering
          </Button>
          {!detail && (
            <p className="text-xs text-muted-foreground">
              Load steps to check whether direct steering is available.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
