/** Shorten an absolute path for display: replace $HOME with ~ */
export function shortenPath(p: string): string {
  const match = p.match(/^\/Users\/[^/]+\/(.+)$/) ?? p.match(/^\/home\/[^/]+\/(.+)$/);
  return match ? `~/${match[1]}` : p;
}

/**
 * Compact "where does this folder live?" hint for the sidebar workspace
 * header: the repo's parent directory, home-abbreviated, capped at its last
 * segments so it stays readable at sidebar widths. Disambiguates same-named
 * repos (~/Work/platform vs ~/Personal/platform); tooltips carry the full
 * path.
 */
export function workspacePathHint(p: string): string {
  const dir = shortenPath(p).replace(/\/+$/, "").split("/").slice(0, -1).join("/");
  if (!dir) return "";
  const segments = dir.split("/").filter(Boolean);
  if (dir.startsWith("~")) {
    return segments.length <= 2 ? segments.join("/") : `~/…/${segments.slice(-1).join("/")}`;
  }
  return segments.length <= 2 ? `/${segments.join("/")}` : `…/${segments.slice(-2).join("/")}`;
}
