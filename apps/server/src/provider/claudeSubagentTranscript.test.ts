// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";
import { CLAUDE_SUBAGENT_READER } from "./claudeSubagentTranscript.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const { mkdtemp, mkdir, writeFile, rm } = NodeFSP;
const { tmpdir } = NodeOS;
const { join } = NodePath;
it("reads all Claude pages in the selected subscription without dropping tool results", async () => {
  const root = await mkdtemp(join(tmpdir(), "t3-subagent-reader-"));
  try {
    const cwd = "/tmp/t3-reader-project";
    const session = "11111111-1111-4111-8111-111111111111";
    const directory = join(root, "projects", "-tmp-t3-reader-project", session, "subagents");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(root, "projects", "-tmp-t3-reader-project", `${session}.jsonl`),
      JSON.stringify({
        type: "user",
        uuid: "root",
        sessionId: session,
        cwd,
        message: { role: "user", content: "Task" },
      }) + "\n",
    );
    const rows = Array.from({ length: 52 }, (_, index) => ({
      type: index % 2 ? "user" : "assistant",
      uuid: `message-${index}`,
      parentUuid: index ? `message-${index - 1}` : null,
      sessionId: session,
      isSidechain: true,
      agentId: "a123456",
      timestamp: "2026-09-12T00:00:00.000Z",
      message: {
        role: index % 2 ? "user" : "assistant",
        content:
          index % 2
            ? [
                {
                  type: "tool_result",
                  tool_use_id: `tool-${index - 1}`,
                  content: "output".repeat(3000),
                },
              ]
            : [
                { type: "thinking", thinking: "private" },
                {
                  type: "tool_use",
                  id: `tool-${index}`,
                  name: "Read",
                  input: { file_path: "example.txt" },
                },
              ],
      },
    }));
    await writeFile(
      join(directory, "agent-a123456.jsonl"),
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    const read = async (agent: string, offset: number) => {
      const result = await exec(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          CLAUDE_SUBAGENT_READER,
          import.meta.resolve("@anthropic-ai/claude-agent-sdk"),
          session,
          agent,
          cwd,
          String(offset),
        ],
        { env: { ...process.env, CLAUDE_CONFIG_DIR: root }, maxBuffer: 4 * 1024 * 1024 },
      );
      return JSON.parse(result.stdout);
    };
    const first = await read("a123456", 0);
    expect(first.canSteer).toBe(false);
    expect(first.steps).toHaveLength(20);
    expect(first.nextOffset).toBe(20);
    expect(first.steps[0].text).not.toContain("private");
    const all = [...first.steps];
    let page = first;
    while (page.nextOffset !== undefined) {
      page = await read("a123456", page.nextOffset);
      all.push(...page.steps);
    }
    expect(
      all
        .filter((step: { id: string }) => step.id.startsWith("message-1:part:"))
        .map((step: { text: string }) => step.text)
        .join(""),
    ).toContain("output".repeat(3000));
    expect(all.at(-1).id).toContain("message-51:part:");
    expect(all.every((step: { text: string }) => step.text.length <= 8000)).toBe(true);
    await expect(read("other-conversation-agent", 0)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
