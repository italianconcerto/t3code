import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { ManagedAgentsNavigation } from "./ManagedAgentsNavigation";

const state = vi.hoisted(() => ({ threads: [] as EnvironmentThreadShell[], navigate: vi.fn() }));
vi.mock("../../state/entities", () => ({ useThreadShells: () => state.threads }));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: state.navigate }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("../../components/AppText", () => ({ AppText: "span" }));
vi.mock("react-native", () => ({
  View: "div",
  Pressable: "button",
  Modal: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? children : null,
  FlatList: ({
    data,
    renderItem,
  }: {
    data: EnvironmentThreadShell[];
    renderItem: (props: { item: EnvironmentThreadShell }) => ReactNode;
  }) => data.map((item) => <div key={item.id}>{renderItem({ item })}</div>),
}));
const parent: EnvironmentThreadShell = {
  environmentId: EnvironmentId.make("remote"),
  id: ThreadId.make("parent"),
  projectId: ProjectId.make("project"),
  title: "Parent",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "parent-model" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};
const child = {
  ...parent,
  id: ThreadId.make("child"),
  parentThreadId: parent.id,
  title: "Reviewer",
};
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
});

it("opens only live children in the current environment, closes the sheet and returns to parent", async () => {
  state.threads = [
    parent,
    child,
    { ...child, environmentId: EnvironmentId.make("other"), title: "Foreign" },
    { ...child, id: ThreadId.make("archived"), title: "Archived", archivedAt: parent.createdAt },
  ];
  await act(() => {
    renderer = create(
      <ManagedAgentsNavigation environmentId={parent.environmentId} threadId={parent.id} />,
    );
  });
  const press = async (label: string) => {
    await act(() => renderer!.root.findByProps({ accessibilityLabel: label }).props.onPress());
  };
  await press("Open subagents");
  expect(
    renderer!.root.findAllByProps({ accessibilityLabel: "Open subagent Foreign" }),
  ).toHaveLength(0);
  expect(
    renderer!.root.findAllByProps({ accessibilityLabel: "Open subagent Archived" }),
  ).toHaveLength(0);
  await press("Open subagent Reviewer");
  expect(state.navigate).toHaveBeenLastCalledWith("Thread", {
    environmentId: parent.environmentId,
    threadId: child.id,
  });
  expect(
    renderer!.root.findAllByProps({ accessibilityLabel: "Open subagent Reviewer" }),
  ).toHaveLength(0);
  await act(() =>
    renderer!.update(
      <ManagedAgentsNavigation environmentId={parent.environmentId} threadId={child.id} />,
    ),
  );
  await press("Open parent chat");
  expect(state.navigate).toHaveBeenLastCalledWith("Thread", {
    environmentId: parent.environmentId,
    threadId: parent.id,
  });
});

it("dismisses without navigating and removes archived children from an open roster", async () => {
  state.threads = [parent, child];
  await act(() => {
    renderer = create(
      <ManagedAgentsNavigation environmentId={parent.environmentId} threadId={parent.id} />,
    );
  });
  await act(() =>
    renderer!.root.findByProps({ accessibilityLabel: "Open subagents" }).props.onPress(),
  );
  await act(() =>
    renderer!.root.findByProps({ accessibilityLabel: "Close subagents" }).props.onPress(),
  );
  expect(state.navigate).not.toHaveBeenCalled();
  await act(() =>
    renderer!.root.findByProps({ accessibilityLabel: "Open subagents" }).props.onPress(),
  );
  state.threads = [parent, { ...child, archivedAt: parent.createdAt }];
  await act(() =>
    renderer!.update(
      <ManagedAgentsNavigation environmentId={parent.environmentId} threadId={parent.id} />,
    ),
  );
  expect(renderer!.toJSON()).toBeNull();
  state.threads = [parent, child];
  await act(() =>
    renderer!.update(
      <ManagedAgentsNavigation environmentId={parent.environmentId} threadId={parent.id} />,
    ),
  );
  expect(
    renderer!.root.findAllByProps({ accessibilityLabel: "Open subagent Reviewer" }),
  ).toHaveLength(0);
});
