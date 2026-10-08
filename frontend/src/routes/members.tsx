import {
  can,
  roleSchema,
  tierForRole,
  type Role,
  type RosterMember,
  type TeamWithMembers,
} from "@ctp/shared";
import { useRef, useState } from "react";
import { PageHeader } from "@/components/common/page-header";
import { UserAvatar } from "@/components/common/user-avatar";
import { canSetLead, MemberTeams, staffableTeams } from "@/components/members/member-teams";
import { RoleChangeDialog, roleLabel } from "@/components/members/role-change-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { useMe } from "@/hooks/use-me";
import { useMembers } from "@/hooks/use-members";
import { useTeams } from "@/hooks/use-teams";

const joinedDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function MembersPage() {
  const me = useMe();
  const members = useMembers();
  const teams = useTeams();
  const [pending, setPending] = useState<{ member: RosterMember; role: Role }>();
  // The member whose teams were last edited, so a failed write is reported in
  // that member's editor and not in whichever one opens next.
  const [teamTarget, setTeamTarget] = useState<string>();
  // This dialog opens from a `<select>`, not a `DialogTrigger`, so Radix cannot
  // restore focus: the select that raised it is remembered and refocused here.
  const opener = useRef<HTMLSelectElement | null>(null);
  const canManage = me.status === "ok" && can(me.user.role, "member:role-change");
  const items = members.state.status === "ok" ? members.state.items : [];
  const teamItems = teams.state.status === "ok" ? teams.state.items : undefined;
  const editableTeams = teamItems && me.status === "ok" ? staffableTeams(teamItems, me.user) : [];
  const canLead = me.status === "ok" && canSetLead(me.user);
  const nameOf = (id: string) => {
    const found = items.find((item) => item.id === id);
    return found ? found.name || found.email : "Former Member";
  };

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
        <RoleChangeDialog
          subject={pending.member.name || pending.member.email}
          from={pending.member.role}
          to={pending.role}
          onConfirm={confirmRoleChange}
          onClose={() => setPending(undefined)}
          busy={members.busy === pending.member.id}
          error={
            members.mutationError && `${members.mutationError}. Review the role and try again.`
          }
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        />
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
              onRoleChange={(role, select) => {
                opener.current = select;
                setPending({ member, role });
              }}
              teams={teamItems}
              editableTeams={editableTeams}
              teamsBusy={teams.busy}
              teamsError={teamTarget === member.id ? teams.mutationError : undefined}
              onTeamToggle={(team, on) => {
                setTeamTarget(member.id);
                void teams.setMembership(team, member.id, on);
              }}
              onTeamLead={
                canLead
                  ? (team, lead) => {
                      setTeamTarget(member.id);
                      void teams.setLead(team, lead ? member.id : null);
                    }
                  : undefined
              }
              nameOf={nameOf}
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
  teams,
  editableTeams,
  teamsBusy,
  teamsError,
  onTeamToggle,
  onTeamLead,
  nameOf,
}: {
  member: RosterMember;
  editable: boolean;
  maxTier: 0 | 1 | 2;
  busy: boolean;
  onRoleChange: (role: Role, select: HTMLSelectElement) => void;
  /** `undefined` until the teams load — the roster's count stands in meanwhile. */
  teams: TeamWithMembers[] | undefined;
  editableTeams: TeamWithMembers[];
  teamsBusy: string | undefined;
  teamsError: string | undefined;
  onTeamToggle: (team: TeamWithMembers, member: boolean) => void;
  onTeamLead: ((team: TeamWithMembers, lead: boolean) => void) | undefined;
  nameOf: (id: string) => string;
}) {
  const name = member.name || member.email;
  // Read off the teams once they load, not the roster's `portfolio`: the roster
  // is a snapshot from page load, so a lead set here would not show until a
  // refresh. It also names every team the member leads, where the roster's
  // field carries only one.
  const portfolio = teams
    ? teams
        .filter((team) => team.lead === member.id)
        .map((team) => team.name)
        .join(", ")
    : member.portfolio;

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
                  onChange={(event) =>
                    onRoleChange(roleSchema.parse(event.target.value), event.currentTarget)
                  }
                  className="h-8 max-w-40 cursor-pointer rounded-md border bg-background px-2 text-xs focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50"
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
          <dd className="text-right">{portfolio || "—"}</dd>
          <dt className="text-muted-foreground">Teams</dt>
          <dd className="text-right">
            {teams ? (
              <MemberTeams
                memberId={member.id}
                memberName={name}
                teams={teams}
                editable={editableTeams}
                busy={teamsBusy}
                error={teamsError}
                onToggle={onTeamToggle}
                onLead={onTeamLead}
                nameOf={nameOf}
              />
            ) : (
              <span className="tabular-nums">{member.teamIds.length}</span>
            )}
          </dd>
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
