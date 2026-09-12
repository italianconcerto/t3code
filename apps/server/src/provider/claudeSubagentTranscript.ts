import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { ProviderSubagentResult } from "@t3tools/contracts";
import { subagentTranscriptPage } from "./subagentTranscriptPage.ts";
const decodeTranscript = Schema.decodeUnknownEffect(Schema.fromJsonString(ProviderSubagentResult));

// SDK transcript APIs resolve CLAUDE_CONFIG_DIR at module load. Isolate each
// subscription's reader instead of changing the shared server environment.
export const CLAUDE_SUBAGENT_READER = `
const { listSubagents, getSubagentMessages } = await import(process.argv[1]);
const [sessionId, agentId, dir, rawOffset] = process.argv.slice(2);
const options = { dir };
if (!(await listSubagents(sessionId, options)).includes(agentId)) {
  throw new Error("No retained subagent transcript in this conversation.");
}
const offset = Number(rawOffset);
const messages = await getSubagentMessages(sessionId, agentId, options);
const steps = messages.map(entry => {
  const message = entry.message;
  const visible = message && typeof message === "object" && Array.isArray(message.content)
    ? { ...message, content: message.content.filter(block => block.type !== "thinking" && block.type !== "redacted_thinking") }
    : message;
  return { id: entry.uuid, type: entry.type, text: JSON.stringify(visible) };
});
const page = (${subagentTranscriptPage.toString()})(steps, offset);
console.log(JSON.stringify({ canSteer: false, ...page,
  notice: "Conversation is readable. This provider does not support direct steering." }));
`;

export const readClaudeSubagentTranscript = Effect.fn("readClaudeSubagentTranscript")(
  function* (input: {
    sessionId: string;
    agentId: string;
    cwd: string;
    offset: number;
    environment: Record<string, string | undefined>;
  }) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const output = yield* spawner.string(
      ChildProcess.make(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          CLAUDE_SUBAGENT_READER,
          import.meta.resolve("@anthropic-ai/claude-agent-sdk"),
          input.sessionId,
          input.agentId,
          input.cwd,
          String(input.offset),
        ],
        { env: input.environment, extendEnv: true },
      ),
    );
    return yield* decodeTranscript(output);
  },
  Effect.timeout("10 seconds"),
);
