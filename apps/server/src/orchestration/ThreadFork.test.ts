import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationThread,
  type ThreadTurnStartBootstrap,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { ServerConfig } from "../config.ts";
import {
  createAttachmentId,
  resolveAttachmentPath,
  resolveAttachmentPathById,
} from "../attachmentStore.ts";
import { copyThreadFork, selectThreadFork } from "./ThreadFork.ts";

const createdAt = "2026-09-11T10:00:00.000Z";
const source: OrchestrationThread = {
  id: ThreadId.make("source"),
  projectId: ProjectId.make("project"),
  title: "Original",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "main",
  worktreePath: null,
  latestTurn: null,
  createdAt,
  updatedAt: createdAt,
  archivedAt: null,
  deletedAt: null,
  settledOverride: null,
  settledAt: null,
  activities: [],
  checkpoints: [],
  proposedPlans: [],
  session: null,
  messages: (["user", "assistant", "user", "assistant"] as const).map((role, index) => ({
    id: MessageId.make(`message-${index}`),
    role,
    text: `text-${index}`,
    turnId: null,
    streaming: false,
    createdAt,
    updatedAt: createdAt,
  })),
};
const bootstrap: ThreadTurnStartBootstrap = {
  createThread: {
    forkFrom: { threadId: source.id, messageId: MessageId.make("message-2") },
    projectId: source.projectId,
    title: "Edited",
    modelSelection: source.modelSelection,
    runtimeMode: source.runtimeMode,
    interactionMode: source.interactionMode,
    branch: source.branch,
    worktreePath: null,
    createdAt,
  },
};

describe("selectThreadFork", () => {
  it("cuts immediately before the selected user message, even with identical timestamps", () => {
    const before = structuredClone(source);
    const fork = selectThreadFork(source, bootstrap);
    expect(fork.history.map((message) => message.text)).toEqual(["text-0", "text-1"]);
    expect(fork.target.text).toBe("text-2");
    expect(source).toEqual(before);
  });
  it.each(["message-1", "missing"])("rejects non-user or missing target %s", (id) => {
    expect(() =>
      selectThreadFork(source, {
        createThread: {
          ...bootstrap.createThread!,
          forkFrom: { threadId: source.id, messageId: MessageId.make(id) },
        },
      }),
    ).toThrow();
  });
  it("supports editing the first message without inventing history", () => {
    expect(
      selectThreadFork(source, {
        createThread: {
          ...bootstrap.createThread!,
          forkFrom: { threadId: source.id, messageId: MessageId.make("message-0") },
        },
      }).history,
    ).toEqual([]);
  });
  it.each([
    { ...bootstrap, runSetupScript: true },
    { createThread: { ...bootstrap.createThread!, projectId: ProjectId.make("other") } },
    { createThread: { ...bootstrap.createThread!, worktreePath: "/other" } },
    { createThread: { ...bootstrap.createThread!, branch: "stale" } },
  ])("rejects workspace mutation or stale/cross-project metadata", (input) => {
    expect(() => selectThreadFork(source, input)).toThrow();
  });
  it("rejects deleted source", () => {
    expect(() => selectThreadFork({ ...source, deletedAt: createdAt }, bootstrap)).toThrow();
  });
});

const testLayer = ServerConfig.layerTest(process.cwd(), { prefix: "t3-message-fork-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);
it.layer(testLayer)("copyThreadFork", (it) => {
  it.effect(
    "copies history and target attachments independently, preserving MIME-derived image paths",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { attachmentsDir } = yield* ServerConfig;
        const attachment = {
          type: "image" as const,
          id: createAttachmentId("source")!,
          name: "photo.jpeg",
          mimeType: "image/jpeg",
          sizeBytes: 3,
        };
        const originalPath = resolveAttachmentPath({ attachmentsDir, attachment })!;
        yield* fs.writeFileString(originalPath, "abc");
        const fork = selectThreadFork(source, bootstrap);
        const copied = yield* copyThreadFork(
          {
            history: [{ ...fork.history[0]!, attachments: [attachment] }, fork.history[1]!],
            target: { ...fork.target, attachments: [attachment] },
          },
          ThreadId.make("new-thread"),
        );
        expect(copied.history[0]?.messageId).not.toBe(source.messages[0]?.id);
        expect(
          copied.history
            .toSorted(
              (a, b) =>
                a.createdAt.localeCompare(b.createdAt) || a.messageId.localeCompare(b.messageId),
            )
            .map((message) => message.text),
        ).toEqual(["text-0", "text-1"]);
        const ids = [copied.history[0]!.attachments[0]!.id, copied.attachments[0]!.id];
        expect(new Set(ids).size).toBe(2);
        yield* fs.remove(originalPath);
        for (const id of ids) {
          const path = resolveAttachmentPathById({ attachmentsDir, attachmentId: id });
          expect(path).not.toBeNull();
          expect(yield* fs.readFileString(path!)).toBe("abc");
        }
      }),
  );
  it.effect("cleans partial copies if a later attachment is missing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { attachmentsDir } = yield* ServerConfig;
      const attachment = {
        type: "file" as const,
        id: createAttachmentId("source", ".txt")!,
        name: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 3,
      };
      yield* fs.writeFileString(resolveAttachmentPath({ attachmentsDir, attachment })!, "abc");
      const before = yield* fs.readDirectory(attachmentsDir);
      const fork = selectThreadFork(source, bootstrap);
      const exit = yield* copyThreadFork(
        {
          history: [{ ...fork.history[0]!, attachments: [attachment] }],
          target: {
            ...fork.target,
            attachments: [{ ...attachment, id: createAttachmentId("missing", ".txt")! }],
          },
        },
        ThreadId.make("failed-fork"),
      ).pipe(Effect.exit);
      expect(exit._tag).toBe("Failure");
      expect((yield* fs.readDirectory(attachmentsDir)).toSorted()).toEqual(before.toSorted());
    }),
  );
});
