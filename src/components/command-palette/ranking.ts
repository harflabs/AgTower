import type {
  PaletteContext,
  PaletteItem,
  PaletteMatch,
  PaletteQuery,
  RecentPaletteEntry,
} from "./model";
import { normalizeForSearch } from "./model";
import { getRecentBoost } from "./recents";

type PaletteCandidate = { value: string; alias: string | undefined };

// Pre-normalized search strings are stable per PaletteItem reference. Items are
// rebuilt cheaply; a WeakMap lets old entries get GC'd with their items.
const candidateCache = new WeakMap<PaletteItem, PaletteCandidate[]>();

function getPaletteCandidates(item: PaletteItem): PaletteCandidate[] {
  const cached = candidateCache.get(item);
  if (cached) return cached;

  const candidates: PaletteCandidate[] = [
    { value: normalizeForSearch(item.title), alias: undefined },
  ];
  if (item.aliases) {
    for (const alias of item.aliases) {
      candidates.push({ value: normalizeForSearch(alias), alias });
    }
  }
  if (item.keywords) {
    for (const keyword of item.keywords) {
      candidates.push({ value: normalizeForSearch(keyword), alias: keyword });
    }
  }
  if (item.subtitle) {
    candidates.push({ value: normalizeForSearch(item.subtitle), alias: undefined });
  }

  candidateCache.set(item, candidates);
  return candidates;
}

function scoreFuzzy(candidate: string, query: string): number {
  if (!candidate || !query) return 0;
  if (candidate === query) return 140;
  if (candidate.startsWith(query)) return 120 - Math.min(candidate.length - query.length, 20);

  const exactIndex = candidate.indexOf(query);
  if (exactIndex >= 0) {
    return 96 - exactIndex * 0.6 + Math.min(query.length * 0.8, 16);
  }

  let qIndex = 0;
  let streak = 0;
  let score = 0;

  for (let i = 0; i < candidate.length && qIndex < query.length; i++) {
    if (candidate[i] === query[qIndex]) {
      streak += 1;
      score += 5 + streak * 2;
      qIndex += 1;
    } else {
      streak = 0;
      score -= 0.15;
    }
  }

  if (qIndex !== query.length) return 0;
  return Math.max(score - candidate.length * 0.04, 1);
}

function matchesFilters(item: PaletteItem, query: PaletteQuery): boolean {
  if (query.filters.types.length > 0 && !query.filters.types.includes(item.kind)) return false;
  if (
    query.filters.pinned !== null &&
    Boolean(item.meta?.pinned) !== Boolean(query.filters.pinned)
  ) {
    return false;
  }
  if (
    query.filters.statuses.length > 0 &&
    !query.filters.statuses.includes(normalizeForSearch(item.meta?.status ?? item.status ?? ""))
  ) {
    return false;
  }
  if (query.filters.providers.length > 0) {
    const providerId = normalizeForSearch(item.meta?.providerId ?? "");
    if (!query.filters.providers.some((value) => providerId.includes(value))) return false;
  }
  if (query.filters.repos.length > 0) {
    const repoId = normalizeForSearch(item.meta?.repoId ?? "");
    const repoText = normalizeForSearch(item.subtitle ?? "");
    if (!query.filters.repos.some((value) => repoId.includes(value) || repoText.includes(value))) {
      return false;
    }
  }
  return true;
}

function scoreContext(item: PaletteItem, ctx: PaletteContext): number {
  let score = item.queryOrder ?? 0;

  if (item.meta?.sessionId && item.meta.sessionId === ctx.activeSessionId) score += 22;
  if (item.meta?.repoId && item.meta.repoId === ctx.activeRepoId) score += 10;
  if (item.meta?.status === "needsattention") score += 18;
  if (item.meta?.pinned) score += 6;
  if (item.kind === "setting" && ctx.isOnSession) score += 1;
  if (item.kind === "command" && item.group === "Commands") score += 4;

  // MRU tiebreaker: when fuzzy match scores are similar, recently-visited
  // sessions float up. Decays from +16 at the top of viewed history to 0
  // around the 20th visited session; below that, no bonus. Intentionally
  // smaller than typical fuzzy-match deltas so text matches still dominate.
  if (item.kind === "session" && item.meta?.sessionId) {
    const mruIndex = ctx.viewedSessionIds.indexOf(item.meta.sessionId);
    if (mruIndex >= 0) {
      score += Math.max(0, 16 - mruIndex * 0.8);
    }
  }

  return score;
}

function isDangerExactMatch(item: PaletteItem, query: PaletteQuery): boolean {
  if (item.dangerLevel !== "guarded") return true;
  if (!query.normalizedText) return false;
  const exact = normalizeForSearch(item.exactMatchQuery ?? item.title);
  return exact === query.normalizedText;
}

function hasExplicitQuery(query: PaletteQuery): boolean {
  return (
    query.normalizedText.length > 0 ||
    query.filters.types.length > 0 ||
    query.filters.repos.length > 0 ||
    query.filters.statuses.length > 0 ||
    query.filters.providers.length > 0 ||
    query.filters.pinned !== null
  );
}

export function rankPaletteItems(
  items: PaletteItem[],
  query: PaletteQuery,
  ctx: PaletteContext,
  recents: RecentPaletteEntry[],
): PaletteMatch[] {
  if (!hasExplicitQuery(query)) return [];

  const matches: PaletteMatch[] = [];

  for (const item of items) {
    if (item.when && !item.when(ctx)) continue;
    if (!matchesFilters(item, query)) continue;
    if (!isDangerExactMatch(item, query)) continue;

    let matchedAlias: string | undefined;
    let score = scoreContext(item, ctx) + getRecentBoost(item.id, recents);

    if (query.normalizedText) {
      const candidates = getPaletteCandidates(item);

      let bestTextScore = 0;
      for (const candidate of candidates) {
        const nextScore = scoreFuzzy(candidate.value, query.normalizedText);
        if (nextScore > bestTextScore) {
          bestTextScore = nextScore;
          matchedAlias =
            candidate.alias && candidate.alias !== item.title && candidate.alias !== item.subtitle
              ? candidate.alias
              : undefined;
        }
      }

      if (bestTextScore <= 0) continue;
      score += bestTextScore;
    }

    matches.push({ item, score, matchedAlias });
  }

  return matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if ((right.item.queryOrder ?? 0) !== (left.item.queryOrder ?? 0)) {
      return (right.item.queryOrder ?? 0) - (left.item.queryOrder ?? 0);
    }
    return left.item.title.localeCompare(right.item.title);
  });
}
