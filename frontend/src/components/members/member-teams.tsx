import type { TeamWithMembers } from "@ctp/shared";
import { Pencil } from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/**
 * Which teams `viewer` may staff, mirroring the server's gate on
 * PUT/DELETE /api/teams/:teamId/members/:userId: tier 2 staffs any team, tier 1
 * only a team they lead, tier 0 none — even a team they lead, because the route
 * is `authorise(1)` before it ever reads the lead.
 */
export function staffableTeams(
  teams: readonly TeamWithMembers[],
  viewer: { id: string; tier: number },
): TeamWithMembers[] {
  if (viewer.tier >= 2) return [...teams];
  if (viewer.tier >= 1) return teams.filter((team) => team.lead === viewer.id);
  return [];
}

/**
 * Whether `viewer` may change a team's lead, mirroring PATCH /api/teams/:id:
 * tier 2 (president, vice president, treasurer, secretary). The lead is what a
 * member's portfolio is derived from, so this is also who sets portfolios.
 */
export function canSetLead(viewer: { tier: number }): boolean {
  return viewer.tier >= 2;
}

/**
 * A member's teams as `[Tag]`s, and — for a viewer who can staff at least one
 * team — the popover that puts them on or takes them off.
 *
 * The popover lists only the teams the viewer can staff, so every box in it
 * works; the chips beside it still show every team the member is on.
 *
 * With `onLead`, each row also carries a Lead box that makes the member the
 * team's lead or clears it. Leading and belonging stay separate facts, as the
 * schema keeps them: a lead need not be on the team. The row names the current
 * lead, because making this member lead replaces them.
 */
export function MemberTeams({
  memberId,
  memberName,
  teams,
  editable,
  busy,
  error,
  onToggle,
  onLead,
  nameOf,
}: {
  memberId: string;
  memberName: string;
  teams: readonly TeamWithMembers[];
  /** The subset of `teams` the viewer may staff. Empty hides the editor. */
  editable: readonly TeamWithMembers[];
  /** The write in flight, if any — every box waits for it. */
  busy: string | undefined;
  error: string | undefined;
  onToggle: (team: TeamWithMembers, member: boolean) => void;
  /** Present only for a viewer who may set leads (`canSetLead`). */
  onLead?: (team: TeamWithMembers, lead: boolean) => void;
  /** Display name for a member id, for the current-lead line. */
  nameOf: (id: string) => string;
}) {
  const onTeams = teams.filter((team) => team.memberIds.includes(memberId));

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {onTeams.length === 0 ? (
        <span className="text-muted-foreground">None</span>
      ) : (
        <ul aria-label={`Teams for ${memberName}`} className="flex flex-wrap justify-end gap-1.5">
          {onTeams.map((team) => (
            <li key={team.id} className="tag text-xs leading-none font-medium">
              {team.name}
            </li>
          ))}
        </ul>
      )}

      {editable.length > 0 && (
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button variant="outline" size="xs" aria-label={`Edit teams for ${memberName}`}>
              <Pencil aria-hidden="true" />
              Edit teams
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              aria-label={`Edit teams for ${memberName}`}
              align="end"
              side="bottom"
              sideOffset={6}
              collisionPadding={12}
              className="z-50 grid w-[min(20rem,calc(100vw-2rem))] gap-1 rounded-lg border bg-popover p-3 text-popover-foreground"
            >
              <p className="px-1 pb-1 text-xs font-semibold text-muted-foreground">
                Teams for {memberName}
              </p>
              {editable.map((team) => {
                const id = `team-${team.id}-member-${memberId}`;
                const leadId = `team-${team.id}-lead-${memberId}`;
                const on = team.memberIds.includes(memberId);
                return (
                  <div
                    key={team.id}
                    className="flex items-start gap-2.5 rounded-md px-1 py-1.5 hover:bg-secondary"
                  >
                    <Checkbox
                      id={id}
                      checked={on}
                      disabled={Boolean(busy)}
                      onCheckedChange={(checked) => onToggle(team, checked === true)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={id} className="cursor-pointer font-normal">
                        {team.name}
                      </Label>
                      {onLead && (
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {team.lead ? `Lead: ${nameOf(team.lead)}` : "No lead"}
                        </p>
                      )}
                    </div>
                    {onLead && (
                      <div className="flex items-center gap-1.5">
                        <Checkbox
                          id={leadId}
                          // Every row's box reads "Lead", so the name says
                          // which team; it still starts with the visible word.
                          aria-label={`Lead of ${team.name}`}
                          checked={team.lead === memberId}
                          disabled={Boolean(busy)}
                          onCheckedChange={(checked) => onLead(team, checked === true)}
                        />
                        <Label htmlFor={leadId} className="cursor-pointer text-xs font-normal">
                          Lead
                        </Label>
                      </div>
                    )}
                  </div>
                );
              })}
              {error && (
                <p className="px-1 pt-1 text-sm text-destructive" role="alert">
                  {error}. Try again.
                </p>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}
