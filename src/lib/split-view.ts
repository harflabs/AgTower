import type { SplitPair } from "@/stores/split-view-store";

export type SplitPaneSide = "left" | "right";

export function getSplitPaneSide(pair: SplitPair, sessionId: string): SplitPaneSide | null {
  if (pair.left === sessionId) return "left";
  if (pair.right === sessionId) return "right";
  return null;
}

export function getEffectiveSplitSessionId(
  routeSessionId: string | undefined,
  splitPair: SplitPair | null,
  focusedPaneId: string | null,
): string | undefined {
  if (!routeSessionId) return undefined;
  if (!splitPair) return routeSessionId;
  if (routeSessionId !== splitPair.left && routeSessionId !== splitPair.right) {
    return routeSessionId;
  }
  if (focusedPaneId === splitPair.left || focusedPaneId === splitPair.right) {
    return focusedPaneId;
  }
  return routeSessionId;
}

export function replaceSplitPairPane(
  pair: SplitPair,
  side: SplitPaneSide,
  sessionId: string,
): SplitPair {
  if (pair[side] === sessionId) {
    return pair;
  }

  const oppositeSide: SplitPaneSide = side === "left" ? "right" : "left";
  if (pair[oppositeSide] === sessionId) {
    return {
      left: pair.right,
      right: pair.left,
    };
  }

  return {
    ...pair,
    [side]: sessionId,
  };
}

export function getRemainingSplitSessionId(
  pair: SplitPair,
  removedSessionId: string,
): string | null {
  if (pair.left === removedSessionId) return pair.right;
  if (pair.right === removedSessionId) return pair.left;
  return null;
}

export function getValidSplitSessionIds<T>(
  pair: SplitPair | null,
  sessions: Record<string, T>,
): string[] {
  if (!pair) return [];

  const validIds: string[] = [];
  if (sessions[pair.left]) validIds.push(pair.left);
  if (sessions[pair.right]) validIds.push(pair.right);
  return validIds;
}
