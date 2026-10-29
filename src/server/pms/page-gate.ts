/**
 * Permission checks that still answer a real 404 under a section's loading skeleton (M10).
 *
 * A section's loading.tsx streams its skeleton as soon as the layouts are ready, so a page that calls notFound()
 * afterwards is answered with status 200 (the not-found page, but streamed). Next.js waits for generateMetadata
 * before it sends anything, so the page's permission check is made there as well – a member without the permission
 * gets the 404 page with status 404, as before the skeletons. The page keeps its own check (requireClinicActor is
 * read once per request, so the second check costs nothing).
 *
 *   export const generateMetadata = gatedMetadata({ title: "Billing" }, "billing.view");
 *   export const generateMetadata = gatedMetadata({ title: "Set-up" }, (actor) => canOpenSetup(actor));
 */
import "server-only";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PmsPermission } from "../../modules/pms/core/permissions";
import { requireClinicActor, type ClinicActor } from "./actor";

export type PageGate = PmsPermission | ((actor: ClinicActor) => boolean | Promise<boolean>);

export function gatedMetadata(metadata: Metadata, gate: PageGate): () => Promise<Metadata> {
  return async () => {
    if (typeof gate === "string") {
      await requireClinicActor({ permission: gate });
    } else {
      const actor = await requireClinicActor();
      if (!(await gate(actor))) notFound();
    }
    return metadata;
  };
}
