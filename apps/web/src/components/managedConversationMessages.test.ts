import { expect, it } from "vite-plus/test";
import { MessageId, ThreadId, type OrchestrationMessage } from "@t3tools/contracts";
import { BTW_INSTRUCTIONS } from "@t3tools/client-runtime/operations";
import { managedConversationMessages } from "./managedConversationMessages";

const message = (
  id: string,
  text: string,
  role: "user" | "assistant" = "user",
): OrchestrationMessage => ({
  id: MessageId.make(id),
  text,
  role,
  turnId: null,
  streaming: false,
  createdAt: "2026-09-14T12:00:00.000Z",
  updatedAt: "2026-09-14T12:00:00.000Z",
});

it("keeps full side messages while hiding only copied context and initial setup", () => {
  const messages = [
    message("side:fork:000000", "Main context"),
    message("question", `${BTW_INSTRUCTIONS}\n\nExplain this`),
    message("reply", "Long answer ".repeat(3000), "assistant"),
    message("follow-up", `${BTW_INSTRUCTIONS}\n\nQuoted instructions`),
  ];
  const result = managedConversationMessages({ id: ThreadId.make("side"), messages }, true);
  expect(result.map((m) => m.text)).toEqual(["Explain this", messages[2]!.text, messages[3]!.text]);
  expect(messages[1]!.text).toContain(BTW_INSTRUCTIONS);
});

it("keeps ordinary subagent messages and paginated side replies unchanged", () => {
  const messages = [message("reply", "Full reply", "assistant")];
  expect(managedConversationMessages({ id: ThreadId.make("side"), messages }, false)).toBe(
    messages,
  );
  expect(managedConversationMessages({ id: ThreadId.make("side"), messages }, true)).toEqual(
    messages,
  );
});

it("hides the generated BTW envelope when opened through the agents list", () => {
  const messages = [
    message("side:fork:000000", "Main context"),
    message("question", `${BTW_INSTRUCTIONS}\n\nche mi dici di openrouter?`),
    message("reply", "A normal answer", "assistant"),
  ];
  expect(
    managedConversationMessages({ id: ThreadId.make("side"), messages }, false).map((m) => m.text),
  ).toEqual(["che mi dici di openrouter?", "A normal answer"]);
  expect(messages[1]!.text).toBe(`${BTW_INSTRUCTIONS}\n\nche mi dici di openrouter?`);
});
