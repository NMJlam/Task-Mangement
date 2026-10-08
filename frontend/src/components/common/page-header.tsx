import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
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
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
