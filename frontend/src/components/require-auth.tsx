import { can, type AuthUser, type Capability, type Tier } from "@ctp/shared";
import { useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { RoleChangeConfirmation } from "@/components/role-change-confirmation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

function AuthHeader({ member, signOut }: { member: AuthUser; signOut: () => Promise<unknown> }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b px-4 py-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{member.email}</span>
        <span className="text-xs">{member.role.replaceAll("_", " ")}</span>
      </div>
      <Button variant="outline" size="sm" onClick={() => void signOut()}>
        Sign out
      </Button>
    </header>
  );
}

function SelfDemotion({ member }: { member: AuthUser }) {
  const [error, setError] = useState(false);

  async function demote() {
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
    }
  }

  return (
    <section className="mx-auto max-w-xl p-4">
      <RoleChangeConfirmation from={member.role} to="officer" onConfirm={demote} />
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          Role change failed.
        </p>
      )}
    </section>
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

  if (!account) return <Navigate to="/login" replace />;

  if (isLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center p-8">
        <p className="text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (!member || member.tier < minTier || (capability && !can(member.role, capability))) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-8">
        <p className="text-destructive">
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
    <>
      <AuthHeader member={member} signOut={signOut} />
      {member.role !== "officer" && can(member.role, "member:role-change") && (
        <SelfDemotion member={member} />
      )}
      {children}
    </>
  );
}
