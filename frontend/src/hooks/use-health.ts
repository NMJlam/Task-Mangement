import { healthResponseSchema, type HealthResponse } from "@ctp/shared";
import { useEffect, useState } from "react";

type HealthState =
  | { status: "loading" }
  | { status: "ok"; data: HealthResponse }
  | { status: "error"; message: string };

/**
 * ViewModel (MVVM) for the health check: owns the fetch + parse against the
 * shared schema and exposes plain state to the view. Components in routes/
 * stay declarative and never fetch directly.
 */
export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    fetch("/api/health")
      .then((r) => r.json())
      .then((json) => {
        const parsed = healthResponseSchema.parse(json);
        if (active) setState({ status: "ok", data: parsed });
      })
      .catch((err: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
