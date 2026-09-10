/**
 * OpenRouter driver backed by OpenCode's coding-agent runtime.
 * OpenCode supplies tool execution and durable sessions; this driver scopes
 * its catalog and credentials to OpenRouter and preserves OpenRouter as the
 * provider identity at T3's adapter boundary.
 */
import {
  OpenRouterSettings,
  ProviderDriverKind,
  TextGenerationError,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ProviderAdapterValidationError } from "../Errors.ts";
import type { ProviderInstance } from "../ProviderDriver.ts";
import { makeOpenCodeBackedDriver, type OpenCodeDriverEnv } from "./OpenCodeDriver.ts";

const DRIVER_KIND = ProviderDriverKind.make("openrouter");
const decodeOpenRouterSettings = Schema.decodeSync(OpenRouterSettings);

function isOpenRouterModel(modelSelection: ModelSelection | undefined): boolean {
  return modelSelection === undefined || modelSelection.model.startsWith("openrouter/");
}

const validateAdapterModel = (operation: string, modelSelection: ModelSelection | undefined) =>
  isOpenRouterModel(modelSelection)
    ? Effect.void
    : Effect.fail(
        new ProviderAdapterValidationError({
          provider: DRIVER_KIND,
          operation,
          issue: `OpenRouter model selection must start with 'openrouter/', received '${modelSelection?.model}'.`,
        }),
      );

export function withOpenRouterIdentity(
  adapter: ProviderInstance["adapter"],
): ProviderInstance["adapter"] {
  const stampSession = <Session extends { readonly provider: ProviderDriverKind }>(
    session: Session,
  ): Session => ({ ...session, provider: DRIVER_KIND });
  const nativeCompaction = adapter.compaction?.type === "native" ? adapter.compaction : undefined;
  const compaction =
    nativeCompaction !== undefined
      ? {
          ...nativeCompaction,
          start: (
            threadId: Parameters<typeof nativeCompaction.start>[0],
            modelSelection?: ModelSelection,
          ) =>
            validateAdapterModel("compactThread", modelSelection).pipe(
              Effect.flatMap(() => nativeCompaction.start(threadId, modelSelection)),
            ),
        }
      : adapter.compaction;

  return {
    ...adapter,
    provider: DRIVER_KIND,
    startSession: (input) =>
      validateAdapterModel("startSession", input.modelSelection).pipe(
        Effect.flatMap(() => adapter.startSession(input)),
        Effect.map(stampSession),
      ),
    sendTurn: (input) =>
      validateAdapterModel("sendTurn", input.modelSelection).pipe(
        Effect.flatMap(() => adapter.sendTurn(input)),
      ),
    ...(compaction === undefined ? {} : { compaction }),
    listSessions: () =>
      adapter.listSessions().pipe(Effect.map((sessions) => sessions.map(stampSession))),
    streamEvents: adapter.streamEvents.pipe(
      Stream.map((event) => ({
        ...event,
        provider: DRIVER_KIND,
      })),
    ),
  };
}

export function withOpenRouterTextGeneration(
  textGeneration: ProviderInstance["textGeneration"],
): ProviderInstance["textGeneration"] {
  const validate = (operation: string, modelSelection: ModelSelection) =>
    isOpenRouterModel(modelSelection)
      ? Effect.void
      : Effect.fail(
          new TextGenerationError({
            operation,
            detail: `OpenRouter model selection must start with 'openrouter/', received '${modelSelection.model}'.`,
          }),
        );
  return {
    generateCommitMessage: (input) =>
      validate("generateCommitMessage", input.modelSelection).pipe(
        Effect.flatMap(() => textGeneration.generateCommitMessage(input)),
      ),
    generatePrContent: (input) =>
      validate("generatePrContent", input.modelSelection).pipe(
        Effect.flatMap(() => textGeneration.generatePrContent(input)),
      ),
    generateBranchName: (input) =>
      validate("generateBranchName", input.modelSelection).pipe(
        Effect.flatMap(() => textGeneration.generateBranchName(input)),
      ),
    generateThreadTitle: (input) =>
      validate("generateThreadTitle", input.modelSelection).pipe(
        Effect.flatMap(() => textGeneration.generateThreadTitle(input)),
      ),
  };
}

export type OpenRouterDriverEnv = OpenCodeDriverEnv;

export const OpenRouterDriver = makeOpenCodeBackedDriver({
  driverKind: DRIVER_KIND,
  displayName: "OpenRouter",
  configSchema: OpenRouterSettings,
  defaultConfig: (): OpenRouterSettings => decodeOpenRouterSettings({}),
  toOpenCodeSettings: (config, enabled, environment) => ({
    ...config,
    enabled,
    serverPassword: environment.OPENCODE_SERVER_PASSWORD?.trim() ?? "",
  }),
  profile: {
    displayName: "OpenRouter",
    upstreamProviderId: "openrouter",
    authType: "api-key",
  },
  mapAdapter: withOpenRouterIdentity,
  mapTextGeneration: withOpenRouterTextGeneration,
});
