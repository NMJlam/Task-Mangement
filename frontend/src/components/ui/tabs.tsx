import { Tabs as TabsPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Radix Tabs wearing the segmented-control styling from `routes/notifications.tsx`.
 * That control is a two-way `aria-pressed` filter, which is the right shape for a
 * filter and the wrong one for a panelled tabset — tabs need `role="tablist"`,
 * roving tabindex and arrow-key navigation, which the primitive brings for free.
 */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-6", className)}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      // A tab bar, not a segmented control: one hairline under the row, the
      // active tab marked by an accent rule underneath. The old pill-in-a-tray
      // look is a mobile-iOS shape, not a terminal one.
      className={cn("flex gap-1 border-b", className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "-mb-px flex-1 cursor-pointer border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-[border-color,color] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 data-[state=active]:border-ring data-[state=active]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content data-slot="tabs-content" className={cn("", className)} {...props} />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
