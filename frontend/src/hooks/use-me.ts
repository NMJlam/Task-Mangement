import { apiErrorSchema, meResponseSchema, type AuthUser } from "@ctp/shared";
import { useEffect, useState } from "react";

type MeState =
  { status: "idle" | "loading" | "no_membership" | "error" } | { status: "ok"; user: AuthUser };

/**
 * ViewModel that proves the BACKEND leg: calls our protected GET /api/me, which
 * runs `authenticate` and validates the session cookie server-side. `credentials:
 * "include"` sends the first-party cookie. An "ok" result means the full loop
 * (Google → Better Auth → session cookie → backend verify) works.
 */
export function useMe(enabled = true): MeState {
  const [state, setState] = useState<MeState>({ status: enabled ? "loading" : "idle" });

  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle" });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    (async () => {
      const res = await fetch("/api/me", { credentials: "include" });
      const body: unknown = await res.json();
      if (!res.ok) {
        const error = apiErrorSchema.safeParse(body);
        return {
          status:
            res.status === 403 && error.success && error.data.error.code === "NO_MEMBERSHIP"
              ? ("no_membership" as const)
              : ("error" as const),
        };
      }
      const { user } = meResponseSchema.parse(body);
      return { status: "ok" as const, user };
    })()
      .then((next) => {
        if (active) setState(next);
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  return state;
}
