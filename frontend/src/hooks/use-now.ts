import { useEffect, useState } from "react";

/** The current time, re-read every `intervalMs` — for text that ages ("2s ago"). */
export function useNow(intervalMs = 1_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
