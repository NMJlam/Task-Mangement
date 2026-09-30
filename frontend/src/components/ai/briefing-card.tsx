import { ChevronRight, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { useBriefing } from "@/hooks/use-briefing";

/**
 * The daily briefing, shaped like the dashboard rail's other cards (Today,
 * Recent Activity, Committee Load) so it reads as one of them. It is an extra,
 * not a panel the page depends on: while it loads, when it fails, or when the
 * assistant is off, it renders nothing rather than a hole in the rail.
 */
export function BriefingCard() {
  const state = useBriefing();
  if (state.status !== "ok") return null;

  return (
    <Card className="gap-0 py-0 shadow-none">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles aria-hidden="true" className="size-4 text-muted-foreground" />
          Your Briefing
        </h2>
        <Link
          to="/ai"
          className="inline-flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Ask the assistant
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
      <CardContent className="px-5 py-4 text-sm leading-6">
        <p>{state.briefing.summary}</p>
        {state.briefing.bullets.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {state.briefing.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
