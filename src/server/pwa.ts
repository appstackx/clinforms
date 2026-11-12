/** The installable staff app for the current request's host, with the CLINFORMS_PWA switch applied (server only). */
import "server-only";
import { installableAppFor, serviceWorkerKind } from "../lib/pwa/manifest";
import { currentBrand } from "./brand";

export function currentInstallableApp() {
  return installableAppFor(currentBrand(), process.env);
}

export function currentServiceWorkerKind() {
  return serviceWorkerKind(currentBrand(), process.env);
}
