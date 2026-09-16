import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth";

/**
 * DEV-ONLY manual API harness (plan-dev-harness.md). `main.tsx` registers it
 * only under `import.meta.env.DEV`, so it never reaches a production build —
 * which is also why it carries no axe scan; R14 covers pages that ship.
 *
 * Deliberately NOT wrapped in RequireAuth: 401 and 403 are among the responses
 * this page exists to show.
 */

const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;
type Method = (typeof METHODS)[number];

/** A 204 has no body and an error page may not be JSON — show whatever came back. */
function formatBody(text: string): string {
  if (!text) return "(empty body)";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function ScratchPage() {
  const { data: session } = authClient.useSession();
  const [email, setEmail] = useState("dev@example.com");
  const [password, setPassword] = useState("devpassword123");
  const [authError, setAuthError] = useState("");
  const [method, setMethod] = useState<Method>("GET");
  const [path, setPath] = useState("/api/me");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<{ status: number; text: string } | null>(null);

  async function authenticate(mode: "sign-in" | "sign-up") {
    setAuthError("");
    const { error } =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: email });
    if (error) setAuthError(error.message ?? "Failed — is DEV_PASSWORD_AUTH=1 set?");
  }

  async function send() {
    const trimmed = body.trim();
    const response = await fetch(path, {
      method,
      credentials: "include",
      ...(trimmed ? { headers: { "content-type": "application/json" }, body: trimmed } : {}),
    });
    setResult({ status: response.status, text: formatBody(await response.text()) });
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">API scratch pad</h1>
        <p className="text-sm text-muted-foreground">
          Dev only. Sign in, then send any request — the session cookie rides along.
        </p>
      </div>

      <section className="flex flex-col gap-2 rounded-md border p-4">
        {session ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm">
              Signed in as <strong>{session.user.email}</strong>
            </p>
            <Button variant="outline" size="sm" onClick={() => void authClient.signOut()}>
              Sign out
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="scratch-email">Email</Label>
                <Input
                  id="scratch-email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor="scratch-password">Password</Label>
                <Input
                  id="scratch-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <Button onClick={() => void authenticate("sign-in")}>Sign in</Button>
              <Button variant="outline" onClick={() => void authenticate("sign-up")}>
                Sign up
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Sign-up gives you a session but no membership. Run{" "}
              <code>npm run db:dev-member -- {email} president</code> to join the club.
            </p>
          </>
        )}
        {authError && (
          <p role="alert" className="text-sm text-destructive">
            {authError}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="scratch-method">Method</Label>
            <select
              id="scratch-method"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              value={method}
              onChange={(event) => setMethod(event.target.value as Method)}
            >
              {METHODS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-64 flex-1">
            <Label htmlFor="scratch-path">Path</Label>
            <Input
              id="scratch-path"
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
          </div>
          <Button onClick={() => void send()}>Send</Button>
        </div>
        <div>
          <Label htmlFor="scratch-body">JSON body (skipped when empty)</Label>
          <textarea
            id="scratch-body"
            rows={4}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="w-full rounded-md border border-input bg-transparent p-2 font-mono text-sm"
          />
        </div>
      </section>

      {result && (
        <section>
          <h2 className="text-sm font-medium">{`Response ${result.status}`}</h2>
          <pre className="mt-1 max-h-96 overflow-auto rounded-md border p-3 text-xs">
            {result.text}
          </pre>
        </section>
      )}
    </main>
  );
}
