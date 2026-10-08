import { Label as LabelPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        // Terminal form labels: small, spaced, upper case. A field is named by
        // its label, so `muted-foreground` here is a 6.1:1 pair on `--card` in
        // both themes - see docs/accessibility.md.
        "flex items-center gap-2 text-xs leading-none font-medium tracking-[0.08em] text-muted-foreground uppercase select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
