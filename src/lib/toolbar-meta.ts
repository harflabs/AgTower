interface ToolbarMeta {
  title: string;
  detail?: string;
}

interface ToolbarMetaInput {
  pathname: string;
  search: string;
  activeRepoName: string | null;
  repoCount: number;
  sessionTitle: string | null;
  sessionRepoName: string | null;
  providerDisplayNames: Record<string, string>;
}

const SETTINGS_SECTION_DETAILS: Record<string, string> = {
  about: "Version details and app information",
  general: "Startup behavior, appearance, and archive defaults",
  notifications: "Desktop, in-app, and sound notifications",
  "danger-zone": "Storage, reset, and recovery tools",
};

export function resolveSettingsDetail(
  search: string,
  providerDisplayNames: Record<string, string>,
) {
  const sectionId = new URLSearchParams(search).get("section");
  if (!sectionId) {
    return "Providers, notifications, startup, and storage";
  }

  if (sectionId.startsWith("provider-")) {
    const providerId = sectionId.slice("provider-".length);
    const providerName = providerDisplayNames[providerId];
    return providerName ? `${providerName} provider settings` : "Provider-specific settings";
  }

  return SETTINGS_SECTION_DETAILS[sectionId] ?? "Providers, notifications, startup, and storage";
}

export function resolveToolbarMeta(input: ToolbarMetaInput): ToolbarMeta {
  if (input.pathname === "/settings") {
    return {
      detail: resolveSettingsDetail(input.search, input.providerDisplayNames),
      title: "Settings",
    };
  }

  if (input.pathname === "/session/new") {
    return {
      detail: input.activeRepoName ?? "Select a workspace to begin",
      title: "New Session",
    };
  }

  if (input.sessionTitle) {
    return {
      detail: input.sessionRepoName ?? undefined,
      title: input.sessionTitle,
    };
  }

  if (input.activeRepoName) {
    return {
      detail: input.activeRepoName,
      title: "Dashboard",
    };
  }

  return {
    detail: input.repoCount === 0 ? "Add your first workspace" : "Across all workspaces",
    title: "Dashboard",
  };
}
