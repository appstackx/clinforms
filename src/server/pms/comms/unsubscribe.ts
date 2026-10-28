/**
 * /api/clinic-messages/unsubscribe?t=<token> – the stop-emails link in every email to a patient (./links.ts).
 *
 *   GET   a small page: "Stop appointment emails from <clinic>?" with one button (nothing changes on GET, so mail
 *         scanners that open links do not unsubscribe anyone);
 *   POST  the button, or a mail app's one-click unsubscribe (RFC 8058: body "List-Unsubscribe=One-Click"):
 *         switches that kind of email off on the patient's record, recorded as "Patient used the stop-emails
 *         link" (pms_consent_events). Honoured even when the clinic no longer uses the clinic system.
 *
 * The page never shows the patient's name or address and answers the same whether or not the record still
 * exists. Rate-limited per link. noindex, no caching.
 */
import { RepoInputError, type RepoContext } from "../../repos/pms/context";
import { hitRateLimit } from "../../repos/rate-limits";
import { changeConsent } from "../../repos/pms/comms/consent";
import { getClinicProfile } from "../../repos/clinic-profile";
import { logAuthEvent } from "../../email/log";
import { SYSTEM_ACTOR } from "./dispatch";
import { verifyStopToken, type StopLink } from "./links";
import { pmsNowMs } from "../../../modules/pms/core/clock";

export interface UnsubscribeDeps {
  secret: string | null;
  ctx: () => RepoContext;
  nowMs?: () => number;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; background: #f8fafc; color: #0f172a; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Arial, sans-serif; }
  main { max-width: 32rem; margin: 3rem auto; padding: 0 1rem; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 1rem; padding: 1.5rem; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { margin: .5rem 0; color: #334155; }
  button { margin-top: 1rem; height: 2.75rem; padding: 0 1.25rem; border: 0; border-radius: .5rem; background: #0f766e; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button:focus-visible { outline: 3px solid #0f172a; outline-offset: 2px; }
</style>
</head>
<body><main><div class="card">${body}</div></main></body>
</html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" },
  });
}

const WHAT: Record<StopLink["purpose"], string> = { service: "appointment emails", marketing: "news and offers by email" };

async function clinicName(deps: UnsubscribeDeps, tenantId: string): Promise<string> {
  try {
    return (await getClinicProfile(deps.ctx(), tenantId))?.displayName ?? "the clinic";
  } catch {
    return "the clinic";
  }
}

const INVALID = () => page(400, "Link not valid", "<h1>This link is not valid</h1><p>It may have expired. To change which emails you receive, please contact the clinic.</p>");

export async function handleUnsubscribe(req: Request, deps: UnsubscribeDeps): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  const now = deps.nowMs ? deps.nowMs() : pmsNowMs();
  const link = verifyStopToken(token, deps.secret, now);
  if (!link) return INVALID();
  const name = escapeHtml(await clinicName(deps, link.tenantId));
  if (req.method === "GET" || req.method === "HEAD") {
    const action = `${url.pathname}?t=${encodeURIComponent(token as string)}`;
    return page(
      200,
      "Stop these emails",
      `<h1>Stop ${WHAT[link.purpose]} from ${name}?</h1><p>You will no longer receive ${WHAT[link.purpose]} from ${name}. You can ask the clinic to start them again at any time.</p><form method="post" action="${escapeHtml(action)}"><input type="hidden" name="confirm" value="1"><button type="submit">Stop these emails</button></form>`,
    );
  }
  if (req.method !== "POST") return page(405, "Not allowed", "<h1>Not allowed</h1>");
  const form = await req.text().catch(() => "");
  const params = new URLSearchParams(form.slice(0, 2000));
  const oneClick = params.get("List-Unsubscribe") === "One-Click";
  if (!oneClick && params.get("confirm") !== "1") return INVALID();
  try {
    const ctx = deps.ctx();
    const hit = await hitRateLimit(ctx, `comms-stop:${link.tenantId}:${link.patientId}`.slice(0, 200), 3_600_000);
    if (hit.count > 20) return page(429, "Please try later", "<h1>Please try again later</h1>");
    await changeConsent(ctx, link.tenantId, { patientId: link.patientId, channel: link.channel, purpose: link.purpose, value: false, source: "email_link" }, SYSTEM_ACTOR);
  } catch (err) {
    // A record that no longer exists answers the same as one that does.
    if (!(err instanceof RepoInputError)) {
      logAuthEvent("pms.comms_unsubscribe_failed", { error: err instanceof Error ? err.name : "error" });
      return page(500, "Something went wrong", "<h1>Something went wrong</h1><p>Please try again later, or contact the clinic.</p>");
    }
  }
  if (oneClick) return new Response("Unsubscribed.", { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  return page(200, "Emails stopped", `<h1>Done</h1><p>You will no longer receive ${WHAT[link.purpose]} from ${name}.</p>`);
}
