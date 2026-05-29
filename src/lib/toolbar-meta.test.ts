import { describe, expect, it } from "vitest";
import { resolveToolbarMeta } from "@/lib/toolbar-meta";

describe("resolveToolbarMeta", () => {
  it("uses a descriptive settings subtitle by default", () => {
    expect(
      resolveToolbarMeta({
        activeRepoName: null,
        pathname: "/settings",
        providerDisplayNames: {},
        repoCount: 3,
        search: "",
        sessionRepoName: null,
        sessionTitle: null,
      }),
    ).toEqual({
      detail: "Providers, notifications, startup, and storage",
      title: "Settings",
    });
  });

  it("surfaces provider settings context when deep-linked", () => {
    expect(
      resolveToolbarMeta({
        activeRepoName: null,
        pathname: "/settings",
        providerDisplayNames: { codex: "Codex" },
        repoCount: 3,
        search: "?section=provider-codex",
        sessionRepoName: null,
        sessionTitle: null,
      }),
    ).toEqual({
      detail: "Codex provider settings",
      title: "Settings",
    });
  });

  it("uses workspace scope for a new session", () => {
    expect(
      resolveToolbarMeta({
        activeRepoName: "platform",
        pathname: "/session/new",
        providerDisplayNames: {},
        repoCount: 3,
        search: "",
        sessionRepoName: null,
        sessionTitle: null,
      }),
    ).toEqual({
      detail: "platform",
      title: "New Session",
    });
  });

  it("uses workspace context on dashboard when one is active", () => {
    expect(
      resolveToolbarMeta({
        activeRepoName: "platform",
        pathname: "/",
        providerDisplayNames: {},
        repoCount: 3,
        search: "",
        sessionRepoName: null,
        sessionTitle: null,
      }),
    ).toEqual({
      detail: "platform",
      title: "Dashboard",
    });
  });

  it("falls back to cross-workspace context on dashboard", () => {
    expect(
      resolveToolbarMeta({
        activeRepoName: null,
        pathname: "/",
        providerDisplayNames: {},
        repoCount: 3,
        search: "",
        sessionRepoName: null,
        sessionTitle: null,
      }),
    ).toEqual({
      detail: "Across all workspaces",
      title: "Dashboard",
    });
  });
});
