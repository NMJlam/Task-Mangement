import {
  createInviteResponseSchema,
  inviteListResponseSchema,
  type Invite,
  type Role,
} from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";
import { apiErrorMessage } from "@/lib/api-error";

type InvitesState =
  { status: "loading" } | { status: "ok"; items: Invite[] } | { status: "error"; message: string };

export function useInvites() {
  const [state, setState] = useState<InvitesState>({ status: "loading" });
  const [busy, setBusy] = useState<string>();
  const [mutationError, setMutationError] = useState<string>();

  useEffect(() => {
    let active = true;
    fetch("/api/invites", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load invites");
        return inviteListResponseSchema.parse(await response.json()).invites;
      })
      .then((items) => {
        if (active) setState({ status: "ok", items });
      })
      .catch((cause: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: cause instanceof Error ? cause.message : "Failed to load invites",
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const create = useCallback(async (email: string, role: Role) => {
    setBusy("new");
    setMutationError(undefined);
    try {
      const response = await fetch("/api/invites", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(apiErrorMessage(body) ?? "Failed to create invite");
      const { invite } = createInviteResponseSchema.parse(body);
      setState((current) =>
        current.status === "ok" ? { ...current, items: [invite, ...current.items] } : current,
      );
      return true;
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to create invite");
      return false;
    } finally {
      setBusy(undefined);
    }
  }, []);

  const revoke = useCallback(async (invite: Invite) => {
    setBusy(invite.id);
    setMutationError(undefined);
    try {
      const response = await fetch(`/api/invites/${invite.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => undefined);
        throw new Error(apiErrorMessage(body) ?? "Failed to revoke invite");
      }
      setState((current) =>
        current.status === "ok"
          ? {
              ...current,
              items: current.items.filter((item) => item.id !== invite.id),
            }
          : current,
      );
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to revoke invite");
    } finally {
      setBusy(undefined);
    }
  }, []);

  return { state, busy, mutationError, create, revoke };
}
