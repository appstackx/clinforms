import type { CSSProperties } from "react";

/** Inline CSS custom properties (the design positions its diary blocks and tilts with --s, --d, --tilt, --v). */
export function cssVars(vars: Record<`--${string}`, string>): CSSProperties {
  return vars as CSSProperties;
}
