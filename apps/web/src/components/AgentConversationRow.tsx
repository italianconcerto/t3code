import { ChevronRight } from "lucide-react";

export function agentStatusLabel(status: string) {
  if (["running", "starting", "pending", "waiting"].includes(status)) return "Working";
  if (["idle", "ready"].includes(status)) return "Ready";
  if (["error", "failed"].includes(status)) return "Error";
  if (["cancelled", "interrupted"].includes(status)) return "Stopped";
  return status === "completed" ? "Completed" : status;
}

export function AgentConversationRow({
  title,
  subtitle,
  status,
  onOpen,
}: {
  title: string;
  subtitle: string;
  status: string;
  onOpen: () => void;
}) {
  const label = agentStatusLabel(status);
  return (
    <button
      type="button"
      aria-label={`Open subagent ${title}`}
      onClick={onOpen}
      className="group flex min-h-20 w-full items-center gap-3 rounded-lg border border-transparent px-3 py-4 text-left hover:border-border/60 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span
            aria-hidden
            className={`size-1.5 shrink-0 rounded-full ${label === "Working" ? "bg-info" : label === "Error" ? "bg-destructive" : "bg-muted-foreground/60"}`}
          />
          <span className="truncate">
            {subtitle ? `${subtitle} · ` : ""}
            {label}
          </span>
        </span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
