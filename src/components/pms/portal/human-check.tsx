"use client";

/**
 * Cloudflare Turnstile on the public booking page and the portal sign-in (M10 M6; server side in
 * src/server/pms/portal/human-check.ts). Rendered only when the page passes a site key, i.e. when BOTH
 * NEXT_PUBLIC_CLINIC_TURNSTILE_SITE_KEY and CLINIC_TURNSTILE_SECRET are set on the deployment; otherwise nothing is
 * loaded from Cloudflare. The token goes to the form through onToken (null when it expires or fails). A token works
 * once: change `resetKey` after every submit to get a fresh one.
 */
import * as React from "react";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    s.onerror = () => {
      loading = null;
      reject(new Error("turnstile failed to load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export function HumanCheck({ siteKey, onToken, resetKey = 0, action }: { siteKey: string; onToken: (token: string | null) => void; resetKey?: number; action?: string }) {
  const box = React.useRef<HTMLDivElement>(null);
  const widget = React.useRef<string | null>(null);
  const tokenCb = React.useRef(onToken);
  tokenCb.current = onToken;
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let gone = false;
    loadTurnstile()
      .then((t) => {
        if (gone || !box.current) return;
        widget.current = t.render(box.current, {
          sitekey: siteKey,
          action,
          theme: "light",
          size: "flexible",
          callback: (token: string) => tokenCb.current(token),
          "expired-callback": () => tokenCb.current(null),
          "error-callback": () => tokenCb.current(null),
        });
      })
      .catch(() => {
        if (!gone) setFailed(true);
      });
    return () => {
      gone = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, action]);

  React.useEffect(() => {
    if (resetKey === 0) return;
    tokenCb.current(null);
    if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
  }, [resetKey]);

  return (
    <div className="space-y-1">
      <div ref={box} data-testid="human-check" className="min-h-[65px]" />
      {failed ? (
        <p role="alert" className="text-[13px] text-destructive-strong">
          The check that you are not a robot did not load. Please reload the page, or call the clinic.
        </p>
      ) : null}
    </div>
  );
}
