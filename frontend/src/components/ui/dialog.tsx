import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Radix Dialog. The primitive owns the focus trap, the Escape handler, the
 * `aria-modal` wiring and returning focus to the trigger on close — all of which
 * a hand-rolled overlay has to reimplement and usually gets wrong (R14, US-21).
 */
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      // No `animate-in`/`fade-in-0`: those keyframes set a transform (even at
      // identity, `translate3d(0,0,0)` is not `none`), which would make this
      // overlay the containing block for `position: fixed` descendants — see
      // DialogContent. A static overlay keeps floating layers positioning
      // correctly at every moment.
      className={cn("fixed inset-0 z-50 bg-black/50", className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      {/* Centred by a GRID, not `top-1/2 left-1/2 -translate-1/2`: a transform
          on this subtree becomes the containing block for `position: fixed`
          descendants, which misplaces and clips any floating layer opened from
          inside the dialog (Radix poppers are always `strategy: fixed`). For the
          same reason neither part carries a transform-based animation.

          The content is nested INSIDE the overlay because Radix portals the two
          as siblings — as siblings the grid has no item to centre and the
          dialog falls into the document flow. */}
      <DialogOverlay className="grid place-items-center p-4">
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            // `max-h` + `overflow-y-auto`: taller content scrolls INSIDE the
            // dialog. Scrolling works here because the dialog content is the
            // scroll-lock shard — anything portaled outside it has its wheel
            // events cancelled by react-remove-scroll.
            "relative z-50 grid max-h-[calc(100vh-2rem)] w-full max-w-lg gap-4 overflow-y-auto overscroll-contain rounded-lg border bg-card p-6 shadow-lg",
            className,
          )}
          {...props}
        >
          {children}
          <DialogPrimitive.Close className="absolute top-4 right-4 cursor-pointer rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <X aria-hidden="true" className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogOverlay>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dialog-header" className={cn("grid gap-1.5 pr-8", className)} {...props} />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
};
