/**
 * OpenCodeDriver — `ProviderDriver` for the OpenCode runtime.
 *
 * Mirrors the Codex / Claude drivers: a plain value whose `create()`
 * bundles `snapshot` / `adapter` / `textGeneration` closures over the
 * per-instance `OpenCodeSettings`.
 *
 * Two instances with different `serverUrl`s therefore talk to independent
 * OpenCode servers; when no `serverUrl` is set, the adapter + text-generation
 * shares spin up their own scoped child processes, and those child
 * processes are released when the registry scope closes.
 *
 * @module provider/Drivers/OpenCodeDriver
 */
import { OpenCodeSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import { makeOpenCodeTextGeneration } from "../../textGeneration/OpenCodeTextGeneration.ts";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeOpenCodeAdapter } from "../Layers/OpenCodeAdapter.ts";
import {
  checkOpenCodeProviderStatus,
  makePendingOpenCodeProvider,
  openCodeSkillsToServerProviderSkills,
  type OpenCodeProviderProfile,
} from "../Layers/OpenCodeProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { OpenCodeRuntime } from "../opencodeRuntime.ts";
import * as OpenCodeServerOwner from "../OpenCodeServerOwner.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { withInstanceIdentity } from "./instanceIdentity.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  makeCachedProviderMaintenanceResolution,
  makePackageManagedProviderMaintenanceResolver,
  normalizeCommandPath,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
const decodeOpenCodeSettings = Schema.decodeSync(OpenCodeSettings);

function isOpenCodeNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeCommandPath(commandPath);
  return (
    normalized.endsWith("/.opencode/bin/opencode") ||
    normalized.endsWith("/.opencode/bin/opencode.exe")
  );
}

export type OpenCodeDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | OpenCodeRuntime
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

export interface OpenCodeBackedDriverOptions<Settings> {
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly configSchema: Schema.Codec<Settings, unknown>;
  readonly defaultConfig: () => Settings;
  readonly toOpenCodeSettings: (
    config: Settings,
    enabled: boolean,
    environment: NodeJS.ProcessEnv,
  ) => OpenCodeSettings;
  readonly profile?: OpenCodeProviderProfile;
  readonly processEnvironment?: (
    config: Settings,
    environment: NodeJS.ProcessEnv,
  ) => NodeJS.ProcessEnv;
  readonly mapAdapter?: (adapter: ProviderInstance["adapter"]) => ProviderInstance["adapter"];
  readonly mapTextGeneration?: (
    textGeneration: ProviderInstance["textGeneration"],
  ) => ProviderInstance["textGeneration"];
}

