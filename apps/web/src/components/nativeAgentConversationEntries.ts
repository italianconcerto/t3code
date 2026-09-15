import * as Predicate from "effect/Predicate";
import type { ProviderSubagentResult } from "@t3tools/contracts";

export type NativeConversationEntry =
  | { id: string; kind: "message"; role: "user" | "assistant"; text: string }
  | {
      id: string;
      kind: "tool";
      name: string;
      input: string;
      output: string;
      status: "running" | "completed" | "error";
    }
  | { id: string; kind: "notice"; text: string };
const object = (value: unknown): Record<string, unknown> =>
  Predicate.isObject(value) ? (value as Record<string, unknown>) : {};
const string = (value: unknown) => (Predicate.isString(value) ? value : "");
function contentText(value: unknown): string {
  if (Predicate.isString(value)) return value;
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join("\n");
  const block = object(value);
  if (block.type === "thinking" || block.type === "redacted_thinking") return "";
  if (block.type === "image") return "[Image attachment]";
  return string(block.text) || string(block.content);
}
const format = (value: unknown) =>
  Predicate.isString(value) ? value : value == null ? "" : JSON.stringify(value, null, 2);

/** Reassemble transport fragments before decoding provider messages. Tool
 * results belong to their calls, even when Claude transports them as users. */
export function nativeAgentConversation(
  steps: ProviderSubagentResult["steps"],
): NativeConversationEntry[] {
  const messages = new Map<string, { type: string; parts: Map<number, string> }>();
  for (const step of steps) {
    const match = /:part:(\d+)$/.exec(step.id);
    const id = match ? step.id.slice(0, match.index) : step.id;
    const message = messages.get(id) ?? { type: step.type, parts: new Map<number, string>() };
    message.parts.set(match ? Number(match[1]) : 0, step.text);
    messages.set(id, message);
  }
  const entries: NativeConversationEntry[] = [];
  const tools = new Map<string, Extract<NativeConversationEntry, { kind: "tool" }>>();
  const addMessage = (id: string, role: "user" | "assistant", text: string) => {
    if (text.trim()) entries.push({ id, kind: "message", role, text });
  };
  for (const [id, message] of messages) {
    if (!message.parts.has(0)) {
      entries.push({
        id,
        kind: "notice",
        text: "Load earlier messages to see the start of this message.",
      });
      continue;
    }
    const raw = [...message.parts]
      .sort(([a], [b]) => a - b)
      .map(([, text]) => text)
      .join("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A page can end partway through a JSON message. Never expose wire JSON
      // as chat text while waiting for the remaining fragments.
      entries.push(
        raw.trimStart().startsWith("{") || raw.trimStart().startsWith("[")
          ? { id, kind: "notice", text: "Message continues on the next page." }
          : {
              id,
              kind: "message",
              role: message.type === "user" ? "user" : "assistant",
              text: raw,
            },
      );
      continue;
    }
    const item = object(parsed);
    const type = string(item.type) || message.type;
    if (type === "reasoning" || type === "thinking" || type === "redacted_thinking") continue;
    if (type === "agentMessage" || type === "userMessage") {
      addMessage(
        id,
        type === "userMessage" ? "user" : "assistant",
        string(item.text) || contentText(item.content),
      );
      continue;
    }
    if (
      type === "commandExecution" ||
      type === "mcpToolCall" ||
      type === "dynamicToolCall" ||
      type === "fileChange"
    ) {
      entries.push({
        id,
        kind: "tool",
        name:
          type === "commandExecution"
            ? "Terminal"
            : type === "fileChange"
              ? "File changes"
              : string(item.tool) || "Tool",
        input: format(item.command ?? item.arguments ?? item.changes),
        output: format(item.aggregatedOutput ?? item.result ?? item.contentItems ?? item.error),
        status:
          item.status === "failed" ||
          item.error != null ||
          (typeof item.exitCode === "number" && item.exitCode !== 0)
            ? "error"
            : item.status === "inProgress"
              ? "running"
              : "completed",
      });
      continue;
    }
    const role = item.role === "user" || message.type === "user" ? "user" : "assistant";
    if (Array.isArray(item.content)) {
      for (const [index, value] of item.content.entries()) {
        const block = object(value);
        const blockId = `${id}:${index}`;
        if (block.type === "tool_use" || block.type === "server_tool_use") {
          const tool: Extract<NativeConversationEntry, { kind: "tool" }> = {
            id: blockId,
            kind: "tool",
            name: string(block.name) || "Tool",
            input: format(block.input),
            output: "",
            status: "running",
          };
          tools.set(string(block.id) || blockId, tool);
          entries.push(tool);
        } else if (block.type === "tool_result") {
          const key = string(block.tool_use_id);
          let tool = tools.get(key);
          if (!tool) {
            tool = {
              id: blockId,
              kind: "tool",
              name: "Tool result",
              input: "",
              output: "",
              status: "completed",
            };
            tools.set(key, tool);
            entries.push(tool);
          }
          tool.output = contentText(block.content) || format(block.content);
          tool.status = block.is_error === true ? "error" : "completed";
        } else addMessage(blockId, role, contentText(block));
      }
    } else if (typeof item.content === "string" || typeof item.text === "string") {
      addMessage(id, role, string(item.content) || string(item.text));
    } else {
      entries.push({
        id,
        kind: "tool",
        name:
          type === "webSearch"
            ? "Web search"
            : type === "imageGeneration"
              ? "Image generation"
              : type,
        input: "",
        output: format(
          Object.fromEntries(
            Object.entries(item).filter(
              ([key]) => !["reasoning", "thinking", "redacted_thinking"].includes(key),
            ),
          ),
        ),
        status: type === "error" || item.status === "failed" ? "error" : "completed",
      });
    }
  }
  return entries;
}
