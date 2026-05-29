import { describe, expect, it } from "vitest";
// Importing the provider modules registers them in the global registry, which
// buildLaunchOptionData / pickLaunchOptionOverrides read declared options from.
import "@/providers/claude-code";
import "@/providers/codex";
import { buildLaunchOptionData, pickLaunchOptionOverrides } from "@/providers/launch-options";
import { getAllProviders } from "@/providers/registry";

describe("buildLaunchOptionData", () => {
  it("uses the saved settings default when no override is given", () => {
    const result = buildLaunchOptionData("claude-code", { permissionMode: "auto", effort: "high" });
    expect(result).toEqual({ permissionMode: "auto", effort: "high" });
  });

  it("lets an override beat the saved default", () => {
    const result = buildLaunchOptionData(
      "claude-code",
      { permissionMode: "auto" },
      { permissionMode: "plan" },
    );
    expect(result.permissionMode).toBe("plan");
  });

  it("omits a key when both override and default are empty strings", () => {
    const result = buildLaunchOptionData(
      "claude-code",
      { permissionMode: "" },
      { permissionMode: "" },
    );
    expect(result).not.toHaveProperty("permissionMode");
  });

  it("omits a key when there is no setting at all", () => {
    const result = buildLaunchOptionData("claude-code", {});
    expect(result).toEqual({});
  });

  it("ignores keys the provider did not declare", () => {
    const result = buildLaunchOptionData(
      "claude-code",
      { permissionMode: "auto" },
      { permissionMode: "plan", notADeclaredKey: "x" },
    );
    expect(result).toEqual({ permissionMode: "plan" });
  });

  it("trims whitespace-only values to omission", () => {
    const result = buildLaunchOptionData("codex", { askForApproval: "   " });
    expect(result).not.toHaveProperty("askForApproval");
  });

  it("resolves codex's own keys", () => {
    const result = buildLaunchOptionData("codex", {
      askForApproval: "on-request",
      sandbox: "workspace-write",
    });
    expect(result).toEqual({ askForApproval: "on-request", sandbox: "workspace-write" });
  });

  it("returns empty for an unknown provider", () => {
    expect(buildLaunchOptionData("nonexistent", { permissionMode: "auto" })).toEqual({});
  });
});

describe("pickLaunchOptionOverrides", () => {
  it("round-trips only declared keys from providerData", () => {
    const result = pickLaunchOptionOverrides("claude-code", {
      sessionId: "should-be-ignored",
      permissionMode: "plan",
      effort: "high",
      bogus: "nope",
    });
    expect(result).toEqual({ permissionMode: "plan", effort: "high" });
  });

  it("skips empty / non-string declared values", () => {
    const result = pickLaunchOptionOverrides("codex", {
      askForApproval: "",
      sandbox: 42 as unknown as string,
    });
    expect(result).toEqual({});
  });

  it("handles undefined providerData", () => {
    expect(pickLaunchOptionOverrides("claude-code", undefined)).toEqual({});
  });
});

// Validates the declarations themselves (the Settings + dialog UI is generated
// from these). Iterates every registered provider, so new providers/options are
// held to the same contract automatically.
describe("launch option declarations are well-formed", () => {
  const providersWithOptions = getAllProviders().filter((p) => (p.launchOptions ?? []).length > 0);

  it("at least one provider declares launch options", () => {
    expect(providersWithOptions.length).toBeGreaterThan(0);
  });

  for (const provider of providersWithOptions) {
    const options = provider.launchOptions ?? [];

    it(`${provider.id}: option keys are unique`, () => {
      const keys = options.map((o) => o.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    for (const opt of options) {
      describe(`${provider.id} / ${opt.key}`, () => {
        it("has a non-empty label", () => {
          expect(opt.label.trim().length).toBeGreaterThan(0);
        });

        it("leads with a blank provider-default choice", () => {
          expect(opt.choices[0]?.value).toBe("");
          expect((opt.choices[0]?.label ?? "").trim().length).toBeGreaterThan(0);
        });

        it("declares at least one concrete, uniquely-valued choice", () => {
          const concrete = opt.choices.slice(1).map((c) => c.value);
          expect(concrete.length).toBeGreaterThan(0);
          expect(concrete.every((v) => v.trim().length > 0)).toBe(true);
          expect(new Set(concrete).size).toBe(concrete.length);
        });

        it("labels every choice", () => {
          expect(opt.choices.every((c) => c.label.trim().length > 0)).toBe(true);
        });
      });
    }
  }
});
