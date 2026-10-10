import type { RosterMember } from "@ctp/shared";
import { Users } from "lucide-react";
import { LoadingLine } from "@/components/common/loading-line";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Membership comes from the thread, not from the whole club roster. */
export function GroupMembersDialog({
  name,
  memberIds,
  members,
  selfId,
  createdBy,
  rosterStatus,
}: {
  name: string;
  memberIds: readonly string[];
  members: readonly RosterMember[];
  selfId: string | undefined;
  createdBy: string | null;
  rosterStatus: "loading" | "ok" | "error";
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="xs">
          <Users aria-hidden="true" />
          Members ({memberIds.length})
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Group members</DialogTitle>
          <DialogDescription>People in {name}.</DialogDescription>
        </DialogHeader>
        {rosterStatus === "loading" ? (
          <LoadingLine label="Loading member names…" />
        ) : (
          <>
            {rosterStatus === "error" && (
              <p role="alert" className="text-sm text-destructive">
                Couldn’t load member names. Refresh the page to try again.
              </p>
            )}
            <ul className="grid gap-1" aria-label="Group members">
              {memberIds.map((id) => {
                const member = members.find((candidate) => candidate.id === id);
                const label = member?.name || member?.email || "Unknown member";
                return (
                  <li key={id} className="flex items-start gap-3 border-b py-3 last:border-0">
                    <UserAvatar name={label} />
                    <div className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
                      <p className="font-medium">{label}</p>
                      {member?.email && member.email !== label && (
                        <p className="text-xs text-muted-foreground">{member.email}</p>
                      )}
                      <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        {id === selfId && <span>You</span>}
                        {id === createdBy && <span>Group creator</span>}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
