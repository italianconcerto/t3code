import { expect, it } from "vite-plus/test";
import { nativeAgentConversation } from "./nativeAgentConversationEntries";

it("retains visible data for additional provider tools", () => {
  const [entry] = nativeAgentConversation([
    {
      id: "search",
      type: "webSearch",
      text: JSON.stringify({ type: "webSearch", query: "documentation" }),
    },
  ]);
  expect(entry).toMatchObject({ kind: "tool", name: "Web search" });
  expect(entry?.kind === "tool" && entry.output).toContain("documentation");
});

const step = (id: string, type: string, value: unknown) => ({
  id,
  type,
  text: JSON.stringify(value),
});

it("renders Claude messages and attaches tool results without fake user messages", () => {
  const entries = nativeAgentConversation([
    step("1", "assistant", {
      content: [
        { type: "text", text: "Checking **files**" },
        { type: "thinking", thinking: "private" },
        { type: "tool_use", id: "call", name: "Bash", input: { command: "pwd" } },
      ],
    }),
    step("2", "user", {
      content: [{ type: "tool_result", tool_use_id: "call", content: "workspace" }],
    }),
    step("3", "assistant", { content: [{ type: "text", text: "Done" }] }),
  ]);
  expect(entries).toHaveLength(3);
  expect(entries[0]).toMatchObject({
    kind: "message",
    role: "assistant",
    text: "Checking **files**",
  });
  expect(entries[1]).toMatchObject({
    kind: "tool",
    name: "Bash",
    output: "workspace",
    status: "completed",
  });
  expect(entries[2]).toMatchObject({ kind: "message", text: "Done" });
});

it("renders Codex command failures and visible assistant text", () => {
  expect(
    nativeAgentConversation([
      step("1", "commandExecution", {
        type: "commandExecution",
        command: "test",
        aggregatedOutput: "failed assertion",
        exitCode: 1,
      }),
      step("2", "agentMessage", { type: "agentMessage", text: "Fixing it" }),
    ]),
  ).toMatchObject([
    { kind: "tool", name: "Terminal", status: "error", output: "failed assertion" },
    { kind: "message", role: "assistant", text: "Fixing it" },
  ]);
});

it("reassembles paginated transport fragments without displaying JSON", () => {
  const text = "Long message ".repeat(1000);
  const raw = JSON.stringify({ type: "agentMessage", text });
  const first = { id: "message:part:0", type: "agentMessage", text: raw.slice(0, 8000) };
  expect(nativeAgentConversation([first])[0]?.kind).toBe("notice");
  expect(
    nativeAgentConversation([
      first,
      { id: "message:part:8000", type: "agentMessage", text: raw.slice(8000) },
    ]),
  ).toEqual([{ id: "message", kind: "message", role: "assistant", text }]);
});

it("does not display reasoning and preserves failed orphan tool results", () => {
  expect(
    nativeAgentConversation([
      step("1", "reasoning", { type: "reasoning", text: "private" }),
      step("2", "user", {
        content: [
          {
            type: "tool_result",
            tool_use_id: "missing",
            is_error: true,
            content: "Permission denied",
          },
        ],
      }),
    ]),
  ).toMatchObject([{ kind: "tool", status: "error", output: "Permission denied" }]);
});
