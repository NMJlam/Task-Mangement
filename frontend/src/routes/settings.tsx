import { Moon, ShieldCheck, Sun } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/common/page-header";
import { UserAvatar } from "@/components/common/user-avatar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useMe } from "@/hooks/use-me";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";

export function SettingsPage() {
  const me = useMe();
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem("theme") === "dark" ? "dark" : "light",
  );

  function chooseTheme(next: Theme) {
    setTheme(next);
    localStorage.setItem("theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Settings"
        description="Your account details, club access, and display preferences."
      />

      <div className="mt-8 grid items-start gap-4 lg:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <h2 className="text-lg font-semibold tracking-tight">Profile</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Identity details come from your approved Google account.
            </p>
          </CardHeader>
          <CardContent>
            {me.status === "loading" || me.status === "idle" ? (
              <p className="text-sm text-muted-foreground" role="status">
                Loading Profile…
              </p>
            ) : me.status === "ok" ? (
              <div className="flex items-center gap-4">
                <UserAvatar name={me.user.email} className="size-12 text-sm" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{me.user.email}</p>
                  <p className="mt-1 text-sm text-muted-foreground capitalize">
                    {me.user.role.replaceAll("_", " ")} · Tier {me.user.tier}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-destructive" role="alert">
                Profile details are unavailable. Refresh the page to try again.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <h2 className="text-lg font-semibold tracking-tight">Account Access</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Authentication is managed securely through Google sign-in.
            </p>
          </CardHeader>
          <CardContent className="flex items-start gap-3 text-sm">
            <span className="rounded-lg bg-emerald-50 p-2 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
              <ShieldCheck aria-hidden="true" className="size-4" />
            </span>
            <div>
              <p className="font-medium">Single Sign-On Enabled</p>
              <p className="mt-1 leading-6 text-muted-foreground">
                Sign out from the navigation when you finish using a shared device.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4 shadow-none">
        <CardHeader>
          <h2 className="text-lg font-semibold tracking-tight">Appearance</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Choose the colour scheme used on this device.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Theme">
            {[
              {
                value: "light" as const,
                label: "Light",
                description: "Crisp and clear",
                icon: Sun,
              },
              {
                value: "dark" as const,
                label: "Dark",
                description: "Comfortable at night",
                icon: Moon,
              },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={`${option.label}: ${option.description}`}
                aria-pressed={theme === option.value}
                onClick={() => chooseTheme(option.value)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border p-4 text-left transition-[background-color,border-color,box-shadow] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  theme === option.value ? "border-ring bg-accent" : "hover:bg-secondary",
                )}
              >
                <span className="rounded-md bg-secondary p-2 text-muted-foreground">
                  <option.icon aria-hidden="true" className="size-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
