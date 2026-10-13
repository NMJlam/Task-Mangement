import { roleSchema, tierForRole, type Role, type Tier } from "@ctp/shared";
import { useState, type FormEvent } from "react";
import { LoadingLine } from "@/components/common/loading-line";
import { LogLine } from "@/components/common/log-line";
import { roleLabel } from "@/components/members/role-change-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useInvites } from "@/hooks/use-invites";

/**
 * Invite by address, no email sent: the invitee signs in with Google using
 * that address and `authenticate.ts` turns the invite into membership.
 */
export function InvitesPanel({ maxTier }: { maxTier: Tier }) {
  const invites = useInvites();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("officer");
  const [invited, setInvited] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    setInvited(undefined);
    if (await invites.create(address, role)) {
      setInvited(address);
      setEmail("");
    }
  }

  return (
    <Card className="mt-8 shadow-none">
      <CardContent className="pt-1">
        <h2 className="font-semibold">Invites</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          No email is sent. Ask them to sign in with Google using the address you enter here.
        </p>
        <form
          onSubmit={(event) => void submit(event)}
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          <div className="grid min-w-56 flex-1 gap-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <select
              id="invite-role"
              value={role}
              onChange={(event) => setRole(roleSchema.parse(event.target.value))}
              className="h-9 cursor-pointer rounded-md border bg-background px-2 text-sm focus-visible:border-ring"
            >
              {roleSchema.options
                .filter((option) => tierForRole(option) <= maxTier)
                .map((option) => (
                  <option key={option} value={option}>
                    {roleLabel(option)}
                  </option>
                ))}
            </select>
          </div>
          <Button type="submit" disabled={invites.busy === "new"}>
            Invite
          </Button>
        </form>

        {invites.mutationError && (
          <LogLine tone="err" className="mt-3">
            {invites.mutationError}
          </LogLine>
        )}
        {invited && (
          <LogLine tone="ok" className="mt-3">
            Invited {invited}. They join the club the first time they sign in with that address.
          </LogLine>
        )}

        {invites.state.status === "loading" && (
          <LoadingLine label="Loading Invites…" className="mt-4" />
        )}
        {invites.state.status === "error" && (
          <LogLine tone="err" className="mt-4">
            Couldn&apos;t load invites: {invites.state.message}.
          </LogLine>
        )}
        {invites.state.status === "ok" && invites.state.items.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">No pending invites.</p>
        )}
        {invites.state.status === "ok" && invites.state.items.length > 0 && (
          <ul aria-label="Pending invites" className="mt-4 border-t text-sm">
            {invites.state.items.map((invite) => (
              <li
                key={invite.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b py-2"
              >
                <span className="min-w-0 flex-1 truncate">{invite.email}</span>
                <span className="text-muted-foreground">{roleLabel(invite.role)}</span>
                <Button
                  variant="destructive"
                  size="xs"
                  disabled={invites.busy === invite.id}
                  aria-label={`Revoke invite for ${invite.email}`}
                  onClick={() => void invites.revoke(invite)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
