import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import { NativeAgentDetail } from "./NativeAgentDetail";
const command = vi.hoisted(() => vi.fn());
vi.mock("./ChatMarkdown", () => ({ default: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock("~/state/orchestration", () => ({ orchestrationEnvironment: { subagent: "subagent" } }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => command }));
vi.mock("./ui/button", () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));
const agent: RuntimeSubagent = {
  id: "child",
  kind: "subagent",
  title: "Child",
  role: null,
  model: null,
  effort: null,
  status: "running",
  activationCount: 1,
  usage: null,
  progress: null,
  lastToolName: null,
  result: null,
  error: null,
  outputFile: null,
  parentAgentId: null,
  agentIndex: null,
  phaseIndex: null,
  phaseTitle: null,
  attempt: null,
  workflowName: null,
  phases: [],
  runHandles: null,
  recentActivity: [],
  firstSeenAt: "",
  startedAt: null,
  completedAt: null,
  updatedAt: "",
};
const props = {
  agent,
  environmentId: EnvironmentId.make("env"),
  threadId: ThreadId.make("parent"),
  onBack: () => {},
};

it("opens the tail, prepends older messages and follows new pages without losing history", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let tick = () => {};
  vi.stubGlobal("window", {
    setInterval: (callback: () => void) => {
      tick = callback;
      return 1;
    },
    clearInterval: () => {},
  });
  const step = (id: string) => ({ id, type: "assistant", text: id });
  command
    .mockResolvedValueOnce({
      _tag: "Success",
      value: { canSteer: true, offset: 40, previousOffset: 20, steps: [step("latest")] },
    })
    .mockResolvedValueOnce({
      _tag: "Success",
      value: {
        canSteer: true,
        offset: 20,
        previousOffset: 0,
        nextOffset: 40,
        steps: [step("earlier")],
      },
    })
    .mockResolvedValueOnce({
      _tag: "Success",
      value: {
        canSteer: true,
        offset: 40,
        previousOffset: 20,
        nextOffset: 60,
        steps: [step("latest")],
      },
    })
    .mockResolvedValueOnce({
      _tag: "Success",
      value: { canSteer: true, offset: 60, previousOffset: 40, steps: [step("new")] },
    });
  await act(() => {
    renderer = create(<NativeAgentDetail {...props} />);
  });
  await act(() =>
    renderer!.root
      .findAllByType("button")
      .find((b) => b.children.includes("Load earlier messages"))!
      .props.onClick(),
  );
  expect(command).toHaveBeenCalledTimes(2);
  await act(() => tick());
  expect(command.mock.calls.map((call) => call[0].input)).toEqual([
    expect.objectContaining({ tail: true }),
    expect.objectContaining({ offset: 20 }),
    expect.objectContaining({ offset: 40 }),
    expect.objectContaining({ offset: 60 }),
  ]);
  expect(
    renderer!.root.findAllByType("article").map((p) => p.findByType("p").children.join("")),
  ).toEqual(["earlier", "latest", "new"]);
});
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("reads and extends history even when steering is unsupported", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  command
    .mockResolvedValueOnce({
      _tag: "Success",
      value: {
        canSteer: false,
        steps: [{ id: "one", type: "user", text: "Question" }],
        nextOffset: 20,
      },
    })
    .mockResolvedValueOnce({
      _tag: "Success",
      value: { canSteer: false, steps: [{ id: "two", type: "assistant", text: "Answer" }] },
    });
  await act(() => {
    renderer = create(<NativeAgentDetail {...props} agent={{ ...agent, status: "idle" }} />);
  });
  expect(
    renderer!.root.findAllByType("article").map((p) => p.findByType("p").children.join("")),
  ).toEqual(["Question", "Answer"]);
  expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
  expect(command.mock.calls[1]![0].input.offset).toBe(20);
  expect(command.mock.calls[0]![0].input.tail).toBe(true);
});
it("fetches final output after a pending read when the agent settles", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { setInterval: () => 1, clearInterval: () => {} });
  let resolve!: (value: unknown) => void;
  command
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValueOnce({
      _tag: "Success",
      value: { canSteer: false, steps: [{ id: "final", type: "assistant", text: "Finished" }] },
    });
  await act(() => {
    renderer = create(<NativeAgentDetail {...props} />);
  });
  await act(() =>
    renderer!.update(<NativeAgentDetail {...props} agent={{ ...agent, status: "completed" }} />),
  );
  await act(() => resolve({ _tag: "Success", value: { canSteer: true, steps: [] } }));
  expect(command).toHaveBeenCalledTimes(2);
  expect(renderer!.root.findAllByType("article")[0]!.findByType("p").children).toContain(
    "Finished",
  );
});

it("sends steering with Enter, preserves Shift+Enter and rejects empty messages", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { setInterval: () => 1, clearInterval: () => {} });
  command.mockResolvedValue({ _tag: "Success", value: { canSteer: true, steps: [] } });
  await act(() => {
    renderer = create(<NativeAgentDetail {...props} />);
  });
  const input = () => renderer!.root.findByType("textarea");
  const key = (shiftKey = false) => ({
    key: "Enter",
    shiftKey,
    nativeEvent: { isComposing: false },
    preventDefault() {},
  });
  await act(() => input().props.onKeyDown(key()));
  expect(command).toHaveBeenCalledTimes(1);
  await act(() => input().props.onChange({ target: { value: "Change direction" } }));
  await act(() => input().props.onKeyDown(key(true)));
  expect(command).toHaveBeenCalledTimes(1);
  await act(() => input().props.onKeyDown(key()));
  expect(command.mock.calls[1]![0]).toMatchObject({
    environmentId: props.environmentId,
    input: {
      threadId: props.threadId,
      agentId: agent.id,
      action: "steer",
      message: "Change direction",
    },
  });
  expect(input().props.value).toBe("");
});
