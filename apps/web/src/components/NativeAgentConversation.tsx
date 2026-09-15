import { memo, useMemo } from "react";
import type { EnvironmentId, ProviderSubagentResult } from "@t3tools/contracts";
import ChatMarkdown from "./ChatMarkdown";
import { nativeAgentConversation } from "./nativeAgentConversationEntries";
import { AgentToolActivity } from "./AgentToolActivity";

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
          <AgentToolActivity key={entry.id} entry={entry} />
        ) : (
          <p key={entry.id} className="text-xs text-muted-foreground">
            {entry.text}
          </p>
        ),
      )}
    </div>
  );
});
