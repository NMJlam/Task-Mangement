import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Confirms deleting a group for everyone in it. Mounted only while a deletion
 * is being confirmed; `onClose` is the one way out — Cancel, Escape, the
 * overlay and the close button all route to it.
 *
 * The copy promises what the API does and no more: the group goes from every
 * member's Messages, but it is a soft delete, so it does not claim the history
 * is erased.
 */
export function DeleteGroupDialog({
  name,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  name: string;
  busy: boolean;
  /** Shown verbatim, in the caller's wording. */
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        // Cancel is where focus starts: Enter on a dialog that just opened
        // must never be the thing that deletes.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete “{name}”?</DialogTitle>
          <DialogDescription>
            This removes the group and its messages from Messages for every member, you included.
            Nobody will be able to open it, post in it or summarise it again.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button ref={cancelRef} variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? "Deleting…" : "Delete group"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
