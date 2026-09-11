import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { providerCatalogRefreshError } from "../threads/provider-catalog-refresh";

export function ProviderUpdatesSection(props: { environmentId: EnvironmentId; label: string }) {
  const providers = useAtomValue(serverEnvironment.providersValueAtom(props.environmentId));
  const update = useAtomCommand(serverEnvironment.updateProvider, { reportFailure: false });
  const refreshConfig = useAtomRefresh(
    serverEnvironment.configProjection({ environmentId: props.environmentId, input: {} }),
  );
  const pending = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const candidates = (providers ?? []).filter(
    (provider) => provider.enabled && provider.installed && provider.versionAdvisory?.canUpdate,
  );
  if (candidates.length === 0) return null;
  const runUpdate = async (provider: ServerProvider) => {
    if (pending.current.has(provider.instanceId)) return;
    pending.current.add(provider.instanceId);
    setPendingIds(new Set(pending.current));
    try {
      const result = await update({
        environmentId: props.environmentId,
        input: { provider: provider.driver, instanceId: provider.instanceId },
      });
      const error = providerCatalogRefreshError(result);
      if (error) Alert.alert("Provider update failed", error);
      if (result._tag === "Success") {
        const state = result.value.providers.find(
          (candidate) => candidate.instanceId === provider.instanceId,
        )?.updateState;
        if (state?.status === "failed" || state?.status === "unchanged") {
          Alert.alert("Provider update failed", state.message ?? "Provider was not updated.");
        }
        refreshConfig();
      }
    } finally {
      pending.current.delete(provider.instanceId);
      setPendingIds(new Set(pending.current));
    }
  };
  return (
    <View className="mt-4 gap-3 rounded-2xl bg-card p-4">
      <Text className="font-t3-bold text-foreground">Provider updates · {props.label}</Text>
      {candidates.map((provider) => {
        const busy =
          pendingIds.has(provider.instanceId) ||
          provider.updateState?.status === "queued" ||
          provider.updateState?.status === "running";
        return (
          <View key={provider.instanceId} className="gap-1">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Update ${provider.instanceId} on ${props.label}`}
              disabled={busy}
              onPress={() => void runUpdate(provider)}
              className="min-h-11 justify-center rounded-xl bg-subtle px-3"
            >
              <Text className="text-foreground">
                {busy ? "Updating" : "Update"} {provider.instanceId} ·{" "}
                {provider.versionAdvisory?.latestVersion}
              </Text>
            </Pressable>
            {provider.updateState?.message ? (
              <Text className="text-xs text-foreground-muted">{provider.updateState.message}</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
