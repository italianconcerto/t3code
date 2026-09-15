import type { EnvironmentThread } from "@t3tools/client-runtime/state/shell";
import { BTW_INSTRUCTIONS } from "@t3tools/client-runtime/operations";

/** Hide the copied context and setup envelope, never the side conversation itself. */
export function managedConversationMessages(
  detail: Pick<EnvironmentThread, "id" | "messages">,
  sideDiscussion: boolean,
) {
  const ownMessages = detail.messages.filter(
    (message) => !message.id.startsWith(`${detail.id}:fork:`),
  );
  // The Agents list can open a BTW without the dedicated BTW panel's flag.
  // Recognize only the exact generated envelope, never arbitrary user prose.
  const first = ownMessages[0];
  const hasEnvelope = first?.role === "user" && first.text.startsWith(`${BTW_INSTRUCTIONS}\n\n`);
  if (!sideDiscussion && !hasEnvelope) return detail.messages;
  const messages = ownMessages;
  return messages.map((message, index) =>
    index === 0 && message.role === "user" && message.text.startsWith(`${BTW_INSTRUCTIONS}\n\n`)
      ? { ...message, text: message.text.slice(BTW_INSTRUCTIONS.length + 2) }
      : message,
  );
}
