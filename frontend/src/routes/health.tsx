import { ExampleForm } from "@/components/example-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { useHealth } from "@/hooks/use-health";

/**
 * Sanity / wiring page: proves Tailwind tokens, a shadcn Card + Button + Form
 * (validating via a schema from `@ctp/shared`), and the live backend health
 * check through the dev proxy all render. This is also the page the Playwright
 * axe scan runs against (R14).
 */
export function HealthPage() {
  const health = useHealth();

  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold tracking-tight">Club Task Platform</h1>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>Backend health</CardTitle>
        </CardHeader>
        <CardContent>
          {health.status === "loading" && (
            <p className="text-muted-foreground">Checking backend…</p>
          )}
          {health.status === "ok" && (
            <p className="text-muted-foreground">
              Backend OK — commit <code className="font-mono">{health.data.commit || "(dev)"}</code>
            </p>
          )}
          {health.status === "error" && (
            <p className="text-destructive">Backend unreachable: {health.message}</p>
          )}
        </CardContent>
      </Card>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>Shared-validation demo</CardTitle>
        </CardHeader>
        <CardContent>
          <ExampleForm />
        </CardContent>
      </Card>

      <Toaster />
    </main>
  );
}
