import {
  MessageId,
  OrchestrationDispatchCommandError,
  type OrchestrationThread,
  type ThreadTurnStartBootstrap,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import {
  createAttachmentId,
  attachmentFileExtension,
  resolveAttachmentPath,
} from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";

/** The cutoff is a message identity, never a client-supplied transcript or timestamp. */
export function selectThreadFork(source: OrchestrationThread, bootstrap: ThreadTurnStartBootstrap) {
  const create = bootstrap.createThread;
  const index = source.messages.findIndex((message) => message.id === create?.forkFrom?.messageId);
  const target = source.messages[index];
  const side = create?.forkFrom?.mode === "side";
  if (
    !create ||
    source.id !== create.forkFrom?.threadId ||
    source.deletedAt !== null ||
    source.projectId !== create.projectId ||
    !target ||
    (!side && target.role !== "user") ||
    bootstrap.prepareWorktree ||
    bootstrap.runSetupScript ||
    create.branch !== source.branch ||
    create.worktreePath !== source.worktreePath
  ) {
    throw new Error("Cannot branch from this message. Reload the conversation and try again.");
  }
  return { history: source.messages.slice(0, index + (side ? 1 : 0)), target, side };
}

export const copyThreadFork = Effect.fn("copyThreadFork")(function* (
  fork: ReturnType<typeof selectThreadFork>,
  threadId: ThreadId,
) {
  const fs = yield* FileSystem.FileSystem;
  const { attachmentsDir } = yield* ServerConfig;
  const copied: string[] = [];
  const copyMessage = Effect.fn("copyThreadFork.message")(function* (
    message: OrchestrationThread["messages"][number],
    index: number,
  ) {
    const attachments = yield* Effect.forEach(message.attachments ?? [], (attachment) =>
      Effect.gen(function* () {
        const id = createAttachmentId(
          threadId,
          attachment.type === "image" ? undefined : attachmentFileExtension(attachment.name),
        );
        const clone = { ...attachment, id: id ?? "" };
        const from = resolveAttachmentPath({ attachmentsDir, attachment });
        const to = resolveAttachmentPath({ attachmentsDir, attachment: clone });
        if (!id || !from || !to) {
          return yield* new OrchestrationDispatchCommandError({
            message: "This attachment cannot be copied into a new conversation.",
          });
        }
        yield* fs.copyFile(from, to);
        copied.push(to);
        return clone;
      }),
    );
    // Projections break timestamp ties by message ID. Keep the source's order.
    return {
      messageId: MessageId.make(`${threadId}:fork:${String(index).padStart(12, "0")}`),
      role: message.role,
      text: message.text,
      attachments,
      createdAt: message.createdAt,
    };
  });
  return yield* Effect.gen(function* () {
    const history = yield* Effect.forEach(fork.history, copyMessage);
    if (fork.side) return { history, attachments: [] };
    const target = yield* copyMessage(fork.target, fork.history.length);
    return { history, attachments: target.attachments };
  }).pipe(
    Effect.onError(() => Effect.forEach(copied, (path) => fs.remove(path).pipe(Effect.ignore))),
  );
});
