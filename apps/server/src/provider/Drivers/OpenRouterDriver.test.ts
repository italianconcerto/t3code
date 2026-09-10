import * as NodeAssert from "node:assert/strict";

import { OpenRouterSettings, ProviderDriverKind } from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { describe } from "vite-plus/test";

import type { ProviderInstance } from "../ProviderDriver.ts";
import {
  OpenRouterDriver,
  withOpenRouterIdentity,
  withOpenRouterTextGeneration,
} from "./OpenRouterDriver.ts";

const decodeSettings = Schema.decodeSync(OpenRouterSettings);

describe("OpenRouterDriver", () => {
  it("registers as a first-class multi-instance driver", () => {
    NodeAssert.equal(OpenRouterDriver.driverKind, "openrouter");
    NodeAssert.equal(OpenRouterDriver.metadata.displayName, "OpenRouter");
    NodeAssert.equal(OpenRouterDriver.metadata.supportsMultipleInstances, true);
  });

  it("keeps credentials out of driver config", () => {
    NodeAssert.equal("apiKey" in decodeSettings({}), false);
  });

  it.effect("keeps OpenRouter identity at adapter boundaries", () =>
    Effect.gen(function* () {
      const source = {
        provider: ProviderDriverKind.make("opencode"),
        capabilities: { sessionModelSwitch: "in-session" },
        startSession: () => Effect.succeed({ provider: ProviderDriverKind.make("opencode") }),
        sendTurn: () => Effect.succeed({}),
        listSessions: () => Effect.succeed([{ provider: ProviderDriverKind.make("opencode") }]),
        streamEvents: Stream.make({ provider: ProviderDriverKind.make("opencode") }),
      } as unknown as ProviderInstance["adapter"];
      const adapter = withOpenRouterIdentity(source);

      NodeAssert.equal(adapter.provider, "openrouter");
      NodeAssert.equal((yield* adapter.startSession({} as never)).provider, "openrouter");
      NodeAssert.equal((yield* adapter.listSessions())[0]?.provider, "openrouter");
      const event = Option.getOrNull(yield* Stream.runHead(adapter.streamEvents));
      NodeAssert.equal(event?.provider, "openrouter");
    }),
  );

  it.effect("rejects non-OpenRouter models at adapter and text-generation boundaries", () =>
    Effect.gen(function* () {
      let adapterCalls = 0;
      let textGenerationCalls = 0;
      const sourceAdapter = {
        provider: ProviderDriverKind.make("opencode"),
        capabilities: { sessionModelSwitch: "in-session" },
        startSession: () => {
          adapterCalls += 1;
          return Effect.succeed({ provider: ProviderDriverKind.make("opencode") });
        },
        sendTurn: () => {
          adapterCalls += 1;
          return Effect.succeed({});
        },
        listSessions: () => Effect.succeed([]),
        streamEvents: Stream.empty,
      } as unknown as ProviderInstance["adapter"];
      const adapter = withOpenRouterIdentity(sourceAdapter);
      const modelSelection = { instanceId: "openrouter", model: "openai/gpt-5" } as const;

      const startError = yield* Effect.flip(
        adapter.startSession({ modelSelection } as Parameters<typeof adapter.startSession>[0]),
      );
      const turnError = yield* Effect.flip(
        adapter.sendTurn({ modelSelection } as Parameters<typeof adapter.sendTurn>[0]),
      );
      NodeAssert.match(startError.message, /must start with 'openrouter\/'/);
      NodeAssert.match(turnError.message, /must start with 'openrouter\/'/);
      NodeAssert.equal(adapterCalls, 0);

      const sourceTextGeneration = {
        generateCommitMessage: () => {
          textGenerationCalls += 1;
          return Effect.succeed({ subject: "unused", body: "" });
        },
      } as unknown as ProviderInstance["textGeneration"];
      const textGeneration = withOpenRouterTextGeneration(sourceTextGeneration);
      const textError = yield* Effect.flip(
        textGeneration.generateCommitMessage({ modelSelection } as Parameters<
          typeof textGeneration.generateCommitMessage
        >[0]),
      );
      NodeAssert.match(textError.message, /must start with 'openrouter\/'/);
      NodeAssert.equal(textGenerationCalls, 0);
    }),
  );
});
