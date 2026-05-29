import { useEffect, useRef } from "react";
import { confirmDestructiveAction } from "@/lib/native-dialog";

interface RemoveWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceName: string;
  onConfirm: () => void;
}

export function RemoveWorkspaceDialog({
  open,
  onOpenChange,
  workspaceName,
  onConfirm,
}: RemoveWorkspaceDialogProps) {
  const onConfirmRef = useRef(onConfirm);
  const onOpenChangeRef = useRef(onOpenChange);
  const mountedRef = useRef(true);
  const promptInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    onConfirmRef.current = onConfirm;
  }, [onConfirm]);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    if (promptInFlightRef.current) return;

    promptInFlightRef.current = true;
    void (async () => {
      const confirmed = await confirmDestructiveAction({
        title: "Remove workspace?",
        message: `"${workspaceName}" will disappear from the sidebar, but its sessions and history will stay available through search and can reconnect if you add the workspace again later.`,
        okLabel: "Remove",
      });
      promptInFlightRef.current = false;
      if (!mountedRef.current) return;
      if (confirmed) {
        onConfirmRef.current();
      }
      onOpenChangeRef.current(false);
    })();
  }, [open, workspaceName]);

  return null;
}
