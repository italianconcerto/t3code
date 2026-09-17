import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { ManagedAgentChat, ManagedAgentsPanel } from "./ManagedAgentsPanel";

const commands = vi.hoisted(() => ({ send: vi.fn(), stop: vi.fn(), update: vi.fn() }));
const shells = vi.hoisted(() => ({ current: [] as EnvironmentThreadShell[] }));
vi.mock("./ManagedAgentTimeline", () => ({ ManagedAgentTimeline: () => <div /> }));
vi.mock("./ManagedAgentModelPicker", () => ({
  ManagedAgentModelPicker: ({
    onChange,
    disabled,
  }: {
    onChange: (selection: unknown) => void;
    disabled: boolean;
  }) => (
    <button
      disabled={disabled}
      aria-label="Choose test model"
      onClick={() => onChange({ instanceId: "codex", model: "gpt-5.6-luna" })}
    />
  ),
}));
vi.mock("~/state/threads", () => ({
  threadEnvironment: { startTurn: "send", interruptTurn: "stop", updateMetadata: "update" },
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (kind: "send" | "stop" | "update") => commands[kind],
}));
vi.mock("~/state/entities", () => ({
  useThread: () => ({ messages: [], activities: [] }),
  useThreadShell: ({ threadId }: { threadId: ThreadId }) =>
    shells.current.find((thread) => thread.id === threadId) ?? null,
  useThreadShells: () => shells.current,
}));
vi.mock("~/lib/utils", () => ({ newMessageId: () => "side-message" }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  squashAtomCommandFailure: () => new Error("Connection lost"),
}));
vi.mock("./ui/button", () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

const parent: EnvironmentThreadShell = {
  environmentId: EnvironmentId.make("remote-environment"),
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
  title: "Child",
  modelSelection: { instanceId: ProviderInstanceId.make("claude-two"), model: "child-model" },
  session: {
    threadId: ThreadId.make("child"),
    status: "running" as const,
    providerName: "claudeAgent",
    runtimeMode: "approval-required" as const,
    activeTurnId: null,
    lastError: null,
    updatedAt: parent.updatedAt,
  },
};
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
  shells.current = [];
  vi.unstubAllGlobals();
});

it("shows only durable T3 child chats in the agent roster", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  shells.current = [parent, child];
  await act(() => {
    renderer = create(
      <ManagedAgentsPanel environmentId={parent.environmentId} threadId={parent.id} />,
    );
  });
  renderer!.root.findByProps({ "aria-label": "Agents" });
  const rendered = JSON.stringify(renderer!.toJSON());
  expect(rendered).toContain("Child");
  expect(rendered).not.toContain("Conversations");
  expect(rendered).not.toContain("Direct spawns");
});

it("retains unsent instructions on failure and routes send/stop to the child environment", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  commands.send
    .mockResolvedValueOnce({ _tag: "Failure" })
    .mockResolvedValueOnce({ _tag: "Success", value: {} });
  commands.stop.mockResolvedValue({ _tag: "Success", value: {} });
  await act(() => {
    renderer = create(<ManagedAgentChat parent={parent} child={child} onBack={() => {}} />);
  });
  const input = () => renderer!.root.findByType("textarea");
  await act(() => input().props.onChange({ target: { value: "Change direction" } }));
  await act(() => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  expect(input().props.value).toBe("Change direction");
  expect(renderer!.root.findByProps({ role: "alert" }).children).toContain("Connection lost");
  await act(() => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  expect(input().props.value).toBe("");
  expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(commands.send.mock.calls[1]?.[0]).toMatchObject({
    environmentId: child.environmentId,
    input: {
      threadId: child.id,
      runtimeMode: "approval-required",
      managedChild: { parentThreadId: parent.id, childCreatedAt: child.createdAt },
      message: { text: "Change direction" },
    },
  });
  await act(() =>
    renderer!.root
      .findAllByType("button")
      .find((button) => button.props["aria-label"] === "Stop agent")!
      .props.onClick(),
  );
  expect(commands.stop.mock.calls[0]?.[0]).toMatchObject({
    environmentId: child.environmentId,
    input: { threadId: child.id },
  });
});

it("does not erase instructions typed while a previous send is pending", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let complete: (value: unknown) => void = () => {};
  commands.send.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await act(() => {
    renderer = create(<ManagedAgentChat parent={parent} child={child} onBack={() => {}} />);
  });
  const input = () => renderer!.root.findByType("textarea");
  await act(() => input().props.onChange({ target: { value: "First instructions" } }));
  await act(() => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  await act(() => input().props.onChange({ target: { value: "Next instructions" } }));
  await act(() => complete({ _tag: "Success", value: {} }));
  expect(input().props.value).toBe("Next instructions");
});

it("sends the selected model only to the side chat and leaves the parent unchanged", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  commands.send.mockResolvedValue({ _tag: "Success", value: {} });
  commands.update.mockResolvedValue({ _tag: "Success", value: {} });
  await act(() => {
    renderer = create(
      <ManagedAgentChat
        parent={parent}
        child={{ ...child, session: null }}
        sideDiscussion
        onBack={() => {}}
      />,
    );
  });
  await act(() =>
    renderer!.root.findByProps({ "aria-label": "Choose test model" }).props.onClick(),
  );
  expect(commands.update).toHaveBeenCalledWith({
    environmentId: child.environmentId,
    input: { threadId: child.id, modelSelection: { instanceId: "codex", model: "gpt-5.6-luna" } },
  });
  await act(() =>
    renderer!.root.findByProps({ "aria-label": "Choose test model" }).props.onClick(),
  );
  expect(commands.update).toHaveBeenCalledTimes(1);
  // Send before the shell receives the metadata event (remote connection).
  await act(() =>
    renderer!.root.findByType("textarea").props.onChange({ target: { value: "Side question" } }),
  );
  await act(() => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  expect(commands.send).toHaveBeenCalledWith(
    expect.objectContaining({
      environmentId: child.environmentId,
      input: expect.objectContaining({
        threadId: child.id,
        message: expect.objectContaining({ text: "Side question" }),
      }),
    }),
  );
  expect(parent.modelSelection.model).toBe("parent-model");
  expect(commands.send.mock.calls.at(-1)?.[0].input.modelSelection).toEqual({
    instanceId: "codex",
    model: "gpt-5.6-luna",
  });
  expect(renderer!.root.findByType("textarea").props.value).toBe("");
  // Another client changes the persisted selection. The next message must
  // use that selection, not restore a stale local picker override.
  await act(() =>
    renderer!.update(
      <ManagedAgentChat
        parent={parent}
        child={{
          ...child,
          session: null,
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-astra" },
        }}
        sideDiscussion
        onBack={() => {}}
      />,
    ),
  );
  await act(() =>
    renderer!.root.findByType("textarea").props.onChange({ target: { value: "Next question" } }),
  );
  await act(() => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  expect(commands.send.mock.calls.at(-1)?.[0].input.modelSelection.model).toBe("gpt-6-astra");
});
