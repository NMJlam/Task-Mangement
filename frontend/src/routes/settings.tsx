import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { LoadingLine } from "@/components/common/loading-line";
import { PageHeader } from "@/components/common/page-header";
import { UserAvatar } from "@/components/common/user-avatar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useMe } from "@/hooks/use-me";
import { setShortcutsEnabled, useShortcutsEnabled } from "@/lib/shortcuts";
import { applyTheme, saveTheme, storedTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * The five palettes, each with a swatch of its page, ink and accent. The
 * swatches are literal colours, not tokens, on purpose: they preview a palette
 * that is not the one applied yet. Values match `index.css`.
 */
const THEME_OPTIONS: {
  value: Theme;
  label: string;
  description: string;
  swatch: [string, string, string];
}[] = [
  {
    value: "light",
    label: "Light",
    description: "Crisp and clear",
    swatch: ["#fcfbf9", "#14140f", "#cc3700"],
  },
  {
    value: "dark",
    label: "Dark",
    description: "Comfortable at night",
    swatch: ["#12120f", "#f2f1ec", "#ff6b3d"],
  },
  {
    value: "amber",
    label: "Amber",
    description: "Amber phosphor",
    swatch: ["#120d05", "#ffb54d", "#fff0d1"],
  },
  {
    value: "green",
    label: "Green",
    description: "Green phosphor",
    swatch: ["#03110a", "#5dfc8d", "#dcffe6"],
  },
  {
    value: "gruvbox",
    label: "Gruvbox",
    description: "Warm retro",
    swatch: ["#282828", "#ebdbb2", "#fe8019"],
  },
];

export function SettingsPage() {
  const me = useMe();
  const shortcuts = useShortcutsEnabled();
  const [theme, setTheme] = useState<Theme>(storedTheme);

  function chooseTheme(next: Theme) {
    setTheme(next);
    saveTheme(next);
    applyTheme(next);
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
              <LoadingLine label="Loading Profile…" />
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
            <span className="bg-ok/12 p-2 text-ok">
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
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={`${option.label}: ${option.description}`}
                aria-pressed={theme === option.value}
                onClick={() => chooseTheme(option.value)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border p-4 text-left transition-[background-color,border-color,box-shadow]",
                  theme === option.value ? "border-ring bg-accent" : "hover:bg-accent",
                )}
              >
                <span aria-hidden="true" className="flex shrink-0 border">
                  {option.swatch.map((colour) => (
                    <span key={colour} className="size-4" style={{ backgroundColor: colour }} />
                  ))}
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

      <Card className="mt-4 shadow-none">
        <CardHeader>
          <h2 className="text-lg font-semibold tracking-tight">Keyboard</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Shortcuts for moving around without the mouse. Press ? for the full list.
          </p>
        </CardHeader>
        <CardContent>
          {/* WCAG 2.1.4: a single-character shortcut must be able to be turned
              off, or speech input's dictated words set them off. */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="single-key-shortcuts"
              checked={shortcuts}
              onCheckedChange={(value) => setShortcutsEnabled(value === true)}
              aria-describedby="single-key-shortcuts-hint"
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="single-key-shortcuts">Single-key shortcuts</Label>
              <p
                id="single-key-shortcuts-hint"
                className="mt-1 text-sm leading-6 text-muted-foreground"
              >
                Keys like g then t for Tasks, or n for new. Turn them off if you use speech input or
                they get in your way. Ctrl+K search stays on.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
