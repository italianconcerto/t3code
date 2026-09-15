import { expect, it } from "vite-plus/test";
import { previewClipboardCommand } from "./PreviewClipboard.ts";

it.each(["darwin", "linux", "win32"] as const)("routes clipboard chords on %s only", (platform) => {
  const input = {
    type: "keyDown",
    key: "v",
    meta: platform === "darwin",
    control: platform !== "darwin",
    alt: false,
    shift: false,
  } as Electron.Input;
  if (platform !== "darwin") {
    for (const key of ["c", "x", "v"]) {
      expect(previewClipboardCommand({ ...input, key }, platform)).toBeNull();
    }
    return;
  }
  expect(previewClipboardCommand(input, platform)).toBe("paste");
  expect(previewClipboardCommand({ ...input, key: "c" }, platform)).toBe("copy");
  expect(previewClipboardCommand({ ...input, key: "x" }, platform)).toBe("cut");
  expect(previewClipboardCommand({ ...input, type: "keyUp" }, platform)).toBeNull();
  expect(previewClipboardCommand({ ...input, key: "w" }, platform)).toBeNull();
  expect(previewClipboardCommand({ ...input, meta: false, control: false }, platform)).toBeNull();
  expect(previewClipboardCommand({ ...input, meta: true, control: true }, platform)).toBeNull();
  expect(
    previewClipboardCommand({ ...input, shift: true, alt: platform === "darwin" }, platform),
  ).toBe("pasteAndMatchStyle");
});
