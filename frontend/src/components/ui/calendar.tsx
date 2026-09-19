import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import type { ComponentProps } from "react";
import { DayPicker, type ChevronProps } from "react-day-picker";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * `react-day-picker` in this app's clothes. Presentation only: the library owns
 * the grid, the roving `tabIndex`, the arrow-key/Home/End/PageUp keyboard model
 * and the `aria-selected`/`aria-label` wiring that a hand-rolled month grid
 * would have to reimplement (R14, US-21). It brings its own stylesheet, which is
 * deliberately NOT imported — every class below is a Tailwind theme token, so
 * the calendar picks up the MAC palette with the rest of the app.
 */

/**
 * The library's own chevrons are CSS-drawn; swapping in `lucide-react` keeps the
 * icon set consistent with the rest of the UI. `size` is accepted and ignored —
 * the Tailwind class sizes it — because the library passes it through.
 */
function Chevron({ orientation, size: _size, ...props }: ChevronProps) {
  const Icon =
    orientation === "right"
      ? ChevronRight
      : orientation === "left"
        ? ChevronLeft
        : orientation === "up"
          ? ChevronUp
          : ChevronDown;
  return <Icon aria-hidden="true" {...props} className={cn("size-4", props.className)} />;
}

const navButton = cn(
  buttonVariants({ variant: "outline", size: "icon-xs" }),
  "text-muted-foreground",
);

export function Calendar({
  className,
  classNames,
  components,
  showOutsideDays = true,
  ...props
}: ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("w-fit p-3", className)}
      classNames={{
        months: "relative flex flex-col gap-4",
        month: "grid gap-3",
        // The nav is absolutely positioned over this row, so the caption keeps
        // the height the two buttons need.
        month_caption: "flex h-7 items-center justify-center",
        caption_label: "text-sm font-medium",
        nav: "absolute inset-x-0 top-0 flex h-7 items-center justify-between",
        button_previous: navButton,
        button_next: navButton,
        month_grid: "w-full border-collapse",
        weekdays: "",
        weekday: "w-9 pb-1 text-xs font-normal text-muted-foreground",
        week: "",
        // The <td> is only a cell; the button inside it is the target.
        day: "p-0 text-center [&>button]:mx-auto",
        day_button:
          "size-9 cursor-pointer rounded-md text-sm font-medium tabular-nums transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed",
        selected:
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
        today: "[&>button]:font-semibold",
        // Full-strength `muted-foreground` (5.10:1 on the popover), not the
        // shadcn default of `opacity-50`: at 60% opacity it measures 2.38:1,
        // under AA. Outside days stay secondary by their weight and position.
        outside: "[&>button]:font-normal [&>button]:text-muted-foreground",
        disabled: "[&>button]:text-muted-foreground/40",
        hidden: "invisible",
        ...classNames,
      }}
      components={{ Chevron, ...components }}
      {...props}
    />
  );
}
