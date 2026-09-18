import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

/**
 * Public login page. If already signed in, redirects to the app. Otherwise shows
 * the single "Sign in with Google" action, which hands off to Better Auth.
 */
export function LoginPage() {
  const { account, signInWithGoogle } = useAuth();

  if (account) return <Navigate to="/" replace />;

  return (
    <main className="flex min-h-svh items-center justify-center p-8">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Club Task Platform</CardTitle>
          <CardDescription>Sign in to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => void signInWithGoogle()}>
            Sign in with Google
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
