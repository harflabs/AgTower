export interface FocusTargetLike {
  tagName?: string | null;
  isConnected?: boolean;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
  classList?: {
    contains: (token: string) => boolean;
  };
}

interface TextEntryOptions {
  includeTerminalHelpers?: boolean;
}

function isTerminalHelperElement(target: FocusTargetLike): boolean {
  if (target.classList?.contains("xterm-helper-textarea")) return true;
  return !!target.closest?.(".xterm-helper-textarea");
}

export function isTextEntryElement(
  target: FocusTargetLike | null,
  options: TextEntryOptions = {},
): boolean {
  if (!target) return false;

  if (options.includeTerminalHelpers === false && isTerminalHelperElement(target)) {
    return false;
  }

  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (target.isContentEditable) return true;
  if (target.closest?.('[data-slot="command-input"]')) return true;
  return false;
}
