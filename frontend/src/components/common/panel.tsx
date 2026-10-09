import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A titled terminal box, the way lazygit and btop draw a pane:
 *
 *   ┌─ My Tasks ── 3 open ───────────── View All ─┐
 *   │ …                                            │
 *   └──────────────────────────────────────────────┘
 *
 * The title, meta and action sit IN the top border row; `.panel::before` draws
 * the sides, bottom and surface from that row's midline down (index.css). The
 * lines are hairlines (`--border`), which group content and so fall outside
 * 1.4.11, as the cards they replace did. The heading names the region.
 *
 * `action` is for a link or button that already exists on the page.
 */
export function Panel({
  title,
  meta,
  action,
  level = 2,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  level?: 2 | 3;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    // A column whose body grows to fill a pane its grid row stretches.
    <section
      aria-labelledby={id}
      data-slot="panel"
      className={cn("panel flex flex-col", className)}
    >
      <div className="panel-rule">
        <span aria-hidden="true" className="panel-line w-3 shrink-0" />
        <Heading id={id} className="min-w-0 truncate px-1.5 font-display text-sm leading-none">
          {title}
        </Heading>
        {meta !== undefined && (
          <span className="shrink-0 px-1 text-xs text-muted-foreground tabular-nums">{meta}</span>
        )}
        <span aria-hidden="true" className="panel-line min-w-3 flex-1" />
        {action && <span className="shrink-0 px-1.5 text-xs">{action}</span>}
        <span aria-hidden="true" className="panel-line w-3 shrink-0" />
      </div>
      <div className={cn("flex-1 px-4 pt-2 pb-4", bodyClassName)}>{children}</div>
    </section>
  );
}
