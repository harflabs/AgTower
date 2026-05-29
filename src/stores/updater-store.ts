import { create } from "zustand";

type UpdaterStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "ready"
  | "error";

type UpdaterErrorContext = "check" | "download" | "install";

interface UpdaterState {
  status: UpdaterStatus;
  availableVersion: string | null;
  currentVersion: string | null;
  downloadPercent: number;
  downloadedBytes: number;
  contentLength: number | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  error: string | null;
  errorContext: UpdaterErrorContext | null;
  dismissed: boolean;
  lastCheckedAt: number | null;

  setStatus: (status: UpdaterStatus) => void;
  setAvailable: (info: {
    version: string;
    currentVersion: string | null;
    releaseNotes: string | null;
    releaseDate: string | null;
  }) => void;
  setUpToDate: (currentVersion: string | null) => void;
  startDownload: (contentLength: number | null) => void;
  setDownloadProgress: (bytes: number, contentLength: number | null) => void;
  markReady: () => void;
  setError: (context: UpdaterErrorContext, message: string) => void;
  dismiss: () => void;
  resetDismiss: () => void;
}

const initialState = {
  status: "idle" as UpdaterStatus,
  availableVersion: null,
  currentVersion: null,
  downloadPercent: 0,
  downloadedBytes: 0,
  contentLength: null,
  releaseNotes: null,
  releaseDate: null,
  error: null,
  errorContext: null,
  dismissed: false,
  lastCheckedAt: null,
};

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  ...initialState,

  setStatus: (status) => set({ status }),

  setAvailable: ({ version, currentVersion, releaseNotes, releaseDate }) =>
    set((state) => ({
      status: "available",
      availableVersion: version,
      currentVersion,
      releaseNotes,
      releaseDate,
      error: null,
      errorContext: null,
      downloadedBytes: 0,
      downloadPercent: 0,
      contentLength: null,
      dismissed: state.availableVersion === version ? state.dismissed : false,
      lastCheckedAt: Date.now(),
    })),

  setUpToDate: (currentVersion) =>
    set({
      status: "up-to-date",
      availableVersion: null,
      currentVersion,
      error: null,
      errorContext: null,
      dismissed: false,
      lastCheckedAt: Date.now(),
    }),

  startDownload: (contentLength) =>
    set({
      status: "downloading",
      downloadedBytes: 0,
      downloadPercent: 0,
      contentLength,
      error: null,
      errorContext: null,
    }),

  setDownloadProgress: (bytes, contentLength) => {
    const prev = get().downloadedBytes;
    const nextTotal = prev + bytes;
    const total = contentLength ?? get().contentLength;
    const percent = total && total > 0 ? Math.min(100, Math.round((nextTotal / total) * 100)) : 0;
    set({
      status: "downloading",
      downloadedBytes: nextTotal,
      contentLength: total,
      downloadPercent: percent,
    });
  },

  markReady: () =>
    set({
      status: "ready",
      downloadPercent: 100,
    }),

  setError: (context, message) =>
    set({
      status: "error",
      error: message,
      errorContext: context,
    }),

  dismiss: () => set({ dismissed: true }),

  resetDismiss: () => set({ dismissed: false }),
}));
