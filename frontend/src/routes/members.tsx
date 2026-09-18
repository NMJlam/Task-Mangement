import { can, roleSchema, tierForRole, type Role, type RosterMember } from "@ctp/shared";
import { useState } from "react";
import { PageHeader } from "@/components/common/page-header";
import { UserAvatar } from "@/components/common/user-avatar";
import { RoleChangeConfirmation } from "@/components/members/role-change-confirmation";
import { Card, CardContent } from "@/components/ui/card";
import { useMe } from "@/hooks/use-me";
import { useMembers } from "@/hooks/use-members";

const joinedDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function MembersPage() {
  const me = useMe();
  const members = useMembers();
  const [pending, setPending] = useState<{ member: RosterMember; role: Role }>();
  const canManage = me.status === "ok" && can(me.user.role, "member:role-change");
  const items = members.state.status === "ok" ? members.state.items : [];

  async function confirmRoleChange() {
    if (!pending) return;
    if (await members.changeRole(pending.member, pending.role)) setPending(undefined);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Members"
        description={
          members.state.status === "ok"
            ? `${items.length} club member${items.length === 1 ? "" : "s"} across the committee.`
            : "The club directory and committee roles."
        }
      />

      {pending && (
        <section aria-label="Confirm role change" className="mt-8">
          <p className="mb-3 text-sm text-muted-foreground">
            Change {pending.member.name || pending.member.email} from{" "}
            {roleLabel(pending.member.role)}
            {" to "}
            {roleLabel(pending.role)}?
          </p>
          <RoleChangeConfirmation
            from={pending.member.role}
            to={pending.role}
            onConfirm={confirmRoleChange}
            onCancel={() => setPending(undefined)}
            busy={members.busy === pending.member.id}
          />
        </section>
      )}

      {members.mutationError && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {members.mutationError}. Review the role and try again.
        </p>
      )}
      {members.state.status === "loading" && (
        <p className="mt-8 text-sm text-muted-foreground" role="status">
          Loading Members…
        </p>
      )}
      {members.state.status === "error" && (
        <p className="mt-8 text-sm text-destructive" role="alert">
          Couldn&apos;t load members: {members.state.message}. Refresh the page to try again.
        </p>
      )}
      {members.state.status === "ok" && items.length === 0 && (
        <Card className="mt-8 border-dashed shadow-none">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No club members were found.
          </CardContent>
        </Card>
      )}
      {members.state.status === "ok" && items.length > 0 && (
        <section
          aria-label="Member directory"
          className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {items.map((member) => (
            <MemberCard
              key={member.id}
              member={member}
              editable={canManage}
              maxTier={me.status === "ok" ? me.user.tier : 0}
              busy={members.busy === member.id}
              onRoleChange={(role) => setPending({ member, role })}
            />
          ))}
        </section>
      )}
    </main>
  );
}

function MemberCard({
  member,
  editable,
  maxTier,
  busy,
  onRoleChange,
}: {
  member: RosterMember;
  editable: boolean;
  maxTier: 0 | 1 | 2;
  busy: boolean;
  onRoleChange: (role: Role) => void;
}) {
  const name = member.name || member.email;

  return (
    <Card className="gap-5 shadow-none">
      <CardContent className="pt-1">
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar name={name} className="size-10" />
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{name}</h2>
            <p className="truncate text-xs text-muted-foreground">{member.email}</p>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
          <dt className="text-muted-foreground">Role</dt>
          <dd className="text-right">
            {editable ? (
              <>
                <label className="sr-only" htmlFor={`role-${member.id}`}>
                  Role for {name}
                </label>
                <select
                  id={`role-${member.id}`}
                  value={member.role}
                  disabled={busy}
                  onChange={(event) => onRoleChange(roleSchema.parse(event.target.value))}
                  className="h-8 max-w-40 cursor-pointer rounded-md border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {roleSchema.options
                    .filter((role) => tierForRole(role) <= maxTier)
                    .map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                </select>
              </>
            ) : (
              <span>{roleLabel(member.role)}</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Portfolio</dt>
          <dd className="text-right">{member.portfolio || "—"}</dd>
          <dt className="text-muted-foreground">Teams</dt>
          <dd className="text-right tabular-nums">{member.teamIds.length}</dd>
          <dt className="text-muted-foreground">Joined</dt>
          <dd className="text-right">
            <time dateTime={member.createdAt.toISOString()}>
              {joinedDate.format(member.createdAt)}
            </time>
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}

function roleLabel(role: Role) {
  return role.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
