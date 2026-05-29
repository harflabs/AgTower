import { describe, expect, it } from "vitest";

import { shouldAutoFocusTerminal } from "@/lib/terminal-focus";

describe("shouldAutoFocusTerminal", () => {
  it("auto-focuses when there is no active element", () => {
    expect(shouldAutoFocusTerminal(null)).toBe(true);
  });

  it("auto-focuses when the previously focused element is detached", () => {
    const button = { tagName: "BUTTON", isConnected: false };
    expect(shouldAutoFocusTerminal(button)).toBe(true);
  });

  it("preserves focus for standard text inputs", () => {
    expect(shouldAutoFocusTerminal({ tagName: "INPUT", isConnected: true })).toBe(false);
  });

  it("preserves focus for contenteditable elements", () => {
    expect(
      shouldAutoFocusTerminal({ tagName: "DIV", isConnected: true, isContentEditable: true }),
    ).toBe(false);
  });

  it("preserves focus for command palette inputs", () => {
    expect(
      shouldAutoFocusTerminal({
        tagName: "BUTTON",
        isConnected: true,
        closest: (selector) => (selector === '[data-slot="command-input"]' ? {} : null),
      }),
    ).toBe(false);
  });

  it("takes focus away from non-text controls", () => {
    expect(shouldAutoFocusTerminal({ tagName: "BUTTON", isConnected: true })).toBe(true);
  });

  it("takes focus away from xterm helper textareas", () => {
    expect(
      shouldAutoFocusTerminal({
        tagName: "TEXTAREA",
        isConnected: true,
        classList: {
          contains: (token) => token === "xterm-helper-textarea",
        },
      }),
    ).toBe(true);
  });
});
