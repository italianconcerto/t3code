import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { serverEnvironment } from "~/state/server";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "~/providerInstances";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import { ProviderModelPicker } from "./chat/ProviderModelPicker";

export function ManagedAgentModelPicker({
  environmentId,
  selection,
  disabled,
  onChange,
}: {
  environmentId: EnvironmentId;
  selection: ModelSelection;
  disabled: boolean;
  onChange: (selection: ModelSelection) => void;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const providers = config?.providers ?? [];
  return (
    <ProviderModelPicker
      activeInstanceId={selection.instanceId}
      model={selection.model}
      lockedProvider={null}
      instanceEntries={sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
      )}
      modelOptionsByInstance={getCustomModelOptionsByInstance(
        settings,
        providers,
        selection.instanceId,
        selection.model,
      )}
      disabled={disabled}
      compact
      isComposerOwned={false}
      triggerAriaLabel="Choose side chat model"
      onInstanceModelChange={(instanceId, model) => onChange({ instanceId, model })}
    />
  );
}
