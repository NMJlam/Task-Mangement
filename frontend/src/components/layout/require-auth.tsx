import { can, type AuthUser, type Capability, type Tier } from "@ctp/shared";
import { useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { RoleChangeDialog } from "@/components/members/role-change-dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { NotificationsProvider, useNotificationsSource } from "@/hooks/use-notifications";

/**
 * Owns the one notification feed the signed-in app shares (see
 * `useNotifications`). It is a component rather than a hook call in
 * `RequireAuth` because the feed must not be read until membership is
 * confirmed — a `/api/notifications` fetch above that check would 401 on every
 * signed-out render.
 */
function SignedInShell({
  member,
  signOut,
  children,
}: {
  member: AuthUser;
  signOut: () => Promise<unknown>;
  children: ReactNode;
}) {
  const notifications = useNotificationsSource();

  return (
    <NotificationsProvider value={notifications}>
      <AppShell member={member} signOut={signOut}>
        {children}
      </AppShell>
    </NotificationsProvider>
  );
}

/**
 * A tier-2 office that is not `officer` holds `member:role-change`, and this
 * notice exists to hand that capability back — so it is the one role change the
 * user did not ask for, raised as an overlay the moment the shell renders.
 *
 * Dismissing it is the same as ignoring the banner it replaced: it returns on
 * the next navigation, because the notice belongs to the membership, not to a
 * page.
 */
function SelfDemotion({ member }: { member: AuthUser }) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function demote() {
    setBusy(true);
    try {
      const response = await fetch(`/api/members/${member.id}/role`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "officer" }),
      });
      if (!response.ok) return setError(true);
      window.location.reload();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <RoleChangeDialog
      subject={member.email}
      from={member.role}
      to="officer"
      onConfirm={demote}
      onClose={() => setOpen(false)}
      busy={busy}
      error={error ? "Role change failed. Try again." : undefined}
    />
  );
}

export function RequireAuth({
  children,
  minTier = 0,
  capability,
}: {
  children: ReactNode;
  minTier?: Tier;
  capability?: Capability;
}) {
  const { account, isLoading, member, needsInvite, signOut } = useAuth();

  if (isLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center p-8">
        <p className="text-muted-foreground" role="status">
          Loading…
        </p>
      </main>
    );
  }

  if (!account) return <Navigate to="/login" replace />;

  if (!member || member.tier < minTier || (capability && !can(member.role, capability))) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-8">
        <p className="text-destructive" role="alert">
          {member
            ? "You do not have access."
            : needsInvite
              ? "You need a club invite before you can join."
              : "Unable to verify club membership."}
        </p>
        <Button variant="outline" onClick={() => void signOut()}>
          Sign out
        </Button>
      </main>
    );
  }

  return (
    <SignedInShell member={member} signOut={signOut}>
      {member.role !== "officer" && can(member.role, "member:role-change") && (
        <SelfDemotion member={member} />
      )}
      {children}
    </SignedInShell>
  );
}
