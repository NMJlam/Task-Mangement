import { CheckCircle2 } from "lucide-react";
import { Navigate } from "react-router-dom";
import { AsciiWordmark } from "@/components/common/ascii-wordmark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

/**
 * Public login page. If already signed in, redirects to the app. Otherwise shows
 * the single "Sign in with Google" action, which hands off to Better Auth.
 */
export function LoginPage() {
  const { account, signInWithGoogle } = useAuth();

  if (account) return <Navigate to="/" replace />;

  return (
    <main className="grid min-h-svh bg-background lg:grid-cols-[1.1fr_0.9fr]">
      <h1 className="sr-only">Club Task Platform</h1>
      {/*
       * The brand half is a terminal screen, not a page section: it keeps the
       * SAME dark colour in both themes (`--screen`), rather than inverting with
       * `--primary`. That is what the previous split screen got wrong - in dark
       * mode the "dark" panel came out near-white - and it is also why the
       * faded-text floors below are measured once instead of per theme.
       *
       * Measured against `--screen` (#14140f), fg = #f2f1ec: /50 is 4.80:1,
       * /65 is 7.38:1, /70 is 8.39:1. The floor is /50, but every string here
       * sits at /60 or above for headroom. See docs/accessibility.md.
       */}
      <section className="relative hidden overflow-hidden border-r border-screen-foreground/15 bg-screen p-12 text-screen-foreground lg:flex lg:flex-col lg:justify-between xl:p-16">
        <div>
          <AsciiWordmark className="text-sm text-screen-foreground" />
          <p className="mt-3 text-xs text-screen-foreground/65">Club Operations</p>
        </div>

        <div className="relative z-10 max-w-xl">
          <p className="text-xs font-medium tracking-[0.2em] text-screen-foreground/65 uppercase">
            One calm workspace
          </p>
          <h2 className="mt-5 max-w-[20ch] text-2xl leading-[1.2] text-balance xl:text-3xl">
            Make every club event feel effortless.
          </h2>
          <p className="mt-6 max-w-md text-sm leading-7 text-screen-foreground/70">
            Keep events, deadlines, and spending in view so the whole committee knows what comes
            next.
          </p>
          <ul className="mt-8 grid gap-3 text-sm text-screen-foreground/80">
            {["Shared event planning", "Clear task ownership", "Visible club spending"].map(
              (benefit) => (
                <li key={benefit} className="flex items-center gap-2.5">
                  <CheckCircle2 aria-hidden="true" className="size-4 text-screen-accent" />
                  {benefit}
                </li>
              ),
            )}
          </ul>
        </div>

        <p className="text-xs text-screen-foreground/60">Monash Association of Coding</p>
      </section>

      <section className="flex min-w-0 flex-col p-5 sm:p-8">
        <div className="flex items-center gap-2.5 lg:hidden">
          <span
            aria-hidden="true"
            className="inline-flex size-8 items-center justify-center bg-screen font-display text-xs font-bold text-screen-foreground"
          >
            M
          </span>
          <p className="font-display text-sm tracking-[0.04em]">MAC</p>
        </div>
        <div className="flex flex-1 items-center justify-center py-12">
          <Card className="w-full max-w-md border-0 bg-transparent">
            <CardHeader className="px-0">
              <h2 className="text-2xl leading-tight sm:text-3xl">Welcome Back</h2>
              <CardDescription className="text-sm leading-6">
                Sign in with your approved club account to continue.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Button className="h-11 w-full" onClick={() => void signInWithGoogle()}>
                Sign In with Google
              </Button>
              <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
                Access is limited to invited Monash Association of Coding members.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
