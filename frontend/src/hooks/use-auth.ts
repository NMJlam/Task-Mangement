import { useMe } from "@/hooks/use-me";
import { authClient } from "@/lib/auth";

/**
 * ViewModel (MVVM) for authentication: wraps the Better Auth client so routes
 * stay declarative and never touch the SDK directly. Exposes the reactive
 * session plus the two actions the UI needs.
 */
export function useAuth() {
  const { data, isPending } = authClient.useSession();
  const account = data?.user ?? null;
  const me = useMe(Boolean(account));

  return {
    isLoading: isPending || (Boolean(account) && (me.status === "idle" || me.status === "loading")),
    account,
    member: me.status === "ok" ? me.user : null,
    needsInvite: me.status === "no_membership",
    role: me.status === "ok" ? me.user.role : null,
    tier: me.status === "ok" ? me.user.tier : null,
    /** Redirects to Google, then back to the app root once signed in. */
    signInWithGoogle: () =>
      authClient.signIn.social({
        provider: "google",
        // Absolute URLs so Better Auth redirects back to THIS app after Google.
        callbackURL: `${window.location.origin}/`,
        errorCallbackURL: `${window.location.origin}/login`,
      }),
    signOut: () => authClient.signOut(),
  };
}
