import { Activity, BadgeCheck } from "lucide-react";
import { lazy, Suspense } from "react";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useHealth } from "@/hooks/use-health";

const ExampleForm = lazy(() =>
  import("@/components/common/example-form").then(({ ExampleForm }) => ({ default: ExampleForm })),
);
const Toaster = lazy(() =>
  import("@/components/ui/sonner").then(({ Toaster }) => ({ default: Toaster })),
);

/**
 * Sanity / wiring page: proves Tailwind tokens, a shadcn Card + Button + Form
 * (validating via a schema from `@ctp/shared`), and the live backend health
 * check through the dev proxy all render. This is also the page the Playwright
 * axe scan runs against (R14).
 */
export function HealthPage() {
  const health = useHealth();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Club Task Platform"
        description="Your operational home for club events, deadlines, and spending."
      />

      <div className="mt-8 grid items-start gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <Card className="shadow-none">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">System</p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight">Backend Health</h2>
              </div>
              <span className="rounded-lg bg-secondary p-2 text-muted-foreground">
                <Activity aria-hidden="true" className="size-5" />
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {health.status === "loading" && (
              <p className="text-sm text-muted-foreground" role="status">
                Checking backend…
              </p>
            )}
            {health.status === "ok" && (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 rounded-full bg-emerald-50 p-1.5 text-emerald-700 dark:bg-emerald-950">
                  <BadgeCheck aria-hidden="true" className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">Backend OK</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Running commit{" "}
                    <code className="font-mono">{health.data.commit || "development"}</code>
                  </p>
                </div>
              </div>
            )}
            {health.status === "error" && (
              <p className="text-sm text-destructive" role="alert">
                Backend unreachable: {health.message}. Refresh the page to try again.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <p className="text-sm text-muted-foreground">Developer Tool</p>
            <h2 className="text-lg font-semibold tracking-tight">Shared Validation</h2>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              Confirm that frontend and backend form rules are using the same shared schema.
            </p>
          </CardHeader>
          <CardContent>
            <Suspense
              fallback={
                <p className="text-sm text-muted-foreground" role="status">
                  Loading Form…
                </p>
              }
            >
              <ExampleForm />
            </Suspense>
          </CardContent>
        </Card>
      </div>

      <Suspense fallback={null}>
        <Toaster />
      </Suspense>
    </main>
  );
}
