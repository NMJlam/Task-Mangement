import { teamListResponseSchema, type TeamWithMembers } from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";

type TeamsState =
  | { status: "loading" }
  | { status: "ok"; items: TeamWithMembers[] }
  | { status: "error"; message: string };

/**
 * The club's teams and who is on each — the staffing half of the Members page.
 *
 * `memberIds` here is the one copy the page reads team membership from. The
 * roster's `teamIds` says the same thing, but only as of its own load; a page
 * that read both would show a member's chips and their editor disagreeing the
 * moment one was changed.
 */
export function useTeams() {
  const [state, setState] = useState<TeamsState>({ status: "loading" });
  /** `${teamId}:${userId}` while that one membership is being written. */
  const [busy, setBusy] = useState<string>();
  const [mutationError, setMutationError] = useState<string>();

  useEffect(() => {
    let active = true;
    fetch("/api/teams", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load teams");
        return teamListResponseSchema.parse(await response.json()).teams;
      })
      .then((items) => {
        if (active) setState({ status: "ok", items });
      })
      .catch((cause: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: cause instanceof Error ? cause.message : "Failed to load teams",
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  /**
   * Puts `userId` on `team` or takes them off. Both directions are idempotent
   * on the server (PUT / DELETE /api/teams/:teamId/members/:userId), so a
   * double click lands where the reader meant.
   */
  const setMembership = useCallback(
    async (team: TeamWithMembers, userId: string, member: boolean) => {
      setBusy(`${team.id}:${userId}`);
      setMutationError(undefined);
      try {
        const response = await fetch(`/api/teams/${team.id}/members/${userId}`, {
          method: member ? "PUT" : "DELETE",
          credentials: "include",
        });
        if (!response.ok) throw new Error(`Failed to update ${team.name}`);
        setState((current) =>
          current.status === "ok"
            ? {
                ...current,
                items: current.items.map((item) =>
                  item.id !== team.id
                    ? item
                    : {
                        ...item,
                        memberIds: member
                          ? [...item.memberIds.filter((id) => id !== userId), userId]
                          : item.memberIds.filter((id) => id !== userId),
                      },
                ),
              }
            : current,
        );
        return true;
      } catch (cause) {
        setMutationError(cause instanceof Error ? cause.message : "Failed to update team");
        return false;
      } finally {
        setBusy(undefined);
      }
    },
    [],
  );

  return { state, busy, mutationError, setMembership };
}
