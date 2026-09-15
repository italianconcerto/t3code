import { expect, it } from "vite-plus/test";
import { agentToolTitle, agentToolExtraInput } from "./AgentToolActivity";

const entry = {
  id: "tool",
  kind: "tool" as const,
  name: "Terminal",
  input: "",
  output: "",
  status: "completed" as const,
};
it("shows the command rather than a generic terminal label and retains original input", () => {
  const tool = { ...entry, input: "/bin/zsh -lc 'git status --short'" };
  expect(agentToolTitle(tool)).toBe("git status --short");
  expect(tool.input).toBe("/bin/zsh -lc 'git status --short'");
});
it("uses the command inside Claude Bash input without changing generic tool names", () => {
  expect(
    agentToolTitle({ ...entry, name: "Bash", input: JSON.stringify({ command: "pwd" }) }),
  ).toBe("pwd");
  expect(agentToolTitle({ ...entry, name: "Read", input: '{"file_path":"README.md"}' })).toBe(
    "Read",
  );
});
it("preserves complex command contents and handles empty or malformed inputs", () => {
  expect(agentToolTitle({ ...entry, input: "/bin/zsh -lc \"printf 'OK\\n'\"" })).toBe(
    "printf 'OK\\n'",
  );
  expect(agentToolTitle(entry)).toBe("Terminal");
  expect(agentToolTitle({ ...entry, name: "Bash", input: "{partial" })).toBe("{partial");
});

it("does not repeat commands but preserves additional Bash parameters and other tool inputs", () => {
  expect(agentToolExtraInput({ ...entry, input: "/bin/zsh -lc pwd" })).toBe("");
  expect(agentToolExtraInput({ ...entry, name: "Bash", input: '{"command":"pwd"}' })).toBe("");
  expect(
    JSON.parse(
      agentToolExtraInput({ ...entry, name: "Bash", input: '{"command":"pwd","timeout":1000}' }),
    ),
  ).toEqual({ timeout: 1000 });
  expect(agentToolExtraInput({ ...entry, name: "Read", input: "README.md" })).toBe("README.md");
});
