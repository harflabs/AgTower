import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface ModalState {
  commandPaletteOpen: boolean;
  searchOpen: boolean;
  shortcutModalOpen: boolean;
  newSessionDialogOpen: boolean;
  setShortcutModalOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleSearch: () => void;
  setSearchOpen: (open: boolean) => void;
  setNewSessionDialogOpen: (open: boolean) => void;
}

export const useModalStore = create<ModalState>()(
  devtools(
    (set) => ({
      commandPaletteOpen: false,
      searchOpen: false,
      shortcutModalOpen: false,
      newSessionDialogOpen: false,
      setShortcutModalOpen: (open) => set({ shortcutModalOpen: open }),
      toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),
      setSearchOpen: (open) => set({ searchOpen: open }),
      setNewSessionDialogOpen: (open) => set({ newSessionDialogOpen: open }),
    }),
    { name: "modal-store" },
  ),
);
