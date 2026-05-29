import { describe, expect, it } from "vitest";
import {
  type AppCommandExecutionContext,
  resolveAppCommandEffect,
  shouldHandleAppCommandInRenderer,
} from "@/lib/app-commands";

function makeContext(overrides: Partial<AppCommandExecutionContext>): AppCommandExecutionContext {
  return {
    pathname: overrides.pathname ?? "/",
    sessionId: overrides.sessionId ?? null,
    windowLabel: overrides.windowLabel ?? "main",
  };
}

describe("resolveAppCommandEffect", () => {
  it("routes session close to close the session view when on a session route", () => {
    expect(
      resolveAppCommandEffect(
        "session.close-context",
        makeContext({
          pathname: "/session/123",
          sessionId: "123",
        }),
      ),
    ).toEqual({ kind: "close-session-view" });
  });

  it("routes dashboard/settings close to the main window close behavior", () => {
    expect(
      resolveAppCommandEffect(
        "session.close-context",
        makeContext({
          pathname: "/settings",
        }),
      ),
    ).toEqual({ kind: "hide-main-window" });
  });

  it("routes sidebar toggling to the main window", () => {
    expect(
      resolveAppCommandEffect(
        "view.toggle-sidebar",
        makeContext({
          pathname: "/session/123",
          sessionId: "123",
        }),
      ),
    ).toEqual({ kind: "toggle-sidebar" });
  });
});

describe("shouldHandleAppCommandInRenderer", () => {
  it("skips native-menu-managed commands in the renderer when the native menu is active", () => {
    expect(shouldHandleAppCommandInRenderer("app.command-palette", true)).toBe(false);
    expect(shouldHandleAppCommandInRenderer("app.preferences", true)).toBe(false);
    expect(shouldHandleAppCommandInRenderer("view.search", true)).toBe(false);
  });

  it("still lets the renderer handle those commands when the native menu is unavailable", () => {
    expect(shouldHandleAppCommandInRenderer("app.command-palette", false)).toBe(true);
    expect(shouldHandleAppCommandInRenderer("view.search", false)).toBe(true);
  });
});
