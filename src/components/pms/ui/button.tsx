import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Clinic-system button (design system v1, "Buttons"): 8 px radius, 14 px medium text, 36 px by default, 28 px small,
 * 44 px large (touch / mobile). Filled teal uses primary-strong (white text 5.3:1); destructive uses
 * destructive-strong (6.4:1). ClinForms keeps its own src/components/ui/button.tsx.
 */
export const pmsButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary-strong text-white hover:bg-[#095E57] disabled:bg-[#E2E8F0] disabled:text-[#64748B]",
        secondary: "border border-border bg-white text-foreground hover:bg-[#F8FAFC] disabled:bg-[#E2E8F0] disabled:text-[#64748B]",
        blue: "bg-secondary text-white hover:bg-[#143A9E] disabled:bg-[#E2E8F0] disabled:text-[#64748B]",
        ghost: "bg-transparent text-foreground hover:bg-[#F1F5F9] disabled:text-[#64748B]",
        destructive: "bg-destructive-strong text-white hover:bg-[#9B1818] disabled:bg-[#E2E8F0] disabled:text-[#64748B]",
        link: "bg-transparent text-primary-strong underline underline-offset-[3px] hover:text-[#095E57] disabled:text-[#64748B]",
      },
      size: {
        sm: "h-7 px-2.5 text-[13px]",
        default: "h-9 px-3.5 text-sm",
        lg: "h-11 px-[18px] text-[15px]",
        icon: "h-9 w-9 border border-border bg-white text-foreground hover:bg-[#F8FAFC]",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface PmsButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof pmsButtonVariants> {
  asChild?: boolean;
  /** Shows a spinner and the pending words, keeps the width steady and blocks a second click. */
  loading?: boolean;
  /** Words while loading (default: the children). */
  loadingText?: React.ReactNode;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white border-b-white/40 border-l-white/40 border-r-white/40 motion-reduce:animate-none", className)}
    />
  );
}

export const PmsButton = React.forwardRef<HTMLButtonElement, PmsButtonProps>(function PmsButton(
  { className, variant, size, asChild = false, loading = false, loadingText, disabled, children, type, onClick, ...props },
  ref,
) {
  if (asChild) {
    return <Slot ref={ref} className={cn(pmsButtonVariants({ variant, size }), className)} {...props}>{children}</Slot>;
  }
  // While loading the button keeps its colour at 85 % (the design's "Saving…"), so it is not `disabled` (grey) –
  // it ignores clicks instead and says it is busy.
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(pmsButtonVariants({ variant, size }), loading && "cursor-progress opacity-[0.85]", className)}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...props}
    >
      {loading ? (
        <>
          <Spinner className={variant === "secondary" || variant === "ghost" || variant === "link" ? "border-foreground border-b-foreground/30 border-l-foreground/30 border-r-foreground/30" : undefined} />
          {loadingText ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
});