export function makeOpenCodeBackedDriver<Settings>(
  options: OpenCodeBackedDriverOptions<Settings>,
): ProviderDriver<Settings, OpenCodeDriverEnv> {
  const update = makePackageManagedProviderMaintenanceResolver({
    provider: options.driverKind,
    npmPackageName: "opencode-ai",
    nativeUpdate: {
      args: ["upgrade"],
      isCommandPath: isOpenCodeNativeCommandPath,
    },
  });

  return {
    driverKind: options.driverKind,
    metadata: {
      displayName: options.displayName,
      supportsMultipleInstances: true,
    },
    configSchema: options.configSchema,
    defaultConfig: options.defaultConfig,
    create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const fileSystem = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const openCodeRuntime = yield* OpenCodeRuntime;
        const serverConfig = yield* ServerConfig;
        const httpClient = yield* HttpClient.HttpClient;
        const serverSettings = yield* ServerSettingsService;
        const eventLoggers = yield* ProviderEventLoggers;
        const baseProcessEnv = mergeProviderInstanceEnvironment(environment);
        const processEnv = options.processEnvironment?.(config, baseProcessEnv) ?? baseProcessEnv;
        const continuationIdentity = defaultProviderContinuationIdentity({
          driverKind: options.driverKind,
          instanceId,
        });
        const stampIdentity = withInstanceIdentity({
          instanceId,
          driverKind: options.driverKind,
          displayName,
          accentColor,
          continuationGroupKey: continuationIdentity.continuationKey,
        });
        const effectiveConfig = options.toOpenCodeSettings(config, enabled, processEnv);
        const resolveMaintenance = yield* makeCachedProviderMaintenanceResolution(
          resolveProviderMaintenanceCapabilitiesEffect(update, {
            binaryPath: effectiveConfig.binaryPath,
            env: processEnv,
          }).pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, pathService),
          ),
        );

        const openCodeAdapter = yield* makeOpenCodeAdapter(effectiveConfig, {
          instanceId,
          environment: processEnv,
          ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
        });
        const adapter = options.mapAdapter?.(openCodeAdapter) ?? openCodeAdapter;
        const serverOwner = yield* OpenCodeServerOwner.make({
          binaryPath: effectiveConfig.binaryPath,
          directory: serverConfig.cwd,
          ...(effectiveConfig.serverPassword
            ? { serverPassword: effectiveConfig.serverPassword }
            : {}),
          environment: processEnv,
        });
        const openCodeTextGeneration = yield* makeOpenCodeTextGeneration(effectiveConfig).pipe(
          Effect.provideService(OpenCodeServerOwner.OpenCodeServerOwner, serverOwner),
        );
        const textGeneration =
          options.mapTextGeneration?.(openCodeTextGeneration) ?? openCodeTextGeneration;

        const checkProvider = checkOpenCodeProviderStatus(
          effectiveConfig,
          serverConfig.cwd,
          processEnv,
          options.profile,
        ).pipe(
          Effect.map(stampIdentity),
          Effect.provideService(OpenCodeServerOwner.OpenCodeServerOwner, serverOwner),
          Effect.provideService(OpenCodeRuntime, openCodeRuntime),
        );
        // NOTE: the local branch intentionally uses the shared SDK server
        // instead of `opencode debug skill` (loadSkillsFromCli). The CLI writes
        // its full JSON inventory to stdout, but the Bun-compiled binary does
        // not flush more than one 64KB pipe buffer to a non-TTY stdout, so the
        // piped output arrives truncated and unparseable — which degrades to an
        // empty skill list and poisons the workspace snapshot the `$` picker
        // reads. The SDK `app.skills` endpoint honors the per-request directory
        // and returns complete results regardless of size.
        const loadSkillsForCwd = (cwd: string) =>
          effectiveConfig.serverUrl.trim().length > 0
            ? Effect.scoped(
                Effect.gen(function* () {
                  const server = yield* openCodeRuntime.connectToOpenCodeServer({
                    binaryPath: effectiveConfig.binaryPath,
                    directory: cwd,
                    serverUrl: effectiveConfig.serverUrl,
                    ...(effectiveConfig.serverPassword
                      ? { serverPassword: effectiveConfig.serverPassword }
                      : {}),
                    environment: processEnv,
                  });
                  const client = openCodeRuntime.createOpenCodeSdkClient({
                    baseUrl: server.url,
                    directory: cwd,
                    ...(effectiveConfig.serverPassword
                      ? { serverPassword: effectiveConfig.serverPassword }
                      : {}),
                  });
                  return yield* openCodeRuntime.loadOpenCodeSkills(client);
                }),
              )
            : serverOwner.withServer((server) =>
                openCodeRuntime.loadOpenCodeSkills(
                  openCodeRuntime.createOpenCodeSdkClient({
                    baseUrl: server.url,
                    directory: cwd,
                    ...(server.serverPassword !== undefined
                      ? { serverPassword: server.serverPassword }
                      : {}),
                  }),
                ),
              );

        const snapshotSettings = makeProviderSnapshotSettingsSource(
          effectiveConfig,
          serverSettings,
        );
        const snapshot = yield* makeManagedServerProvider<
          ProviderSnapshotSettings<OpenCodeSettings>
        >({
          resolveMaintenance,
          getSettings: snapshotSettings.getSettings,
          streamSettings: snapshotSettings.streamSettings,
          haveSettingsChanged: haveProviderSnapshotSettingsChanged,
          checkProviderOnSettingsChange: () => false,
          refreshOnInterval: false,
          initialSnapshot: (settings) =>
            makePendingOpenCodeProvider(settings.provider, options.profile).pipe(
              Effect.map(stampIdentity),
            ),
          checkProvider,
          enrichSnapshot: ({ settings, snapshot, publishSnapshot }) =>
            resolveMaintenance().pipe(
              Effect.flatMap((maintenanceCapabilities) =>
                enrichProviderSnapshotWithVersionAdvisory(snapshot, maintenanceCapabilities, {
                  enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
                }),
              ),
              Effect.provideService(HttpClient.HttpClient, httpClient),
              Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
            ),
        }).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderDriverError({
                driver: options.driverKind,
                instanceId,
                detail: `Failed to build OpenCode snapshot: ${cause.message ?? String(cause)}`,
                cause,
              }),
          ),
        );

        return {
          instanceId,
          driverKind: options.driverKind,
          continuationIdentity,
          displayName,
          accentColor,
          enabled,
          snapshot,
          snapshotForCwd: (cwd) =>
            !effectiveConfig.enabled
              ? snapshot.getSnapshot
              : Effect.all([
                  snapshot.getSnapshot,
                  loadSkillsForCwd(cwd).pipe(Effect.timeout("20 seconds")),
                ]).pipe(
                  Effect.map(([machineSnapshot, skills]) => ({
                    ...machineSnapshot,
                    skills: openCodeSkillsToServerProviderSkills(skills),
                  })),
                  Effect.mapError(
                    (cause) =>
                      new ProviderDriverError({
                        driver: options.driverKind,
                        instanceId,
                        detail: `Failed to probe OpenCode skills for '${cwd}'`,
                        cause,
                      }),
                  ),
                ),
          adapter,
          textGeneration,
        } satisfies ProviderInstance;
      }),
  };
}

const DRIVER_KIND = ProviderDriverKind.make("opencode");

export const OpenCodeDriver = makeOpenCodeBackedDriver({
  driverKind: DRIVER_KIND,
  displayName: "OpenCode",
  configSchema: OpenCodeSettings,
  defaultConfig: (): OpenCodeSettings => decodeOpenCodeSettings({}),
  toOpenCodeSettings: (config, enabled) => ({ ...config, enabled }),
});
