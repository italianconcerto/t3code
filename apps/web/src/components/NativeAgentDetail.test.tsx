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
  const more = renderer!.root
    .findAllByType("button")
    .find((b) => b.children.includes("Load more conversation"))!;
  await act(() => more.props.onClick());
  expect(
    renderer!.root.findAllByType("article").map((p) => p.findByType("p").children.join("")),
  ).toEqual(["Question", "Answer"]);
  expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
  expect(command.mock.calls[1]![0].input.offset).toBe(20);
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
