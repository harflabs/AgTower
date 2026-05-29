import { isTextEntryElement } from "@/lib/keyboard/focus-target";

/** Returns true if the active element is an input field where single-key shortcuts should be suppressed */
export function isInputFocused(): boolean {
  return isTextEntryElement(document.activeElement, { includeTerminalHelpers: true });
}

/** Returns true if focus is inside a terminal container (xterm.js) */
export function isTerminalFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  // xterm.js uses a hidden textarea with class 'xterm-helper-textarea' inside .terminal-container
  return el.closest(".terminal-container") !== null;
}
