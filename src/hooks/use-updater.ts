import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect } from "react";
import { HAS_TAURI_RUNTIME } from "@/lib/platform";
import { useUpdaterStore } from "@/stores/updater-store";

const STARTUP_DELAY_MS = 3_500;
const POLL_INTERVAL_MS = 60 * 60 * 1_000; // 1 hour

let pendingUpdate: Update | null = null;

async function readCurrentVersion(): Promise<string | null> {
  try {
    return await getVersion();
  } catch {
    return null;
  }
}

async function runCheck(options: { silent: boolean }): Promise<void> {
  const store = useUpdaterStore.getState();

  // Don't re-check once we're mid-download / ready — we'd clobber state.
  if (store.status === "downloading" || store.status === "ready") {
    return;
  }

  if (!options.silent) {
    store.setStatus("checking");
  }

  try {
    const currentVersion = await readCurrentVersion();
    const update = await check();

    if (!update) {
      pendingUpdate = null;
      useUpdaterStore.getState().setUpToDate(currentVersion);
      return;
    }

    pendingUpdate = update;
    useUpdaterStore.getState().setAvailable({
      version: update.version,
      currentVersion: update.currentVersion ?? currentVersion,
      releaseNotes: update.body ?? null,
      releaseDate: update.date ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[updater] check failed:", message);
    useUpdaterStore.getState().setError("check", message);
  }
}

async function downloadAndStage(): Promise<void> {
  if (!pendingUpdate) {
    // If we lost the cached handle (e.g. page reload mid-session), re-check first.
    await runCheck({ silent: true });
    if (!pendingUpdate) {
      const state = useUpdaterStore.getState();
      const message =
        state.status === "error" && state.errorContext === "check" && state.error
          ? state.error
          : "No update is available right now.";
      useUpdaterStore.getState().setError("download", message);
      throw new Error(message);
    }
  }

  // Zero the progress accumulator before we start. Without this, a retry
  // after a failed attempt would add new chunks on top of the prior total
  // and push the percent above 100.
  useUpdaterStore.getState().startDownload(null);

  try {
    let contentLength: number | null = null;
    await pendingUpdate.download((event) => {
      switch (event.event) {
        case "Started":
          contentLength = event.data.contentLength ?? null;
          useUpdaterStore.getState().startDownload(contentLength);
          break;
        case "Progress":
          useUpdaterStore.getState().setDownloadProgress(event.data.chunkLength, contentLength);
          break;
        case "Finished":
          useUpdaterStore.getState().markReady();
          break;
      }
    });
    useUpdaterStore.getState().markReady();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[updater] download failed:", message);
    useUpdaterStore.getState().setError("download", message);
    throw new Error(message);
  }
}

async function installAndRelaunch(): Promise<void> {
  if (!pendingUpdate) {
    const message = "The staged update is no longer available. Check for updates again.";
    useUpdaterStore.getState().setError("install", message);
    throw new Error(message);
  }
  try {
    await pendingUpdate.install();
    await relaunch();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[updater] install failed:", message);
    useUpdaterStore.getState().setError("install", message);
    throw new Error(message);
  }
}

/**
 * Drive the updater lifecycle: delayed startup check, hourly poll, and
 * expose imperative actions to the UI.
 *
 * Mount once (at AppShell). The effect's own cleanup tears down the timers, so a
 * remount safely re-arms them (and it no longer dead-locks under StrictMode's
 * mount→unmount→mount in dev); persistent state lives in the Zustand store.
 */
export function useUpdater() {
  useEffect(() => {
    if (!HAS_TAURI_RUNTIME) return;

    let cancelled = false;
    const startupTimer = setTimeout(() => {
      if (cancelled) return;
      void runCheck({ silent: true });
    }, STARTUP_DELAY_MS);

    const pollTimer = setInterval(() => {
      if (cancelled) return;
      void runCheck({ silent: true });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(startupTimer);
      clearInterval(pollTimer);
    };
  }, []);

  const checkNow = useCallback(() => runCheck({ silent: false }), []);
  const download = useCallback(() => downloadAndStage(), []);
  const install = useCallback(() => installAndRelaunch(), []);

  return { checkNow, download, install };
}

export const updaterActions = {
  check: () => runCheck({ silent: false }),
  download: () => downloadAndStage(),
  install: () => installAndRelaunch(),
};
