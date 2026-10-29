"use client";
import * as React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface PmsTooltipProps {
  /** The short text shown. Never the only place important information lives (phones have no hover). */
  content: React.ReactNode;
  /** One focusable element (a button or link) – the tooltip opens on hover AND on keyboard focus. */
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

/**
 * Tooltip (brief Part A): the app's Radix tooltip (src/components/ui/tooltip) in the kit's style – dark slate, white
 * 12 px text (15.9:1), 300 ms delay; opens on hover and focus, Esc closes it, the trigger is described by it. Use for
 * icon-only buttons' names and truncated names in full; anything a person needs to act on belongs on the page.
 */
export function PmsTooltip({ content, children, side = "top", className }: PmsTooltipProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} className={cn("max-w-[260px] rounded-[8px] border-0 bg-foreground px-2.5 py-1.5 text-xs font-medium leading-4 text-white shadow-[0_4px_12px_rgba(15,23,42,0.2)]", className)}>
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * A name that may be too long for its column: truncated with "…", the full text in a tooltip on hover and focus
 * (the brief's "long names truncate with a tooltip"). It is focusable only so keyboard users can read it too.
 */
export function TruncatedText({ children, className }: { children: string; className?: string }) {
  return (
    <PmsTooltip content={children}>
      <span tabIndex={0} className={cn("block min-w-0 truncate rounded-[4px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary", className)}>
        {children}
      </span>
    </PmsTooltip>
  );
}
