import { Check, ChevronRight, Circle, CircleAlert } from "lucide-react";
import type { NativeConversationEntry } from "./nativeAgentConversationEntries";

type ToolEntry = Extract<NativeConversationEntry, { kind: "tool" }>;

export function agentToolTitle(entry: ToolEntry) {
  if (entry.name !== "Terminal" && entry.name !== "Bash") return entry.name;
  let command = entry.input;
  if (entry.name === "Bash") {
    try {
      const input: unknown = JSON.parse(command);
      if (
        input &&
        typeof input === "object" &&
        "command" in input &&
        typeof input.command === "string"
      )
        command = input.command;
    } catch {
      /* Plain command text is also supported. */
    }
  }
  const shell = /^\/(?:usr\/)?bin\/(?:ba|z)?sh -[a-z]*c\s+([\s\S]+)$/.exec(command);
  if (shell) {
    command = shell[1]!;
    if (
      (command.startsWith("'") && command.endsWith("'")) ||
      (command.startsWith('"') && command.endsWith('"'))
    )
      command = command.slice(1, -1);
  }
  return command.trim() || entry.name;
}

export function AgentToolActivity({ entry }: { entry: ToolEntry }) {
  const title = agentToolTitle(entry);
  const extraInput = agentToolExtraInput(entry);
  const Status =
    entry.status === "error" ? CircleAlert : entry.status === "running" ? Circle : Check;
  const status =
    entry.status === "error" ? "Failed" : entry.status === "running" ? "Running" : "Completed";
  return (
    <details className="group/tool min-w-0" open={entry.status === "error"}>
      <summary className="flex cursor-pointer list-none items-start gap-2 rounded-md py-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <Status
          aria-hidden
          className={`mt-0.5 size-3.5 shrink-0 ${entry.status === "error" ? "text-destructive" : entry.status === "running" ? "text-info" : "text-muted-foreground"}`}
        />
        <span className="sr-only">{status}: </span>
        <span className="min-w-0 flex-1 truncate font-mono leading-5 group-open/tool:whitespace-pre-wrap group-open/tool:break-words">
          {title}
        </span>
        <ChevronRight aria-hidden className="mt-1 size-3 shrink-0 group-open/tool:rotate-90" />
      </summary>
      <div className="ml-1.5 space-y-3 border-l border-border/70 py-2 pl-5">
        {extraInput && (
          <pre
            aria-label="Tool input"
            tabIndex={0}
            className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {extraInput}
          </pre>
        )}
        {entry.output && (
          <pre
            aria-label="Tool result"
            tabIndex={0}
            className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/85 focus-visible:outline-2 focus-visible:outline-ring"
          >
            {entry.output}
          </pre>
        )}
      </div>
    </details>
  );
}

export function agentToolExtraInput(entry: ToolEntry): string {
  if (entry.name === "Terminal") return "";
  if (entry.name !== "Bash") return entry.input;
  try {
    const input: unknown = JSON.parse(entry.input);
    if (
      input &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      "command" in input &&
      typeof input.command === "string"
    ) {
      const remaining = Object.fromEntries(
        Object.entries(input).filter(([key]) => key !== "command"),
      );
      return Object.keys(remaining).length ? JSON.stringify(remaining, null, 2) : "";
    }
  } catch {
    /* Plain command is already the title. */
  }
  return "";
}
