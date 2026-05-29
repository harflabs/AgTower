type SelectAllAction =
  | { kind: "native" }
  | { kind: "custom"; target: HTMLElement }
  | { kind: "block" };

interface SelectAllTargetLike {
  closest?: (selector: string) => unknown;
}

const NATIVE_SELECT_ALL_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable='']",
  "[contenteditable='true']",
  "[contenteditable='plaintext-only']",
  "[role='textbox']",
  "[data-allow-native-context-menu]",
  "[data-allow-native-select-all]",
].join(", ");

const CUSTOM_SELECT_ALL_SCOPE_SELECTOR = ["[data-select-all-scope]", "[data-selectable]"].join(
  ", ",
);

const BLOCKED_CUSTOM_SELECT_ALL_SELECTOR = [
  "button",
  "a[href]",
  "[role='button']",
  "[role='menuitem']",
  "[role='option']",
  "[data-selection='chrome']",
].join(", ");

function isSelectAllTargetLike(target: unknown): target is SelectAllTargetLike {
  return !!target && typeof (target as SelectAllTargetLike).closest === "function";
}

function isExplicitlyBlockedTarget(target: unknown): boolean {
  return isSelectAllTargetLike(target) && !!target.closest?.(BLOCKED_CUSTOM_SELECT_ALL_SELECTOR);
}

function findVisibleSelectAllScope(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  const scopes = document.querySelectorAll<HTMLElement>("[data-select-all-scope]");
  for (const scope of scopes) {
    if (scope.getClientRects().length > 0) {
      return scope;
    }
  }

  return null;
}

function resolveSelectAllActionForTarget(target: unknown): SelectAllAction {
  if (!isSelectAllTargetLike(target)) {
    return { kind: "block" };
  }

  if (target.closest?.(NATIVE_SELECT_ALL_SELECTOR)) {
    return { kind: "native" };
  }

  if (target.closest?.(BLOCKED_CUSTOM_SELECT_ALL_SELECTOR)) {
    return { kind: "block" };
  }

  const scope = target.closest?.(CUSTOM_SELECT_ALL_SCOPE_SELECTOR);
  const contentTarget = scope ? (scope as HTMLElement) : null;

  if (contentTarget) {
    return { kind: "custom", target: contentTarget };
  }

  return { kind: "block" };
}

export function resolveSelectAllAction(...targets: unknown[]): SelectAllAction {
  let sawExplicitBlock = false;

  for (const target of targets) {
    const action = resolveSelectAllActionForTarget(target);
    if (action.kind !== "block") {
      return action;
    }

    if (isExplicitlyBlockedTarget(target)) {
      sawExplicitBlock = true;
    }
  }

  if (!sawExplicitBlock) {
    const scope = findVisibleSelectAllScope();
    if (scope) {
      return { kind: "custom", target: scope };
    }
  }

  return { kind: "block" };
}

export function selectElementContents(target: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection) {
    return false;
  }

  const range = document.createRange();
  range.selectNodeContents(target);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}
