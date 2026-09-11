import { describe, expect, it } from "vitest";
import { MessageId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { buildBtwTurnInput, parseBtwCommand } from "./commands";

describe("BTW", () => {
  it("recognizes only a standalone command prefix", () => {
    expect(parseBtwCommand(" /btw explain this\nplease ")).toBe("explain this\nplease");
    expect(parseBtwCommand("/btw")).toBe("");
    expect(parseBtwCommand("/btwhatever hi")).toBeNull();
    expect(parseBtwCommand("please /btw hi")).toBeNull();
  });
  it("creates an isolated provider session without inheriting runtime automation", () => {
    const source = {
      id: ThreadId.make("parent"),
      projectId: ProjectId.make("p"),
      title: "Main",
      modelSelection: { instanceId: ProviderInstanceId.make("claude-subscription"), model: "test" },
      runtimeMode: "full-access" as const,
      interactionMode: "default" as const,
      branch: "main",
      worktreePath: null,
      messages: [{ id: MessageId.make("latest") }],
    };
    const before = structuredClone(source);
    const result = buildBtwTurnInput({
      source,
      threadId: ThreadId.make("side"),
      messageId: MessageId.make("q"),
      text: "Explain",
      createdAt: "2026-09-12T00:00:00.000Z",
    });
    expect(result.threadId).toBe("side");
    expect(result.modelSelection).toEqual(source.modelSelection);
    expect(result.bootstrap?.createThread?.forkFrom).toEqual({
      threadId: "parent",
      messageId: "latest",
      mode: "side",
    });
    expect(result.runtimeMode).toBe("approval-required");
    expect(result.interactionMode).toBe("plan");
    expect(result.bootstrap?.prepareWorktree).toBeUndefined();
    expect(result.message.text).toContain("Do not modify files");
    expect(source).toEqual(before);
    expect(() =>
      buildBtwTurnInput({
        source: { ...source, messages: [] },
        threadId: ThreadId.make("side"),
        messageId: MessageId.make("q"),
        text: "Explain",
        createdAt: "2026-09-12T00:00:00.000Z",
      }),
    ).toThrow("Send a message");
  });
});
