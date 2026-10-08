import { ArrowRight, RefreshCw, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useBriefing } from "@/hooks/use-briefing";
import { cn } from "@/lib/utils";

/**
 * Today's briefing, leading the Overview page (spec M13). It is never silently
 * absent while the assistant is on: loading and failure both show, with a way
 * to try again. Only a deployment with no assistant renders nothing — there is
 * no briefing to promise anyone.
 */
export function BriefingCard({ className }: { className?: string }) {
  const { state, retry } = useBriefing();
  // Spacing travels with the card, so an absent card leaves no gap behind.
  if (state.status === "disabled") return null;

  return (
    <Card className={cn("gap-0 border-ring/40 bg-ring/5 py-0", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Sparkles aria-hidden="true" className="size-5 text-primary" />
          Your Briefing
        </h2>
        {state.status === "ok" && (
          <Button asChild variant="outline" size="sm">
            <Link to="/ai/briefing">
              Ask the assistant
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        )}
      </div>
      <CardContent className="px-5 pt-3 pb-5 text-sm leading-6 sm:px-6">
        {state.status === "loading" && (
          <p className="text-muted-foreground" role="status">
            Preparing your briefing…
          </p>
        )}
        {state.status === "error" && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-muted-foreground">Couldn&apos;t prepare today&apos;s briefing.</p>
            <Button variant="outline" size="sm" onClick={retry}>
              <RefreshCw aria-hidden="true" />
              Try again
            </Button>
          </div>
        )}
        {state.status === "ok" && (
          <>
            <p className="text-base">{state.briefing.summary}</p>
            {state.briefing.bullets.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                {state.briefing.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
