/**
 * Avatar initials and a colour picked from the name (design system v1): the same person always gets the same
 * colour, on every screen and every device. Pure.
 */

export interface AvatarColour {
  bg: string;
  fg: string;
}

/** Fill / text pairs from the design; each text colour is ≥ 4.5:1 on its fill. */
export const AVATAR_COLOURS: readonly AvatarColour[] = [
  { bg: "#CCFBF1", fg: "#0B5F58" }, // teal
  { bg: "#DBEAFE", fg: "#1842B4" }, // blue
  { bg: "#EDE9FE", fg: "#5B21B6" }, // violet
  { bg: "#FEF3C7", fg: "#864E0E" }, // amber
  { bg: "#FFE4E6", fg: "#9F1239" }, // rose
  { bg: "#E0F2FE", fg: "#075985" }, // sky
];

/** FNV-1a over the normalised name: stable across runs and platforms. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function normalise(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function avatarColour(name: string): AvatarColour {
  return AVATAR_COLOURS[hash(normalise(name)) % AVATAR_COLOURS.length];
}

/** "Priya Shah" → "PS"; "Madonna" → "M"; "Anne-Marie de la Cruz" → "AC"; "" → "?". Brackets ("(fictional)") ignored. */
export function initialsOf(name: string): string {
  const words = name
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9\u00C0-\u024F]/g, ""))
    .filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : "";
  return (first + last).toUpperCase();
}
