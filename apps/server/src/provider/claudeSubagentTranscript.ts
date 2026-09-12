import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { ProviderSubagentResult } from "@t3tools/contracts";
const decodeTranscript = Schema.decodeUnknownEffect(Schema.fromJsonString(ProviderSubagentResult));
export const CLAUDE_SUBAGENT_READER = new URL(
  import.meta.url.endsWith(".ts") ? "../claude-subagent-reader.ts" : "./claude-subagent-reader.mjs",
  import.meta.url,
).href;

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
          "await import(process.argv[1])",
          CLAUDE_SUBAGENT_READER,
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
