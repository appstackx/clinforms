/** The authenticator-app setup QR code, rendered on the server as an SVG data URI (no third-party request). */
import { renderSVG } from "uqr";

export function otpauthQrDataUri(otpauthUri: string): string {
  if (!otpauthUri.startsWith("otpauth://totp/")) throw new Error("Not a TOTP URI.");
  const svg = renderSVG(otpauthUri, { ecc: "M", border: 2, pixelSize: 6, blackColor: "#0f172a", whiteColor: "#ffffff" });
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/** The base32 secret from an otpauth URI, grouped in fours, for typing into an app by hand. */
export function manualEntryKey(otpauthUri: string): string {
  const secret = new URL(otpauthUri).searchParams.get("secret") ?? "";
  return secret.replace(/=+$/, "").match(/.{1,4}/g)?.join(" ") ?? "";
}
