import { listSubagents, getSubagentMessages } from "@anthropic-ai/claude-agent-sdk";
import { subagentTranscriptPage } from "./provider/subagentTranscriptPage.ts";

// Dedicated process: SDK transcript discovery reads subscription environment
// at module load. This entry is bundled separately for installed clients.
const [sessionId, agentId, dir, rawOffset] = process.argv.slice(2);
if (!sessionId || !agentId || !dir) throw new Error("Missing transcript identity.");
const offset = Number(rawOffset);
if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid transcript offset.");
const options = { dir };
if (!(await listSubagents(sessionId, options)).includes(agentId)) {
  throw new Error("No retained subagent transcript in this conversation.");
}
const messages = await getSubagentMessages(sessionId, agentId, options);
const steps = messages.map((entry) => {
  const message = entry.message;
  const visible =
    message && typeof message === "object" && "content" in message && Array.isArray(message.content)
      ? {
          ...message,
          content: message.content.filter(
            (block) => block.type !== "thinking" && block.type !== "redacted_thinking",
          ),
        }
      : message;
  return { id: entry.uuid, type: entry.type, text: JSON.stringify(visible) ?? "" };
});
process.stdout.write(
  JSON.stringify({
    canSteer: false,
    ...subagentTranscriptPage(steps, offset),
    notice: "Conversation is readable. This provider does not support direct steering.",
  }) + "\n",
);
