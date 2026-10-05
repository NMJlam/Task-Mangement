import type { RosterMember } from "@ctp/shared";
import { useState, type FormEvent } from "react";
import { UserAvatar } from "@/components/common/user-avatar";
import { AssigneeField } from "@/components/tasks/assignee-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** The roster stores a name that may be blank, so email is the fallback. */
function displayName(member: RosterMember): string {
  return member.name || member.email;
}

/**
 * Starts a new conversation — a dm (pick one person, starts immediately) or a
 * group (name it, pick several, then create). Picking an existing dm's other
 * person is harmless: `POST /api/threads` returns the existing thread rather
 * than a second one, so there is nothing here to guard against that case
 * specially.
 */
export function NewConversationDialog({
  open,
  onOpenChange,
  members,
  selfId,
  busy,
  error,
  onCreateDm,
  onCreateGroup,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: RosterMember[];
  selfId: string | undefined;
  busy: boolean;
  error?: string;
  onCreateDm: (memberId: string) => Promise<boolean>;
  onCreateGroup: (name: string, memberIds: string[]) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  function setOpen(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setQuery("");
      setGroupMemberIds([]);
      setPortalTarget(null);
    }
  }

  const others = members.filter((member) => member.id !== selfId);
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? others.filter((member) =>
        [member.name, member.email].some((value) => value.toLocaleLowerCase().includes(needle)),
      )
    : others;

  function submitGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name || groupMemberIds.length === 0) return;
    void onCreateGroup(name, groupMemberIds).then((created) => {
      if (created) setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent ref={setPortalTarget}>
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>Start a direct message or create a group.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="dm">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="dm">Direct message</TabsTrigger>
            <TabsTrigger value="group">Group</TabsTrigger>
          </TabsList>

          <TabsContent value="dm" className="grid gap-3">
            <Label htmlFor="dm-search" className="sr-only">
              Search members
            </Label>
            <Input
              id="dm-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search members"
              autoComplete="off"
            />
            <div className="grid max-h-64 gap-1 overflow-y-auto overscroll-contain">
              {matches.length === 0 && (
                <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                  No members found.
                </p>
              )}
              {matches.map((member) => {
                const name = displayName(member);
                return (
                  <button
                    key={member.id}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void onCreateDm(member.id).then((created) => created && setOpen(false))
                    }
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <UserAvatar name={name} className="size-7 text-[0.6875rem]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{name}</span>
                      {member.name && member.email && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {member.email}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="group">
            <form className="grid gap-4" onSubmit={submitGroup}>
              <div className="grid gap-2">
                <Label htmlFor="group-name">Group name</Label>
                <Input
                  id="group-name"
                  name="name"
                  autoComplete="off"
                  placeholder="e.g. Logistics"
                  maxLength={100}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label>Members</Label>
                <AssigneeField
                  members={others}
                  selectedIds={groupMemberIds}
                  onChange={setGroupMemberIds}
                  portalTarget={portalTarget}
                  subject="this group"
                  idPrefix="new-group"
                  busy={busy}
                />
              </div>
              <Button type="submit" disabled={busy || groupMemberIds.length === 0}>
                {busy ? "Creating…" : "Create group"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}. Try again.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
