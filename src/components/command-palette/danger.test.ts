import { describe, expect, it } from "vitest";
import { armDangerAction, disarmDangerAction, isDangerActionConfirmed } from "./danger";

describe("danger helpers", () => {
  it("arms and disarms destructive actions", () => {
    const armed = armDangerAction(disarmDangerAction(), "danger:reset-everything");

    expect(isDangerActionConfirmed(armed, "danger:reset-everything")).toBe(true);
    expect(isDangerActionConfirmed(armed, "danger:clear-session-cache")).toBe(false);
    expect(disarmDangerAction().armedId).toBeNull();
  });
});
