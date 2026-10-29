import type { Metadata } from "next";
import Link from "next/link";
import { IntakeStarterButtons } from "@/components/pms/portal/intake-starters";
import { INTAKE_FORM_KIND_LABELS, SEND_WHEN_LABELS } from "@/modules/pms/portal/schemas";
import { STAFF_PORTAL_PATHS } from "@/modules/pms/portal/paths";
import { STARTER_FORMS } from "@/modules/pms/portal/starters";
import { requireClinicActor } from "@/server/pms/actor";
import { intakeFormsFor } from "@/server/pms/portal/staff";
import { addStarterFormAction, newIntakeFormAction } from "./actions";
import { ScrollRegion } from "@/components/pms/ui/scroll-region";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Intake forms" };

const STATUS: Record<string, string> = { draft: "Draft", active: "Published", archived: "Archived" };

/** /app/clinic/intake – Set-up → Intake forms (settings.setup): the clinic's forms, how many were sent and completed. */
export default async function IntakeFormsPage() {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const r = await intakeFormsFor(actor);
  const templates = r.ok ? r.value.templates : [];
  const have = new Set(templates.map((t) => t.name));
  const starters = STARTER_FORMS.filter((s) => !have.has(s.name)).map((s) => ({ key: s.key, name: s.name }));
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[980px] flex-col gap-5">
      <div>
        <p className="text-sm text-[#475569]">Set-up</p>
        <h1 className="text-2xl font-semibold text-foreground">Intake forms</h1>
        <p className="mt-1 text-sm text-[#475569]">Forms patients fill in and sign on their phone before a visit. Questions marked clinical are shown only to clinicians, admins and the owner – never to reception.</p>
      </div>
      <section aria-labelledby="if-list" className="rounded-[12px] border border-border bg-white">
        <h2 id="if-list" className="sr-only">
          Forms
        </h2>
        {templates.length === 0 ? (
          <p className="p-5 text-sm text-[#475569]">No forms yet. Start from one of the starter forms below.</p>
        ) : (
          <ScrollRegion label="Forms" className="relative overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">The clinic&apos;s forms</caption>
              <thead className="bg-[#F8FAFC] text-[#475569]">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Form</th>
                  <th scope="col" className="px-4 py-2 font-medium">Sent</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium">Waiting / completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-3">
                      <Link href={STAFF_PORTAL_PATHS.intakeForm(t.id)} className="font-medium text-primary-strong underline underline-offset-2">
                        {t.name}
                      </Link>
                      <span className="block text-xs text-[#475569]">
                        {INTAKE_FORM_KIND_LABELS[t.kind]} · v{t.version} · {t.definition.fields.filter((f) => f.type !== "heading").length} questions
                        {t.definition.fields.some((f) => f.sensitive) ? ` · ${t.definition.fields.filter((f) => f.sensitive).length} clinical` : ""}
                        {t.requiresSignature ? " · signed" : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#475569]">{SEND_WHEN_LABELS[t.sendWhen]}</td>
                    <td className="px-4 py-3">{STATUS[t.status]}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {t.requested} / {t.submitted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>
      <IntakeStarterButtons starters={starters} addStarter={addStarterFormAction} newForm={newIntakeFormAction} />
    </div>
  );
}
