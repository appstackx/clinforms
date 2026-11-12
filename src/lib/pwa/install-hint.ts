/**
 * "Install the app" in the clinic account menu (12/11/2026, tracker xt05) – the pure parts: which hint a browser gets,
 * and the remembered "don't show this again". Browser-safe; the hook lives in src/components/pwa/clinic-app.ts.
 *
 *   browser the browser offered to install (beforeinstallprompt – Chrome, Edge, Samsung Internet on Android/desktop)
 *   ios     Safari on iPhone/iPad, which has no install prompt: short "Share → Add to Home Screen" steps
 *   null    already installed (running standalone), dismissed, or a browser that cannot install
 *
 * Never a nag: the hint is a menu item only (no banner, no pop-up of its own), and "Don't show this again" hides it for
 * good on that device (localStorage, every access in try/catch – private windows and blocked storage just show it).
 */

export type InstallHint = "browser" | "ios" | null;

/** localStorage key and value of the remembered dismissal. */
export const INSTALL_HINT_KEY = "clindesk.installHint";
export const INSTALL_HINT_DISMISSED = "dismissed";

export interface InstallEnvironment {
  userAgent: string;
  /** navigator.maxTouchPoints (iPadOS reports a Mac user agent; touch tells it apart). */
  maxTouchPoints: number;
  /** Running as the installed app (display-mode standalone, or iOS navigator.standalone). */
  standalone: boolean;
  /** A beforeinstallprompt event is waiting. */
  canPrompt: boolean;
  dismissed: boolean;
}

/** Safari on an iPhone, iPad or iPod (not Chrome/Firefox/Edge/Opera for iOS, not an in-app web view). */
export function isIosSafari(userAgent: string, maxTouchPoints = 0): boolean {
  const ua = userAgent || "";
  const iosDevice = /\b(iPhone|iPad|iPod)\b/.test(ua) || (/\bMacintosh\b/.test(ua) && maxTouchPoints > 1);
  if (!iosDevice) return false;
  if (/\b(CriOS|FxiOS|EdgiOS|OPiOS|OPT|GSA|YaBrowser|DuckDuckGo)\//.test(ua)) return false;
  // In-app web views (Facebook, Instagram …) carry no "Safari/" token.
  return /\bVersion\/[\d.]+.*\bSafari\//.test(ua);
}

export function installHintFor(env: InstallEnvironment): InstallHint {
  if (env.standalone || env.dismissed) return null;
  if (env.canPrompt) return "browser";
  if (isIosSafari(env.userAgent, env.maxTouchPoints)) return "ios";
  return null;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Whether the hint was dismissed on this device (false when storage is unavailable). */
export function readDismissed(storage: (() => StorageLike | null | undefined) | StorageLike | null | undefined): boolean {
  try {
    const s = typeof storage === "function" ? storage() : storage;
    return s?.getItem(INSTALL_HINT_KEY) === INSTALL_HINT_DISMISSED;
  } catch {
    return false;
  }
}

/** Remembers the dismissal; false when storage is unavailable (the hint then just stays hidden for this page view). */
export function writeDismissed(storage: (() => StorageLike | null | undefined) | StorageLike | null | undefined): boolean {
  try {
    const s = typeof storage === "function" ? storage() : storage;
    if (!s) return false;
    s.setItem(INSTALL_HINT_KEY, INSTALL_HINT_DISMISSED);
    return true;
  } catch {
    return false;
  }
}
