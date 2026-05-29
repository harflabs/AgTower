import { toast } from "sonner";

/**
 * Handles a failed backend invoke by showing a toast notification.
 * Use in place of `.catch(console.error)` for user-visible operations.
 */
export function toastError(action: string) {
  return (err: unknown) => {
    console.error(`[${action}]`, err);
    toast.error(`Failed to ${action}`);
  };
}
