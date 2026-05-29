import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { replaceSplitPairPane, type SplitPaneSide } from "@/lib/split-view";

export interface SplitPair {
  left: string;
  right: string;
}

interface SessionDragPosition {
  x: number;
  y: number;
}

interface SplitViewState {
  focusedPaneId: string | null;
  setFocusedPaneId: (id: string | null) => void;

  /** Two-pane split view — left and right session IDs */
  splitPair: SplitPair | null;
  /** Ratio of left pane width (0.2–0.8, default 0.5) */
  splitRatio: number;
  openSplit: (leftId: string, rightId: string) => void;
  closeSplit: () => void;
  replaceSplitPane: (side: SplitPaneSide, sessionId: string) => void;
  setSplitRatio: (ratio: number) => void;

  /** Session ID currently being dragged from the sidebar */
  draggingSessionId: string | null;
  draggingSessionPosition: SessionDragPosition | null;
  setDraggingSession: (id: string | null, position?: SessionDragPosition | null) => void;
  setDraggingSessionPosition: (position: SessionDragPosition | null) => void;
}

export const useSplitViewStore = create<SplitViewState>()(
  devtools(
    (set) => ({
      focusedPaneId: null,
      setFocusedPaneId: (id) => set({ focusedPaneId: id }),

      // Split pair
      splitPair: null,
      splitRatio: 0.5,
      openSplit: (leftId, rightId) => {
        if (leftId === rightId) return;
        set({ splitPair: { left: leftId, right: rightId }, focusedPaneId: rightId });
      },
      closeSplit: () => set({ splitPair: null, focusedPaneId: null }),
      replaceSplitPane: (side, sessionId) =>
        set((state) => {
          if (!state.splitPair) return state;
          const nextPair = replaceSplitPairPane(state.splitPair, side, sessionId);
          if (nextPair === state.splitPair) return state;
          return {
            splitPair: nextPair,
            focusedPaneId: nextPair[side],
          };
        }),
      setSplitRatio: (ratio) => set({ splitRatio: Math.max(0.2, Math.min(0.8, ratio)) }),

      draggingSessionId: null,
      draggingSessionPosition: null,
      setDraggingSession: (id, position = null) =>
        set({ draggingSessionId: id, draggingSessionPosition: id ? position : null }),
      setDraggingSessionPosition: (position) => set({ draggingSessionPosition: position }),
    }),
    { name: "split-view-store" },
  ),
);
