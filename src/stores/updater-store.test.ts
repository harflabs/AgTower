import { beforeEach, describe, expect, it } from "vitest";
import { useUpdaterStore } from "@/stores/updater-store";

function resetUpdaterStore() {
  useUpdaterStore.setState({
    status: "idle",
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
  });
}

function setAvailable(version: string) {
  useUpdaterStore.getState().setAvailable({
    version,
    currentVersion: "0.2.0",
    releaseNotes: null,
    releaseDate: null,
  });
}

describe("useUpdaterStore", () => {
  beforeEach(() => {
    resetUpdaterStore();
  });

  it("keeps dismissal for the same available update", () => {
    setAvailable("0.2.1");
    useUpdaterStore.getState().dismiss();

    setAvailable("0.2.1");

    expect(useUpdaterStore.getState().dismissed).toBe(true);
  });

  it("shows the pill again when a newer update appears", () => {
    setAvailable("0.2.1");
    useUpdaterStore.getState().dismiss();

    setAvailable("0.2.2");

    expect(useUpdaterStore.getState().dismissed).toBe(false);
  });

  it("clears dismissal when the app is up to date", () => {
    setAvailable("0.2.1");
    useUpdaterStore.getState().dismiss();

    useUpdaterStore.getState().setUpToDate("0.2.1");

    expect(useUpdaterStore.getState().dismissed).toBe(false);
  });
});
