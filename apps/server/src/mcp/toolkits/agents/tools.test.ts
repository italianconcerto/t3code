import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { Tool } from "effect/unstable/ai";

import { AgentsToolkit } from "./tools.ts";

const decodeSpawn = Schema.decodeUnknownSync(AgentsToolkit.tools.t3_agent_spawn.parametersSchema);

it("advertises typed canonical selections instead of permissive legacy input", () => {
  const schema = Tool.getJsonSchema(AgentsToolkit.tools.t3_agent_spawn);
  expect(schema).toMatchObject({
    type: "object",
    required: ["requestId", "title", "prompt", "modelSelection"],
    properties: {
      modelSelection: {
        type: "object",
        required: ["instanceId", "model"],
        properties: {
          instanceId: { type: "string" },
          model: { type: "string" },
        },
      },
    },
  });
  expect(JSON.stringify(schema)).not.toContain('"provider":');
  expect(JSON.stringify(schema)).not.toContain("{}");
});

it("accepts cross-provider options and rejects incomplete or untyped model calls", () => {
  const input = {
    requestId: "cross-provider",
    title: "Review",
    prompt: "Review without editing files",
    modelSelection: {
      instanceId: "openrouter",
      model: "openrouter/deepseek/deepseek-v4.1-flash",
      options: [
        { id: "variant", value: "high" },
        { id: "fastMode", value: true },
      ],
    },
  };
  expect(decodeSpawn(input)).toEqual(input);
  expect(() => decodeSpawn({ notes: "ignored" })).toThrow();
  for (const modelSelection of [
    { model: input.modelSelection.model },
    { instanceId: "openrouter", model: 123 },
    { instanceId: "openrouter", model: input.modelSelection.model, options: { arbitrary: 123 } },
  ])
    expect(() => decodeSpawn({ ...input, modelSelection })).toThrow();
});
