import { cn } from "@/lib/utils";
import { avatarColour, initialsOf } from "./avatar-colour";

export type AvatarSize = 24 | 32 | 40;

const SIZES: Readonly<Record<AvatarSize, string>> = {
  24: "h-6 w-6 text-[11px]",
  32: "h-8 w-8 text-[13px]",
  40: "h-10 w-10 text-sm",
};

export interface PmsAvatarProps {
  name: string;
  size?: AvatarSize;
  /** Decorative when the name is written next to it (default); otherwise the avatar is named for screen readers. */
  decorative?: boolean;
  className?: string;
}

/** Initials on a colour picked from the name – the same person always looks the same (design system v1, "Avatar"). */
export function PmsAvatar({ name, size = 32, decorative = true, className }: PmsAvatarProps) {
  const colour = avatarColour(name);
  return (
    <span
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold", SIZES[size], className)}
      style={{ backgroundColor: colour.bg, color: colour.fg }}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}
    >
      {initialsOf(name)}
    </span>
  );
}
