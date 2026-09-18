import {
  changeMemberRoleResponseSchema,
  memberListResponseSchema,
  type Role,
  type RosterMember,
} from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";

type MembersState =
  | { status: "loading" }
  | { status: "ok"; items: RosterMember[] }
  | { status: "error"; message: string };

export function useMembers() {
  const [state, setState] = useState<MembersState>({ status: "loading" });
  const [busy, setBusy] = useState<string>();
  const [mutationError, setMutationError] = useState<string>();

  useEffect(() => {
    let active = true;
    fetch("/api/members", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load members");
        return memberListResponseSchema.parse(await response.json()).members;
      })
      .then((items) => {
        if (active) setState({ status: "ok", items });
      })
      .catch((cause: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: cause instanceof Error ? cause.message : "Failed to load members",
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const changeRole = useCallback(async (member: RosterMember, role: Role) => {
    setBusy(member.id);
    setMutationError(undefined);
    try {
      const response = await fetch(`/api/members/${member.id}/role`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) throw new Error("Failed to change member role");
      const updated = changeMemberRoleResponseSchema.parse(await response.json()).member;
      setState((current) =>
        current.status === "ok"
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === updated.id ? { ...item, role: updated.role, tier: updated.tier } : item,
              ),
            }
          : current,
      );
      return true;
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to change member role");
      return false;
    } finally {
      setBusy(undefined);
    }
  }, []);

  return { state, busy, mutationError, changeRole };
}
