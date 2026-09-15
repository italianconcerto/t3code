/** Route editing to the guest itself, not the host window's native responder. */
export function previewClipboardCommand(input: Electron.Input, platform: NodeJS.Platform) {
  // Ctrl+C belongs to web terminals on Windows/Linux (SIGINT). Only bypass
  // macOS's unreliable guest-to-native-menu responder routing.
  if (input.type !== "keyDown" || platform !== "darwin") return null;
  const mac = platform === "darwin";
  if (mac ? !input.meta || input.control : !input.control || input.meta) return null;
  const key = input.key.toLowerCase();
  if (input.shift) {
    return (key === "v" || (mac && input.code === "KeyV")) && input.alt === mac
      ? ("pasteAndMatchStyle" as const)
      : null;
  }
  if (input.alt) return null;
  if (key === "c") return "copy" as const;
  if (key === "x") return "cut" as const;
  if (key === "v") return "paste" as const;
  return null;
}
