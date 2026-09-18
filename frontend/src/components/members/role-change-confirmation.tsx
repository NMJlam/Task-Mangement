import { roleDiff, type Role } from "@ctp/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";

export function RoleChangeConfirmation({
  from,
  to,
  onConfirm,
  onCancel,
  busy = false,
}: {
  from: Role;
  to: Role;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  busy?: boolean;
}) {
  const { gains, removed } = roleDiff(from, to);

  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold">What Changes</h2>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
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
      </CardContent>
      <CardFooter className="gap-2">
        {onCancel && (
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button disabled={busy} onClick={() => void onConfirm()}>
          {busy ? "Changing…" : "Confirm Role Change"}
        </Button>
      </CardFooter>
    </Card>
  );
}
