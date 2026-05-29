import { type FocusTargetLike, isTextEntryElement } from "@/lib/keyboard/focus-target";

export function shouldAutoFocusTerminal(activeElement: FocusTargetLike | null): boolean {
  if (!activeElement) return true;
  if (activeElement.isConnected === false) return true;
  return !isTextEntryElement(activeElement, { includeTerminalHelpers: false });
}
