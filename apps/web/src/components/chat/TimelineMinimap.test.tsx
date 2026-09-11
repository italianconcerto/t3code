import { act, cloneElement, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";
import { TimelineMinimap } from "./MessagesTimeline";

vi.mock("../DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children?: ReactNode }) => children,
}));

// Portal positioning is browser-tested; the renderer exercises minimap state.
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => children,
  TooltipTrigger: ({
    children,
    render,
    ...props
  }: {
    children?: ReactNode;
    render?: ReactElement;
  }) => (render ? cloneElement(render, props, children) : <span {...props}>{children}</span>),
  TooltipPopup: () => null,
}));

it("dismisses the minimap preview when leaving the rail and preserves keyboard navigation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  let renderer: ReactTestRenderer | undefined;
  try {
    const entries = ["First turn", "Second turn"].map((userText, rowIndex) => ({
      id: `entry-${rowIndex}`,
      rowIndex,
      userText,
      assistantText: null,
    }));
    await act(() => {
      renderer = create(
        <TimelineMinimap
          items={entries}
          currentIndex={0}
          hasPersistentGutter
          hitStripWidth={40}
          stripMap={new Map()}
          onSelect={() => {}}
        />,
      );
    });
    const rail = () =>
      renderer!.root.find(
        (node) =>
          node.type === "button" && String(node.props["aria-label"]).startsWith("Jump to message:"),
      );
    const previews = () => renderer!.root.findAllByProps({ "data-minimap-preview": true });
    expect(previews()).toHaveLength(0);
    await act(() =>
      rail().props.onMouseMove({
        currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 100 }) },
        clientY: 100,
      }),
    );
    expect(previews()).toHaveLength(1);
    expect(
      previews()[0]!.findAll(
        (node) => node.type === "span" && node.children.includes("Second turn"),
      ),
    ).toHaveLength(1);
    await act(() => rail().props.onMouseLeave());
    expect(previews()).toHaveLength(0);
    await act(() => rail().props.onFocus());
    expect(previews()).toHaveLength(1);
    await act(() => rail().props.onKeyDown({ key: "End", preventDefault() {} }));
    expect(
      previews()[0]!.findAll(
        (node) => node.type === "span" && node.children.includes("Second turn"),
      ),
    ).toHaveLength(1);
    await act(() => rail().props.onBlur());
    expect(previews()).toHaveLength(0);
  } finally {
    await act(() => renderer?.unmount());
  }
});
