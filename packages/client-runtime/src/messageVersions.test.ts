import { expect, it } from "vite-plus/test";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { collapseMessageVersions, messageVersionChoices } from "./messageVersions";
const env = EnvironmentId.make("local");
const root = { id: ThreadId.make("root"), title: "Chat", createdAt: "1", environmentId: env };
const first = {
  ...root,
  id: ThreadId.make("first"),
  createdAt: "2",
  messageVersion: {
    rootThreadId: root.id,
    sourceThreadId: root.id,
    sourceMessageId: MessageId.make("original"),
    messageId: MessageId.make("edited"),
    messageIndex: 20,
  },
};
const later = {
  ...first,
  id: ThreadId.make("later"),
  createdAt: "3",
  messageVersion: {
    ...first.messageVersion,
    sourceThreadId: first.id,
    sourceMessageId: MessageId.make("later-original"),
    messageId: MessageId.make("later-edited"),
    messageIndex: 30,
  },
};
const threads = [root, first, later];

it("finds versions on paginated original and edited transcripts", () => {
  expect(
    messageVersionChoices(threads, root, [{ id: MessageId.make("original") }]).get(
      MessageId.make("original"),
    ),
  ).toEqual([
    { threadId: root.id, selected: true },
    { threadId: first.id, selected: false },
  ]);
  expect(
    messageVersionChoices(threads, first, [{ id: MessageId.make("edited") }]).get(
      MessageId.make("edited"),
    ),
  ).toEqual([
    { threadId: root.id, selected: false },
    { threadId: first.id, selected: true },
  ]);
});
it("preserves nested version ancestry and isolates divergent suffixes", () => {
  const copied = MessageId.make("later:fork:000000000020");
  expect(
    messageVersionChoices(threads, later, [{ id: copied }])
      .get(copied)
      ?.find((choice) => choice.selected)?.threadId,
  ).toBe(first.id);
  expect(
    messageVersionChoices(threads, root, [{ id: MessageId.make("unrelated-root-suffix") }]).size,
  ).toBe(0);
});
it("shows one conversation row, honoring current version and environment", () => {
  const remote = { ...root, environmentId: EnvironmentId.make("remote") };
  expect(collapseMessageVersions([...threads, remote])).toEqual([later, remote]);
  expect(collapseMessageVersions(threads, { environmentId: env, threadId: root.id })).toEqual([
    root,
  ]);
});
