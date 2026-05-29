import { AlertTriangle, ArrowLeft, FolderOpen, LoaderCircle, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAppShellToolbar } from "@/components/app-shell-toolbar";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { useWindowTitle } from "@/hooks/use-window-title";
import { useRepoStore } from "@/stores/repo-store";

// Module-level guard survives React StrictMode unmount/remount cycles.
// Timeout ensures the guard can't get permanently stuck if startSession hangs.
let creatingSession = false;
let creatingTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingSessionId: string | null = null;
let pendingSessionExpiresAt = 0;

function getPendingSessionId(): string | null {
  if (pendingSessionId && Date.now() < pendingSessionExpiresAt) {
    return pendingSessionId;
  }

  pendingSessionId = null;
  pendingSessionExpiresAt = 0;
  return null;
}

function rememberPendingSession(sessionId: string) {
  pendingSessionId = sessionId;
  pendingSessionExpiresAt = Date.now() + 5000;
}

function acquireCreationLock(): boolean {
  if (creatingSession) return false;
  creatingSession = true;
  creatingTimeout = setTimeout(() => {
    creatingSession = false;
    creatingTimeout = null;
  }, 15_000);
  return true;
}

function releaseCreationLock() {
  creatingSession = false;
  if (creatingTimeout) {
    clearTimeout(creatingTimeout);
    creatingTimeout = null;
  }
}

export default function NewSession() {
  useWindowTitle("AgTower — New Session");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { startSession } = useSession();
  const activeRepoId = useRepoStore((s) => s.activeRepoId);
  const repos = useRepoStore((s) => s.repos);
  const [startError, setStartError] = useState<string | null>(null);
  // Prefer explicit repo from URL param over activeRepoId
  const targetRepoId = searchParams.get("repo") ?? activeRepoId;
  // Optional provider override — set by the per-workspace split-button menu
  // when the user explicitly picked a non-default provider for this session.
  const targetProviderId = searchParams.get("provider");
  const activeRepo = targetRepoId ? repos[targetRepoId] : null;
  const launchedRef = useRef(false);
  const shellToolbarDescriptor = useMemo(
    () => ({
      detail: startError
        ? "Could not create session"
        : (activeRepo?.name ?? "No workspace selected"),
      kind: "title" as const,
      title: "New Session",
    }),
    [activeRepo?.name, startError],
  );
  useAppShellToolbar(shellToolbarDescriptor);

  // Reset launch guard when the target repo changes (e.g. clicking + on a different workspace)
  const prevRepoRef = useRef(targetRepoId);
  useEffect(() => {
    if (prevRepoRef.current !== targetRepoId) {
      prevRepoRef.current = targetRepoId;
      launchedRef.current = false;
      setStartError(null);
    }
  }, [targetRepoId]);

  const handleBackToDashboard = useCallback(() => {
    navigate("/", { replace: true });
  }, [navigate]);

  const handleRetry = useCallback(() => {
    launchedRef.current = false;
    setStartError(null);
  }, []);

  useEffect(() => {
    if (launchedRef.current) return;
    if (!activeRepo) return;
    if (startError) return;
    const pending = getPendingSessionId();
    if (pending) {
      launchedRef.current = true;
      navigate(`/session/${pending}`, { replace: true });
      return;
    }
    if (!acquireCreationLock()) return;

    launchedRef.current = true;
    startSession({
      prompt: "",
      repoId: targetRepoId,
      providerId: targetProviderId ?? undefined,
    })
      .then((sessionId) => {
        rememberPendingSession(sessionId);
        navigate(`/session/${sessionId}`, { replace: true });
      })
      .catch((err) => {
        console.error("[new-session] Failed to start:", err);
        setStartError(err instanceof Error ? err.message : "The session could not be created.");
        launchedRef.current = false;
      })
      .finally(releaseCreationLock);
  }, [activeRepo, targetRepoId, targetProviderId, startSession, navigate, startError]);

  useEffect(() => {
    return () => {
      launchedRef.current = false;
    };
  }, []);

  if (!activeRepo) {
    return (
      <div className="flex flex-1 items-center justify-center px-8 py-10">
        <div
          role="status"
          className="flex max-w-sm flex-col items-center gap-3 text-center text-sm"
        >
          <FolderOpen className="size-7 text-muted-foreground/70" />
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-foreground">Select a workspace</h2>
            <p className="leading-6 text-muted-foreground">
              Choose a workspace in the sidebar to start a new session.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={handleBackToDashboard}>
            <ArrowLeft className="size-3.5" />
            Dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (startError) {
    return (
      <div className="flex flex-1 items-center justify-center px-8 py-10">
        <div role="alert" className="flex max-w-md flex-col items-center gap-3 text-center text-sm">
          <AlertTriangle className="size-6 text-destructive" />
          <div className="space-y-1.5">
            <h2 className="text-sm font-medium text-foreground">Couldn't start session</h2>
            <p className="leading-6 text-muted-foreground">
              AgTower could not create a new session in {activeRepo.name}.
            </p>
            <p className="mx-auto max-w-sm text-xs leading-5 text-secondary-info">{startError}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleBackToDashboard}>
              <ArrowLeft className="size-3.5" />
              Dashboard
            </Button>
            <Button type="button" size="sm" onClick={handleRetry}>
              <RotateCcw className="size-3.5" />
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center px-8 py-10">
      <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin text-muted-foreground/80" />
        <div className="min-w-0">
          <div className="font-medium text-foreground">Starting session</div>
          <div className="mt-0.5 max-w-[18rem] truncate text-xs text-secondary-info">
            {activeRepo.name}
          </div>
        </div>
      </div>
    </div>
  );
}
