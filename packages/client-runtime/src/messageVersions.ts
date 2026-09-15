import type {
  EnvironmentId,
  MessageId,
  OrchestrationThreadShell,
  ThreadId,
} from "@t3tools/contracts";

type VersionThread = Pick<
  OrchestrationThreadShell,
  "id" | "messageVersion" | "createdAt" | "title"
>;
export type MessageVersionChoice = { threadId: ThreadId; selected: boolean };

/** A copied prefix keeps the original message's version family; divergent suffixes do not. */
export function messageVersionChoices(
  threads: readonly VersionThread[],
  current: VersionThread,
  messages: readonly { id: MessageId }[],
) {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const origin = (thread: VersionThread, index: number) => {
    const seen = new Set<ThreadId>();
    while (
      thread.messageVersion &&
      index <= thread.messageVersion.messageIndex &&
      !seen.has(thread.id)
    ) {
      seen.add(thread.id);
      const source = byId.get(thread.messageVersion.sourceThreadId);
      if (!source) break;
      thread = source;
    }
    return thread.id;
  };
  const groups = new Map<MessageId, MessageVersionChoice[]>();
  for (const message of messages) {
    // The client may hold only the last page. Never use its array offset as a
    // server transcript index. Imported prefix IDs carry their original index.
    const prefix = `${current.id}:fork:`;
    const copiedIndex = message.id.startsWith(prefix)
      ? Number(message.id.slice(prefix.length))
      : undefined;
    const index =
      current.messageVersion?.messageId === message.id
        ? current.messageVersion.messageIndex
        : copiedIndex !== undefined && Number.isSafeInteger(copiedIndex) && copiedIndex >= 0
          ? copiedIndex
          : threads.find(
              (thread) =>
                thread.messageVersion?.sourceThreadId === current.id &&
                thread.messageVersion.sourceMessageId === message.id,
            )?.messageVersion?.messageIndex;
    if (index === undefined) continue;
    const base = origin(current, index);
    const alternatives = threads
      .filter(
        (thread) => thread.messageVersion?.messageIndex === index && origin(thread, index) === base,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    if (!alternatives.length) continue;
    let selected = current;
    const seen = new Set<ThreadId>();
    while (
      selected.messageVersion &&
      selected.messageVersion.messageIndex > index &&
      !seen.has(selected.id)
    ) {
      seen.add(selected.id);
      const source = byId.get(selected.messageVersion.sourceThreadId);
      if (!source) break;
      selected = source;
    }
    groups.set(
      message.id,
      [base, ...alternatives.map((thread) => thread.id)].map((threadId) => ({
        threadId,
        selected: threadId === selected.id,
      })),
    );
  }
  return groups;
}

/** One sidebar row per conversation; version sessions remain available on demand. */
export function collapseMessageVersions<T extends VersionThread & { environmentId: EnvironmentId }>(
  threads: readonly T[],
  current?: { environmentId: EnvironmentId; threadId: ThreadId } | null,
): T[] {
  const groups = new Map<string, T[]>();
  for (const thread of threads) {
    const key = `${thread.environmentId}:${thread.messageVersion?.rootThreadId ?? thread.id}`;
    const group = groups.get(key) ?? [];
    group.push(thread);
    groups.set(key, group);
  }
  return [...groups.values()].map(
    (group) =>
      group.find(
        (thread) =>
          thread.environmentId === current?.environmentId && thread.id === current.threadId,
      ) ??
      group.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0]!,
  );
}
