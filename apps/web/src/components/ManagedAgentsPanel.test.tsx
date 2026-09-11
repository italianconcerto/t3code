import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { ManagedAgentChat, managedMessageExcerpt } from "./ManagedAgentsPanel";

const commands = vi.hoisted(() => ({ send: vi.fn(), stop: vi.fn() }));
vi.mock("~/state/threads", () => ({
  threadEnvironment: { startTurn: "send", interruptTurn: "stop" },
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (kind: "send" | "stop") => commands[kind],
}));
vi.mock("~/state/entities", () => ({
  useThread: () => ({ messages: [], activities: [] }),
  useThreadShell: () => null,
  useThreadShells: () => [],
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
};
let renderer: ReactTestRenderer | undefined;
it("bounds verbose message rendering while preserving the newest text", () => {
  const messages = Array.from({ length: 100 }, (_, index) => ({
    id: String(index),
    role: "assistant",
    text: "🧪".repeat(10000) + `END-${index}`,
  }));
  const excerpt = managedMessageExcerpt(messages);
  expect(excerpt.reduce((sum, message) => sum + message.text.length, 0)).toBeLessThanOrEqual(20000);
  expect(excerpt.at(-1)?.text.endsWith("END-99")).toBe(true);
  expect(excerpt.every((message) => message.truncated)).toBe(true);
  const emoji = managedMessageExcerpt([
    { id: "emoji", role: "assistant", text: "🧪".repeat(4000) + "X" },
  ])[0]!;
  expect(emoji.text.startsWith("🧪")).toBe(true);
  expect(emoji.text.endsWith("X")).toBe(true);
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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
      .find((button) => button.children.includes("Stop agent"))!
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
