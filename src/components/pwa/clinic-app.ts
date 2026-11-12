"use client";
/**
 * The installable staff app in the browser (12/11/2026, tracker xt05): registers the service worker (scope /app) and
 * tracks whether "Install the app" can be offered. Used by the clinic shell only, and only when the host's brand has an
 * installable app (src/lib/brand.ts installableApp – ClinDesk's hosts); on ClinForms' hosts nothing here runs.
 *
 * Rules: src/lib/pwa/service-worker.ts (what the worker keeps – never pages or data) and src/lib/pwa/install-hint.ts
 * (which hint, the remembered dismissal).
 */
import * as React from "react";
import { APP_SCOPE } from "@/lib/pwa/manifest";
import { CACHE_PREFIX, SERVICE_WORKER_PATH } from "@/lib/pwa/service-worker";
import { installHintFor, readDismissed, writeDismissed, type InstallHint } from "@/lib/pwa/install-hint";

/** Chrome's install prompt event (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/*
 * The prompt event can fire before React has hydrated the shell, so it is caught as soon as this module loads (the
 * clinic shell's chunk) and kept here. preventDefault stops the browser's own mini info bar: the menu offers it instead.
 */
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });
}

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

function isStandalone(): boolean {
  try {
    if ((window.navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
    return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Production builds only (`next start`, Vercel): in `next dev` a worker would get in the way of hot reloading. Next
 * inlines NODE_ENV at build time.
 */
const WORKER_ALLOWED = process.env.NODE_ENV === "production";

/** Registers the worker once the page has loaded (never in the way of the first paint). */
function registerServiceWorker() {
  if (!WORKER_ALLOWED || !("serviceWorker" in navigator) || !window.isSecureContext) return;
  const register = () => {
    navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: APP_SCOPE }).catch(() => {
      // No worker = the app still works online; nothing to tell the member.
    });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

/**
 * The app is off on this host (switched off, or a brand without it): removes a registration of the app's worker left
 * from before, at once – the server's self-removing worker (the kill switch) does the same on the browser's next update
 * check; this is the quicker path for a page that is open.
 */
function unregisterServiceWorker() {
  if (!WORKER_ALLOWED || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) =>
      Promise.all(
        regs
          .filter((r) => [r.active, r.waiting, r.installing].some((w) => w && new URL(w.scriptURL).pathname === SERVICE_WORKER_PATH))
          .map((r) => r.unregister()),
      ),
    )
    .catch(() => {});
  // And the worker's caches (static build files and icons only – still, nothing of the app is left behind).
  if (typeof caches !== "undefined") {
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k))))
      .catch(() => {});
  }
}

export interface ClinicAppInstall {
  hint: InstallHint;
  /** Shows the browser's install prompt ("browser" hint); resolves when the member has answered. */
  install(): Promise<void>;
  /** "Don't show this again" – remembered on this device. */
  dismiss(): void;
}

export function useClinicApp(enabled: boolean): ClinicAppInstall {
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);
  const [dismissed, setDismissed] = React.useState(true); // hidden until the browser has been asked (no flash, no SSR mismatch)
  const [env, setEnv] = React.useState<{ ua: string; touch: number; standalone: boolean } | null>(null);

  React.useEffect(() => {
    if (!enabled) {
      unregisterServiceWorker();
      return;
    }
    registerServiceWorker();
    setDismissed(readDismissed(storage));
    setEnv({ ua: navigator.userAgent, touch: navigator.maxTouchPoints ?? 0, standalone: isStandalone() });
    listeners.add(rerender);
    return () => {
      listeners.delete(rerender);
    };
  }, [enabled]);

  const hint =
    enabled && env && !installed
      ? installHintFor({ userAgent: env.ua, maxTouchPoints: env.touch, standalone: env.standalone, canPrompt: deferredPrompt !== null, dismissed })
      : null;

  return {
    hint,
    install: async () => {
      const event = deferredPrompt;
      if (!event) return;
      deferredPrompt = null; // a prompt event can be used once
      try {
        await event.prompt();
        await event.userChoice;
      } catch {
        // the browser refused to show it – nothing else to do
      }
      notify();
    },
    dismiss: () => {
      writeDismissed(storage);
      setDismissed(true);
    },
  };
}
