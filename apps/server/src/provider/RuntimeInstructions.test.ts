import { describe, expect, it } from "vite-plus/test";
import { buildRuntimeInstructions } from "./RuntimeInstructions.ts";

describe("buildRuntimeInstructions", () => {
  it("keeps known model and effort metadata on one line", () => {
    expect(
      buildRuntimeInstructions({
        harness: "Codex",
        model: "  custom\nmodel  ",
        reasoningEffort: " high\n",
      }),
    ).toContain("through the Codex harness, as custom model with high reasoning effort.");
  });

  it.each([undefined, "", "auto", "default"])("omits unresolved model %s", (model) => {
    const instructions = buildRuntimeInstructions({ harness: "Cursor", model });
    expect(instructions).toContain("through the Cursor harness.");
    expect(instructions).not.toContain("reasoning effort");
  });

  it("tells every provider harness how to discover cross-provider child models", () => {
    const instructions = buildRuntimeInstructions({ harness: "OpenCode" });

    expect(instructions).toContain("use t3_agent_models before spawning");
    expect(instructions).toContain("including OpenRouter models such as DeepSeek when configured");
    expect(instructions).toContain("Do not assume the parent's provider");
    expect(instructions).toContain("T3 automatically resumes its parent");
    expect(instructions).toContain("only first-class child-agent workflow");
  });
});
