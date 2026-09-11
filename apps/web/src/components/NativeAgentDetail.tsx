import type { EnvironmentId, ThreadId, ProviderSubagentResult } from "@t3tools/contracts";
import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { isActiveSubagentStatus } from "@t3tools/client-runtime/state/subagentRuntime";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "./ui/button";

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
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (action: "read" | "steer") => {
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
            ? { threadId, agentId: agent.id, action }
            : { threadId, agentId: agent.id, action, message: sent },
      });
      if (!mounted.current) return;
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : "Could not contact the subagent.");
      } else if (action === "read") setDetail(result.value);
      else {
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
    }
  };
  const loadOnOpen = useEffectEvent(() => {
    void run("read");
  });
  useEffect(() => {
    loadOnOpen();
  }, [agent.id, environmentId, threadId]);
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
          {busy ? "Loading…" : "Load steps"}
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto space-y-3 p-3">
        {agent.recentActivity.map((step, index) => (
          <details key={`${step.at}:${index}`}>
            <summary className="cursor-pointer text-xs">{step.summary.slice(0, 120)}</summary>
            <pre className="whitespace-pre-wrap break-words text-xs">{step.summary}</pre>
          </details>
        ))}
        {agent.result && (
          <details open>
            <summary className="text-sm">Result</summary>
            <p className="whitespace-pre-wrap break-words text-sm">{agent.result}</p>
          </details>
        )}
        {detail?.steps.map((step) => (
          <details key={step.id}>
            <summary className="cursor-pointer text-xs">{step.type}</summary>
            <pre className="whitespace-pre-wrap break-words text-xs">{step.text}</pre>
          </details>
        ))}
        {detail?.steps.length === 0 && (
          <p className="text-xs text-muted-foreground">No retained steps.</p>
        )}
        <p className="text-xs text-muted-foreground">
          Recent steps only. Load steps to fetch or refresh provider details.
        </p>
      </div>
      <form
        className="space-y-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run("steer");
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
    </section>
  );
}
