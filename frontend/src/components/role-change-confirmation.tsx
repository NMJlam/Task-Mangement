import { roleDiff, type Role } from "@ctp/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export function RoleChangeConfirmation({
  from,
  to,
  onConfirm,
}: {
  from: Role;
  to: Role;
  onConfirm: () => void | Promise<void>;
}) {
  const { gains, removed } = roleDiff(from, to);

  return (
    <Card>
      <CardHeader>
        <CardTitle>What changes</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <section>
          <h3 className="font-medium text-green-700">Gains</h3>
          <ul className="list-disc pl-5 text-sm text-green-700">
            {gains.map((capability) => (
              <li key={capability}>{capability}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="font-medium text-red-700">Removed</h3>
          <ul className="list-disc pl-5 text-sm text-red-700">
            {removed.map((capability) => (
              <li key={capability}>{capability}</li>
            ))}
          </ul>
        </section>
      </CardContent>
      <CardFooter>
        <Button onClick={() => void onConfirm()}>Confirm role change</Button>
      </CardFooter>
    </Card>
  );
}
