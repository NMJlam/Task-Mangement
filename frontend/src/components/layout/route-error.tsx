import { useRouteError } from "react-router-dom";
import { Button } from "@/components/ui/button";

/**
 * A page's code failed to load. After a deploy, a tab opened on the old build
 * asks for page files the new build no longer has, and every browser words the
 * failure differently.
 */
function isStaleBuild(error: unknown): boolean {
  return (
    error instanceof Error &&
    /dynamically imported module|importing a module script failed|error loading dynamically/i.test(
      error.message,
    )
  );
}

/**
 * What any page shows when it throws, in place of React Router's developer
 * screen and its stack trace. Both ways out are full page loads rather than
 * in-app navigation: if the page's code is what failed, the next page's code
 * may be just as stale.
 */
export function RouteError() {
  const error = useRouteError();
  const stale = isStaleBuild(error);

  return (
    <main className="flex min-h-svh items-center justify-center p-8">
      <div className="max-w-md text-center" role="alert">
        <h1 className="text-xl font-semibold tracking-tight">
          {stale ? "A new version is available" : "Something went wrong"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {stale
            ? "The app was updated while this tab was open. Reload to pick up the new version."
            : "This page hit an unexpected error. Reloading usually fixes it."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={() => window.location.reload()}>Reload the page</Button>
          <Button variant="outline" asChild>
            <a href="/">Go to the dashboard</a>
          </Button>
        </div>
      </div>
    </main>
  );
}
