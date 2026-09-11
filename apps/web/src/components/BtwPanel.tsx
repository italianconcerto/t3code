import { useState } from "react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useThreadShell } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { ManagedAgentChat } from "./ManagedAgentsPanel";

export function BtwPanel({
  environmentId,
  parentId,
  threadId,
  onClose,
}: {
  environmentId: EnvironmentId;
  parentId: ThreadId;
  threadId: ThreadId;
  onClose: () => void;
}) {
  const parent = useThreadShell({ environmentId, threadId: parentId });
  const child = useThreadShell({ environmentId, threadId });
  const remove = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = async () => {
    if (closing) return;
    setClosing(true);
    const result = await remove({ environmentId, input: { threadId } });
    if (result._tag === "Success") onClose();
    else {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not close BTW. Try again.");
      setClosing(false);
    }
  };
  return (
    <aside
      className="absolute inset-y-0 right-0 z-30 flex w-full max-w-lg flex-col border-l bg-background shadow-xl lg:static lg:order-last lg:w-[420px] lg:shrink-0"
      aria-label="BTW discussion"
    >
      {error && (
        <p role="alert" className="p-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {closing ? (
        <p className="p-3">Closing BTW…</p>
      ) : parent && child ? (
        <ManagedAgentChat
          key={threadId}
          parent={parent}
          child={child}
          sideDiscussion
          onBack={() => void close()}
        />
      ) : (
        <div className="p-3">
          Loading BTW… <button onClick={() => void close()}>Close</button>
        </div>
      )}
    </aside>
  );
}
