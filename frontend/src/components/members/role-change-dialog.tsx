import { roleDiff, type Role } from "@ctp/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** `vice_president` reads as "Vice President" wherever a role is shown. */
export function roleLabel(role: Role) {
  return role.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function RoleChangeSummary({ from, to }: { from: Role; to: Role }) {
  const { gains, removed } = roleDiff(from, to);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section>
        <h3 className="font-medium text-emerald-700 dark:text-emerald-400">Gains</h3>
        <ul className="list-disc pl-5 text-sm text-emerald-700 dark:text-emerald-400">
          {gains.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="font-medium text-red-700 dark:text-red-400">Removed</h3>
        <ul className="list-disc pl-5 text-sm text-red-700 dark:text-red-400">
          {removed.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * The overlay every role change is confirmed through: the capability diff, then
 * the decision. It replaces the card that used to sit in the membership flow,
 * because the `<select>` that raises it lives in a member card well down the
 * grid — the diff belonged next to the cursor, not at the top of the page.
 *
 * Mounted only while a change is open, and `onClose` is the single dismissal
 * path: Cancel, Escape, the overlay and the close button all route to it.
 */
export function RoleChangeDialog({
  subject,
  from,
  to,
  onConfirm,
  onClose,
  busy = false,
  error,
  onCloseAutoFocus,
}: {
  /** Display name, or the only identity the caller has — the member's email. */
  subject: string;
  from: Role;
  to: Role;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  busy?: boolean;
  /** Shown verbatim, in the caller's wording. */
  error?: string;
  /** This dialog opens from a `<select>`, not a `DialogTrigger`: the caller returns focus itself. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Change Role</DialogTitle>
          <DialogDescription>
            Change {subject} from {roleLabel(from)} to {roleLabel(to)}?
          </DialogDescription>
        </DialogHeader>
        <RoleChangeSummary from={from} to={to} />
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void onConfirm()}>
            {busy ? "Changing…" : "Confirm Role Change"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
