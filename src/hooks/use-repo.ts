import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { toastError } from "@/lib/errors";
import { type Repository, useRepoStore } from "@/stores/repo-store";
import { useSessionStore } from "@/stores/session-store";
import { useSession } from "./use-session";

interface RepoInfo {
  name: string;
  path: string;
  is_git: boolean;
}

export function useRepo() {
  const addRepo = useRepoStore((s) => s.addRepo);
  const removeRepo = useRepoStore((s) => s.removeRepo);
  const setActiveRepo = useRepoStore((s) => s.setActiveRepo);
  const { startSession } = useSession();
  const navigate = useNavigate();

  const addRepository = useCallback(
    async (options: { autoStartSession?: boolean } = {}) => {
      const { autoStartSession = true } = options;

      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Select Workspace Folder",
      });

      if (!selectedPath) return null;

      const info = await invoke<RepoInfo>("validate_repository", {
        path: selectedPath,
      });

      const existingSession = Object.values(useSessionStore.getState().sessions).find(
        (session) => session.repoPath === info.path,
      );

      const repo: Repository = {
        id: existingSession?.repoId ?? crypto.randomUUID(),
        name: info.name,
        path: info.path,
        isGit: info.is_git,
        addedAt: Date.now(),
        lastOpenedAt: Date.now(),
        pinned: false,
        color: "",
        sortOrder: null,
      };

      addRepo(repo);

      // Default behaviour: kick off a fresh session in the new workspace and
      // route the user into it (sidebar's "Add Workspace" entry-point).
      // Callers that just need the workspace registered — like the new-session
      // dialog, where the user is mid-way through choosing a provider — pass
      // `autoStartSession: false` to skip this side effect.
      if (autoStartSession) {
        // Use the active repo id from the store (not `repo.id`) because
        // addRepo dedupes by path and may keep a pre-existing repo's id.
        const activeRepoId = useRepoStore.getState().activeRepoId;
        if (activeRepoId) {
          try {
            const sessionId = await startSession({ repoId: activeRepoId });
            navigate(`/session/${sessionId}`);
          } catch (err) {
            toastError("start session")(err);
          }
        }
      }
      return repo;
    },
    [addRepo, startSession, navigate],
  );

  return { addRepository, removeRepo, setActiveRepo };
}
