"use server";

/**
 * ClinDesk's "Book a demo" form. A plain HTML form post (works without JavaScript; with it, the same action runs
 * through useFormState). Same backend as "Request access" (src/server/site/demo-request.ts): same table, same
 * origin check, rate limits and honeypot, the optional notification email. Success → /demo/thanks.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { COMPANY } from "@/lib/site";
import { clientIpFrom, hashClientIp } from "@/server/site/access-request";
import { CLINDESK_SOURCE, demoRequestInput, submitDemoRequest } from "@/server/site/demo-request";
import { mailerSendSettingsFromEnv, sendAccessRequestNotification } from "@/server/site/notify";
import { isSameOrigin, siteRepoContext } from "@/server/site/request";
import type { DemoFormState } from "./form-state";

const UNAVAILABLE = `Your request could not be sent just now. Please email ${COMPANY.contactEmail} instead.`;

function log(event: string, detail: Record<string, unknown> = {}): void {
  // IDs and outcomes only – never names, emails or what the visitor typed.
  console.info(JSON.stringify({ event, ...detail }));
}

export async function bookDemoAction(previous: DemoFormState, form: FormData): Promise<DemoFormState> {
  const attempt = previous.attempt + 1;
  const h = headers();
  if (!isSameOrigin(h)) {
    log("demo_request.cross_origin");
    return { attempt, status: "error", message: `This form can only be sent from the ${CLINIC_SYSTEM_NAME} website.`, fieldErrors: {}, values: {} };
  }
  const raw = demoRequestInput(form);
  const values = {
    name: String(raw.name ?? ""),
    clinic: String(raw.clinic ?? ""),
    email: String(raw.email ?? ""),
    phone: String(raw.phone ?? ""),
    sites: String(raw.sites ?? ""),
    practitioners: String(raw.practitioners ?? ""),
    current_system: String(raw.currentSystem ?? ""),
    see: (raw.interests as string[]).join(","),
  };

  let done = false;
  try {
    const ip = clientIpFrom(h);
    const mail = mailerSendSettingsFromEnv(process.env, CLINDESK_SOURCE);
    const outcome = await submitDemoRequest(raw, {
      ctx: siteRepoContext(),
      clientKey: ip ? hashClientIp(ip, process.env.BETTER_AUTH_SECRET ?? process.env.CLINFORMS_D1_GATEWAY_SECRET) : null,
      notify: mail ? (request) => sendAccessRequestNotification(mail, request) : undefined,
      productName: CLINIC_SYSTEM_NAME,
    });
    switch (outcome.kind) {
      case "stored":
        log("demo_request.stored", { id: outcome.id, notified: outcome.notified ?? "disabled" });
        done = true;
        break;
      case "spam":
        log("demo_request.honeypot");
        done = true;
        break;
      case "invalid":
        return { attempt, status: "invalid", message: "Please check the answers marked below.", fieldErrors: outcome.fieldErrors, values };
      case "rate_limited":
        log("demo_request.rate_limited");
        return {
          attempt,
          status: "error",
          message: `Too many requests from this connection. Please try again later or email ${COMPANY.contactEmail}.`,
          fieldErrors: {},
          values,
        };
    }
  } catch (error) {
    log("demo_request.failed", { error: error instanceof Error ? error.name : "unknown" });
    return { attempt, status: "error", message: UNAVAILABLE, fieldErrors: {}, values };
  }
  if (done) redirect("/demo/thanks");
  return { attempt, status: "error", message: UNAVAILABLE, fieldErrors: {}, values };
}
