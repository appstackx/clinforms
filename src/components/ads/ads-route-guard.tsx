"use client";

/**
 * Mounted once in the root layout. The Google tag lives only on the public website pages (google-ads.ts); the
 * ClinForms site links into the demo and the sign-in pages with client-side navigation, which would keep an
 * already-loaded tag in the page. If that happens – the tag was started in this page and the new path is not a tag
 * page of this host – the page is loaded again from the server, so the app, demo, sign-in and patient pages never
 * run with the tag. Renders nothing.
 */
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { adsTagAllowed, adsTagStarted } from "./google-ads";

export function AdsRouteGuard() {
  const pathname = usePathname() ?? "/";
  useEffect(() => {
    if (adsTagStarted() && !adsTagAllowed(window.location.host, window.location.pathname)) window.location.reload();
  }, [pathname]);
  return null;
}
