import { normalizeForSearch, type PaletteItemKind, type PaletteQuery } from "./model";

const TYPE_ALIASES: Record<string, PaletteItemKind> = {
  command: "command",
  commands: "command",
  setting: "setting",
  settings: "setting",
  session: "session",
  sessions: "session",
  workspace: "workspace",
  workspaces: "workspace",
  repo: "workspace",
  provider: "provider",
  providers: "provider",
  danger: "danger",
};

function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const pattern = /[^\s"]+:"[^"]*"|"[^"]*"|[^\s]+/g;

  for (const match of query.matchAll(pattern)) {
    tokens.push(match[1] ?? match[0]);
  }

  return tokens;
}

export function parsePaletteQuery(raw: string): PaletteQuery {
  const tokens = tokenize(raw);
  const freeTextTokens: string[] = [];
  const types = new Set<PaletteItemKind>();
  const repos: string[] = [];
  const statuses: string[] = [];
  const providers: string[] = [];
  let pinned: boolean | null = null;

  for (const token of tokens) {
    const [key, ...rest] = token.split(":");
    if (rest.length === 0) {
      freeTextTokens.push(token);
      continue;
    }

    const value = normalizeForSearch(rest.join(":").replace(/^"(.*)"$/, "$1"));
    if (!value) continue;

    switch (normalizeForSearch(key)) {
      case "type": {
        const resolved = TYPE_ALIASES[value];
        if (resolved) {
          types.add(resolved);
        } else {
          freeTextTokens.push(token);
        }
        break;
      }
      case "repo":
      case "workspace":
        repos.push(value);
        break;
      case "status":
        statuses.push(value);
        break;
      case "provider":
        providers.push(value);
        break;
      case "pinned":
        if (["true", "yes", "1", "pinned"].includes(value)) pinned = true;
        else if (["false", "no", "0", "unpinned"].includes(value)) pinned = false;
        else freeTextTokens.push(token);
        break;
      default:
        freeTextTokens.push(token);
        break;
    }
  }

  const text = freeTextTokens.join(" ").trim();

  return {
    raw,
    text,
    normalizedText: normalizeForSearch(text),
    tokens,
    filters: {
      types: Array.from(types),
      repos,
      statuses,
      providers,
      pinned,
    },
  };
}
