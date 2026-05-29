import { beforeEach, describe, expect, it } from "vitest";
import { clearClientSessionState, resetClientAppState } from "@/lib/app-reset";
import {
  AGTOWER_RECENT_COMMANDS_KEY as RECENTS_KEY,
  AGTOWER_VIEWED_SESSIONS_KEY as VIEWED_SESSIONS_KEY,
} from "@/lib/storage-keys";
import { TERMINAL_FONT_SIZE_DEFAULT, useSettingsStore } from "@/stores/settings-store";

describe("app reset helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("clears viewed session history when clearing session state", () => {
    localStorage.setItem(VIEWED_SESSIONS_KEY, JSON.stringify(["session-1"]));

    clearClientSessionState();

    expect(localStorage.getItem(VIEWED_SESSIONS_KEY)).toBeNull();
  });

  it("resets local release-facing settings and palette history", () => {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(["command:new-session"]));
    localStorage.setItem(VIEWED_SESSIONS_KEY, JSON.stringify(["session-1"]));
    useSettingsStore.setState({
      terminalFontSize: 22,
      theme: "dark",
    });

    resetClientAppState();

    expect(useSettingsStore.getState().terminalFontSize).toBe(TERMINAL_FONT_SIZE_DEFAULT);
    expect(useSettingsStore.getState().theme).toBe("system");
    expect(localStorage.getItem(RECENTS_KEY)).toBeNull();
    expect(localStorage.getItem(VIEWED_SESSIONS_KEY)).toBeNull();
  });
});
