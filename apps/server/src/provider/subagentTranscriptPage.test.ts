import { expect, it } from "vite-plus/test";
import { subagentTranscriptPage } from "./subagentTranscriptPage.ts";

it("opens at the newest page and retains backward and forward cursors", () => {
  const items = Array.from({ length: 65 }, (_, i) => ({
    id: String(i),
    type: "assistant",
    text: `Message ${i}`,
  }));
  const tail = subagentTranscriptPage(items, 0, true);
  expect(tail.steps).toHaveLength(20);
  expect(tail.steps[0]!.text).toBe("Message 45");
  expect(tail.steps.at(-1)!.text).toBe("Message 64");
  expect(tail.offset).toBe(45);
  expect(tail.previousOffset).toBe(25);
  expect(tail.nextOffset).toBeUndefined();
  const earlier = subagentTranscriptPage(items, tail.previousOffset!);
  expect(earlier.steps[0]!.text).toBe("Message 25");
  expect(earlier.nextOffset).toBe(45);
});

it("retains bounded chunks and can follow output appended after the latest page", () => {
  const items = [{ id: "long", type: "assistant", text: "x".repeat(168000) }];
  const tail = subagentTranscriptPage(items, 0, true);
  expect(tail.offset).toBe(0);
  expect(tail.steps).toHaveLength(20);
  const more = subagentTranscriptPage(
    [...items, { id: "new", type: "assistant", text: "Finished" }],
    tail.offset,
  );
  expect(more.nextOffset).toBe(20);
  expect(
    subagentTranscriptPage(
      [...items, { id: "new", type: "assistant", text: "Finished" }],
      more.nextOffset!,
    ).steps.at(-1)!.text,
  ).toBe("Finished");
});
