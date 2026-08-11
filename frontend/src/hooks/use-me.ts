import { meResponseSchema, type AuthUser } from "@ctp/shared";
import { useEffect, useState } from "react";

type MeState = { status: "idle" | "loading" | "error" } | { status: "ok"; user: AuthUser };

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
      if (!res.ok) return { status: "error" as const };
      const { user } = meResponseSchema.parse(await res.json());
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
