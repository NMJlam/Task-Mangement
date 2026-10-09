import type { ReactNode } from "react";
import { KeyHints } from "@/components/common/key-hints";
import type { Hint } from "@/lib/shortcuts";

/**
 * A page's title, subtitle and actions. `hints` lists the keyboard shortcuts
 * that work on the page just under the subtitle, so they stay in view at the
 * top. They are written from the current bindings and hidden while shortcuts
 * are off (see `KeyHints`).
 */
export function PageHeader({
  title,
  description,
  actions,
  hints,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  hints?: Hint[];
}) {
  return (
    <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2.5">
          {/* The reference terminal's selection marker, used exactly once per
              screen: it says "this is the page you are on". */}
          <span aria-hidden="true" className="text-ring">
            ▌
          </span>
          <h1 className="font-display text-3xl text-balance sm:text-4xl">{title}</h1>
        </div>
        {description && (
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
        {hints && <KeyHints hints={hints} className="mt-2" />}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
