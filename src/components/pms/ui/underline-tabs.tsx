"use client";
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

/**
 * Tabs with a teal underline (design system v1, "tabs": Invoices · Aged debt · Remittances · Statements). Radix
 * Tabs underneath: arrow keys move between tabs, the panel follows. For tabs that are pages, use links instead.
 */
export const UnderlineTabs = TabsPrimitive.Root;
export const UnderlineTabsContent = TabsPrimitive.Content;

export const UnderlineTabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  function UnderlineTabsList({ className, ...props }, ref) {
    return <TabsPrimitive.List ref={ref} className={cn("flex gap-1 overflow-x-auto border-b border-border px-4", className)} {...props} />;
  },
);

export const UnderlineTabsTrigger = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
  function UnderlineTabsTrigger({ className, ...props }, ref) {
    return (
      <TabsPrimitive.Trigger
        ref={ref}
        className={cn(
          "-mb-px h-11 whitespace-nowrap border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary data-[state=active]:border-primary data-[state=active]:text-foreground",
          className,
        )}
        {...props}
      />
    );
  },
);
