/**
 * Patient-facing messages (design round 3): what patients receive, written out by the same code that sends – texts
 * with their length (160 characters = one text), the booking confirmation and portal sign-in emails, the quiet hours
 * and opt-out rules, and the appointment letter posted to patients with no mobile or email. Server component.
 */
import * as React from "react";
import { Ban, Moon } from "lucide-react";
import type { PatientFacingView } from "@/modules/pms/comms/view";
import { cn } from "@/lib/utils";

const CARD_LINE = /^(When|What|With|Where): (.+)$/;

function EmailBody({ text }: { text: string }) {
  const cut = text.lastIndexOf("\n--\n");
  const body = cut >= 0 ? text.slice(0, cut) : text;
  const footer = cut >= 0 ? text.slice(cut + 4) : "";
  const lines = body.split("\n");
  const card = lines.filter((l) => CARD_LINE.test(l));
  return (
    <div className="flex flex-col gap-3 text-sm">
      {lines
        .filter((l) => !CARD_LINE.test(l))
        .join("\n")
        .split(/\n{2,}/)
        .map((para, i) =>
          i === 1 && card.length ? (
            <div key={i} className="flex flex-col gap-3">
              <dl className="grid max-w-md grid-cols-[72px_1fr] gap-x-4 gap-y-1 rounded-lg border border-border p-3">
                {card.map((l) => {
                  const m = CARD_LINE.exec(l) as RegExpExecArray;
                  return (
                    <React.Fragment key={l}>
                      <dt className="text-[#475569]">{m[1]}</dt>
                      <dd className="font-medium">{m[2]}</dd>
                    </React.Fragment>
                  );
                })}
              </dl>
              {para ? <p className="whitespace-pre-wrap">{para}</p> : null}
            </div>
          ) : (
            <p key={i} className="whitespace-pre-wrap">
              {para}
            </p>
          ),
        )}
      {footer ? <p className="whitespace-pre-wrap border-t border-border pt-2 text-xs text-[#475569]">{footer}</p> : null}
    </div>
  );
}

export function PatientFacing({ view }: { view: PatientFacingView }) {
  return (
    <div className="flex flex-col gap-6" data-testid="patient-facing">
      <section aria-labelledby="pf-texts" className="flex flex-col gap-3">
        <h2 id="pf-texts" className="text-lg font-semibold">
          Texts – 160 characters or fewer
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {view.texts.map((t) => (
            <article key={t.title} className="flex flex-col gap-2 rounded-xl border border-border bg-white p-4">
              <div>
                <h3 className="text-sm font-semibold">{t.title}</h3>
                <p className="text-xs text-[#475569]">{t.when}</p>
              </div>
              <div className="flex flex-col gap-2 rounded-xl bg-[#F1F5F9] p-3">
                <span className="text-center text-xs text-[#475569]">From {view.shortName}{view.replyPhone ? ` (replies come back to the clinic)` : ""}</span>
                <p className="rounded-lg bg-white p-3 text-sm" data-testid="patient-text">
                  {t.text}
                </p>
              </div>
              <p className="flex items-center gap-2 text-xs text-[#475569]">
                <span className={cn("rounded-full px-2 py-0.5 font-semibold", t.units <= 160 ? "bg-[#DCFCE7] text-[#166534]" : "bg-[#FEF3C7] text-[#864E0E]")} data-testid="text-length">
                  {t.units}/160
                </span>
                {t.segments} text{t.segments === 1 ? "" : "s"}
                {t.gsm7 ? " · plain characters only" : " · special characters (70 a text)"}
              </p>
            </article>
          ))}
        </div>
      </section>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {view.emails.map((e) => (
          <section key={e.title} aria-label={e.title} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{e.title}</h2>
            <article className="flex flex-col rounded-xl border border-border bg-white">
              <dl className="grid grid-cols-[72px_1fr] gap-x-4 gap-y-1 border-b border-border px-4 py-3 text-sm">
                <dt className="text-[#475569]">From</dt>
                <dd>
                  {view.clinicName}
                  {view.replyEmail ? ` <${view.replyEmail}>` : ""}
                </dd>
                <dt className="text-[#475569]">Subject</dt>
                <dd className="font-semibold">{e.subject}</dd>
              </dl>
              <div className="p-4">
                <p className="mb-3 font-semibold">{view.clinicName}</p>
                <EmailBody text={e.text} />
              </div>
            </article>
          </section>
        ))}
      </div>
      <section aria-labelledby="pf-rules" className="flex flex-col gap-3">
        <h2 id="pf-rules" className="text-lg font-semibold">
          Quiet hours and opt-out
        </h2>
        <ul className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4 text-sm">
          <li className="flex gap-2">
            <Moon className="mt-0.5 h-4 w-4 shrink-0 text-[#1842B4]" aria-hidden />
            <span>
              <strong>
                Quiet hours {view.quietStart}–{view.quietEnd}.
              </strong>{" "}
              Automatic texts created in these hours are held and go at {view.quietEnd}. In the outbox they show &quot;Held – quiet hours&quot;. Emails are not held.
            </span>
          </li>
          <li className="flex gap-2">
            <Ban className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <strong>Opt-out.</strong> Every appointment text ends &quot;STOP to opt out&quot;. A STOP reply switches texts off on the patient&apos;s record and sends one last text: &quot;{view.shortName}: you won&apos;t get more texts from us. We&apos;ll
              email reminders instead.&quot; Every reminder email has a link to stop reminder emails (booking confirmations still go). Marketing goes only to patients who agreed to it.
            </span>
          </li>
        </ul>
      </section>
      <section aria-labelledby="pf-letter" className="flex flex-col gap-3">
        <h2 id="pf-letter" className="text-lg font-semibold">
          {view.letter.title} (posted when there is no email or mobile)
        </h2>
        <div className="overflow-x-auto rounded-xl bg-[#E2E8F0] p-4">
          <div className="mx-auto w-[min(100%,520px)] bg-white p-8 text-sm shadow">
            <p className="font-semibold">{view.clinicName}</p>
            <pre className="mt-4 whitespace-pre-wrap font-sans">{view.letter.body}</pre>
          </div>
        </div>
      </section>
    </div>
  );
}
