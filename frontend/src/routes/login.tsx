import { CheckCircle2 } from "lucide-react";
import { Navigate } from "react-router-dom";
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
      <section className="relative hidden overflow-hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between xl:p-16">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-9 items-center justify-center rounded-lg bg-primary-foreground text-sm font-bold text-primary"
          >
            M
          </span>
          <div className="leading-tight">
            <p className="font-semibold">MAC</p>
            <p className="text-xs text-primary-foreground/65">Club Operations</p>
          </div>
        </div>

        <div className="relative z-10 max-w-xl">
          <p className="text-sm font-medium tracking-widest text-primary-foreground/60 uppercase">
            One calm workspace
          </p>
          <h2 className="mt-5 max-w-lg text-5xl leading-[1.02] font-semibold tracking-[-0.05em] text-balance xl:text-6xl">
            Make every club event feel effortless.
          </h2>
          <p className="mt-6 max-w-md text-base leading-7 text-primary-foreground/70">
            Keep events, deadlines, and spending in view so the whole committee knows what comes
            next.
          </p>
          <ul className="mt-8 grid gap-3 text-sm text-primary-foreground/80">
            {["Shared event planning", "Clear task ownership", "Visible club spending"].map(
              (benefit) => (
                <li key={benefit} className="flex items-center gap-2.5">
                  <CheckCircle2 aria-hidden="true" className="size-4" />
                  {benefit}
                </li>
              ),
            )}
          </ul>
        </div>

        <p className="text-xs text-primary-foreground/50">Melbourne Arts Collective</p>
        <div
          aria-hidden="true"
          className="absolute -right-28 -bottom-28 size-80 rounded-full border border-primary-foreground/10"
        />
        <div
          aria-hidden="true"
          className="absolute -right-12 -bottom-12 size-48 rounded-full border border-primary-foreground/10"
        />
      </section>

      <section className="flex min-w-0 flex-col p-5 sm:p-8">
        <div className="flex items-center gap-2.5 lg:hidden">
          <span
            aria-hidden="true"
            className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground"
          >
            M
          </span>
          <p className="text-sm font-semibold">MAC</p>
        </div>
        <div className="flex flex-1 items-center justify-center py-12">
          <Card className="w-full max-w-md border-0 bg-transparent shadow-none">
            <CardHeader className="px-0">
              <h1 className="text-3xl leading-none font-semibold tracking-[-0.035em]">
                Welcome Back
              </h1>
              <CardDescription className="text-sm leading-6">
                Sign in with your approved club account to continue.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Button className="h-11 w-full" onClick={() => void signInWithGoogle()}>
                Sign In with Google
              </Button>
              <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
                Access is limited to invited Melbourne Arts Collective members.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
