import { memo, useMemo } from "react";
import type { EnvironmentId, ProviderSubagentResult } from "@t3tools/contracts";
import ChatMarkdown from "./ChatMarkdown";
import { nativeAgentConversation } from "./nativeAgentConversationEntries";

export const NativeAgentConversation = memo(function NativeAgentConversation({
  steps,
  environmentId,
}: {
  steps: ProviderSubagentResult["steps"];
  environmentId: EnvironmentId | null;
}) {
  const entries = useMemo(() => nativeAgentConversation(steps), [steps]);
  return (
    <div className="space-y-5" aria-label="Subagent conversation">
      {entries.map((entry) =>
        entry.kind === "message" ? (
          <article
            key={entry.id}
            aria-label={entry.role === "user" ? "Instructions" : "Agent message"}
            className={
              entry.role === "user" ? "ml-6 rounded-2xl bg-muted/60 px-4 py-3" : "min-w-0 px-1"
            }
          >
            <ChatMarkdown
              text={entry.text}
              cwd={undefined}
              environmentId={environmentId ?? undefined}
              className="text-sm leading-relaxed"
            />
          </article>
        ) : entry.kind === "tool" ? (
          <details
            key={entry.id}
            className="rounded-lg border border-border/60 px-3 py-2"
            open={entry.status === "error"}
          >
            <summary className="cursor-pointer text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{entry.name}</span>
              <span className="ml-2">
                {entry.status === "error"
                  ? "Failed"
                  : entry.status === "running"
                    ? "Running"
                    : "Completed"}
              </span>
            </summary>
            {entry.input && (
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs">
                {entry.input}
              </pre>
            )}
            {entry.output && (
              <div className="mt-3 border-t border-border/60 pt-3">
                <p className="mb-1 text-xs text-muted-foreground">Output</p>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">
                  {entry.output}
                </pre>
              </div>
            )}
          </details>
        ) : (
          <p key={entry.id} className="text-xs text-muted-foreground">
            {entry.text}
          </p>
        ),
      )}
    </div>
  );
});
