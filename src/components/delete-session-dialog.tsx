import { useEffect, useRef } from "react";
import { confirmDestructiveAction } from "@/lib/native-dialog";

interface DeleteSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionTitle: string;
  onConfirm: () => void;
}

export function DeleteSessionDialog({
  open,
  onOpenChange,
  sessionTitle,
  onConfirm,
}: DeleteSessionDialogProps) {
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
        title: "Delete session?",
        message: `This will permanently delete "${sessionTitle}" and its entire conversation history. This action cannot be undone.`,
        okLabel: "Delete",
      });
      promptInFlightRef.current = false;
      if (!mountedRef.current) return;
      if (confirmed) {
        onConfirmRef.current();
      }
      onOpenChangeRef.current(false);
    })();
  }, [open, sessionTitle]);

  return null;
}
