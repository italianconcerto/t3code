import type { EnvironmentThread } from "@t3tools/client-runtime/state/shell";
import { BTW_INSTRUCTIONS } from "@t3tools/client-runtime/operations";

/** Hide the copied context and setup envelope, never the side conversation itself. */
export function managedConversationMessages(
  detail: Pick<EnvironmentThread, "id" | "messages">,
  sideDiscussion: boolean,
) {
  if (!sideDiscussion) return detail.messages;
  const messages = detail.messages.filter(
    (message) => !message.id.startsWith(`${detail.id}:fork:`),
  );
  return messages.map((message, index) =>
    index === 0 && message.role === "user" && message.text.startsWith(`${BTW_INSTRUCTIONS}\n\n`)
      ? { ...message, text: message.text.slice(BTW_INSTRUCTIONS.length + 2) }
      : message,
  );
}
