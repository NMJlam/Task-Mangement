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
 * A member's teams as `[Tag]`s, and — for a viewer who can staff at least one
 * team — the popover that puts them on or takes them off.
 *
 * The popover lists only the teams the viewer can staff, so every box in it
 * works; the chips beside it still show every team the member is on.
 */
export function MemberTeams({
  memberId,
  memberName,
  teams,
  editable,
  busy,
  error,
  onToggle,
}: {
  memberId: string;
  memberName: string;
  teams: readonly TeamWithMembers[];
  /** The subset of `teams` the viewer may staff. Empty hides the editor. */
  editable: readonly TeamWithMembers[];
  /** `${teamId}:${userId}` of the membership being written, if any. */
  busy: string | undefined;
  error: string | undefined;
  onToggle: (team: TeamWithMembers, member: boolean) => void;
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
              className="z-50 grid w-[min(16rem,calc(100vw-2rem))] gap-1 rounded-lg border bg-popover p-3 text-popover-foreground"
            >
              <p className="px-1 pb-1 text-xs font-semibold text-muted-foreground">
                Teams for {memberName}
              </p>
              {editable.map((team) => {
                const id = `team-${team.id}-member-${memberId}`;
                const on = team.memberIds.includes(memberId);
                return (
                  <div
                    key={team.id}
                    className="flex items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-secondary"
                  >
                    <Checkbox
                      id={id}
                      checked={on}
                      disabled={Boolean(busy)}
                      onCheckedChange={(checked) => onToggle(team, checked === true)}
                    />
                    <Label htmlFor={id} className="flex-1 cursor-pointer font-normal">
                      {team.name}
                    </Label>
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
