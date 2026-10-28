import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Panel } from "@/components/account/shell";
import { AuthorisationForm, CaseForm } from "@/components/pms/records/case-forms";
import { ActionForm, Submit } from "@/components/pms/records/form";
import { DetailList, Pill, SectionHeader, TextLinkTo } from "@/components/pms/records/ui";
import { authorisationView } from "@/modules/pms/core/authorisations";
import { formatPence, formatUkDate, ukToday } from "@/modules/pms/core/text";
import { AUTHORISATION_STATE_LABELS, CASE_STATUS_LABELS, PAYER_TYPE_LABELS, authorisationRemaining, authorisationWarnings } from "@/modules/pms/records/copy";
import { isPlausibleRecordId, penceToPounds } from "@/modules/pms/records/form-values";
import { NOTE_TYPE_LABELS } from "@/modules/pms/records/templates";
import { noteStatusLabel } from "@/modules/pms/records/notes";
import { requireClinicActor } from "@/server/pms/actor";
import { directoryOptions, type Choice } from "@/server/pms/records/directory-options";
import { patientOr404, patientPath } from "@/server/pms/records/record";
import { getAuthorisation, getCase, listAuthorisations } from "@/server/repos/pms/cases";
import { listNotesForPatient } from "@/server/repos/pms/records/notes";
import { addAuthorisation, saveAuthorisation, saveCase, setAuthorisationStatus } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Case" };

/** Keeps a record's current choice in a list of choices even when it is no longer in use (so a save never drops it). */
function withCurrent(options: Choice[], id: string | null | undefined, names: Record<string, string>): Choice[] {
  if (!id || options.some((o) => o.value === id)) return options;
  return [...options, { value: id, label: `${names[id] ?? "No longer in use"} (no longer in use)` }];
}

/** One case: its payer and referral, the treatment authorisations (with what is left), and its clinical notes. */
export default async function CasePage({ params }: { params: { patientId: string; caseId: string } }) {
  const actor = await requireClinicActor({ permission: "patients.view" });
  const patient = await patientOr404(actor, params.patientId);
  if (!isPlausibleRecordId(params.caseId)) notFound();
  const ctx = actor.repo();
  const c = await getCase(ctx, actor.tenantId, params.caseId);
  if (!c || c.patientId !== patient.id) notFound();
  const [summaries, directory, notes] = await Promise.all([
    listAuthorisations(ctx, actor.tenantId, { caseId: c.id }),
    directoryOptions(actor),
    actor.can("clinical.view") ? listNotesForPatient(ctx, actor.tenantId, patient.id, { caseId: c.id }) : Promise.resolve([]),
  ]);
  const auths = (await Promise.all(summaries.map((a) => getAuthorisation(ctx, actor.tenantId, a.id)))).filter((a): a is NonNullable<typeof a> => Boolean(a));
  const today = ukToday();
  const canEdit = actor.can("patients.edit");
  const names = directory.names;
  const issuers = directory.referrers.filter((r) => ["insurer", "mlc", "case_manager", "solicitor", "employer", "other"].includes(r.kind));
  const options = {
    practitioners: withCurrent(directory.practitioners, c.practitionerId, names.practitioners),
    sites: withCurrent(directory.sites, c.siteId, names.sites),
    priceLists: withCurrent(directory.priceLists, c.priceListId, names.priceLists),
    referrers: directory.referrers,
  };
  return (
    <div className="space-y-6">
      <p className="text-sm">
        <TextLinkTo href={patientPath(patient.id, "cases")}>← Cases</TextLinkTo>
      </p>
      <SectionHeader title={c.title} description={`${CASE_STATUS_LABELS[c.status]} · opened ${formatUkDate(c.openedOn)}${c.closedOn ? ` · closed ${formatUkDate(c.closedOn)}` : ""}`} />
      <Panel title="Payer and referral">
        <DetailList
          items={[
            { label: "Payer", value: `${PAYER_TYPE_LABELS[c.payerType]}${c.payerReferrerId && names.referrers[c.payerReferrerId] ? `: ${names.referrers[c.payerReferrerId]}` : ""}` },
            { label: "Membership or policy number", value: c.membershipNumber },
            { label: "Claim or case reference", value: c.claimReference },
            { label: "Excess", value: c.excessPence !== null ? formatPence(c.excessPence) : null },
            { label: "Price list", value: c.priceListId ? names.priceLists[c.priceListId] : "Default prices" },
            { label: "Practitioner", value: c.practitionerId ? names.practitioners[c.practitionerId] : null },
            { label: "Site", value: c.siteId ? names.sites[c.siteId] : null },
            { label: "Referred by", value: c.referrerId ? names.referrers[c.referrerId] : null },
            { label: "Referral received", value: formatUkDate(c.referralReceivedOn) },
            { label: "Date of injury", value: formatUkDate(c.injuryOn) },
          ]}
        />
        {c.referralReason && actor.can("patients.referral") ? (
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Reason for referral</h3>
            <p className="mt-0.5 whitespace-pre-line text-sm text-slate-900">{c.referralReason}</p>
          </div>
        ) : null}
        {c.notes && actor.can("patients.referral") ? (
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Case notes</h3>
            <p className="mt-0.5 whitespace-pre-line text-sm text-slate-900">{c.notes}</p>
          </div>
        ) : null}
        {canEdit && actor.can("patients.referral") ? (
          <details className="mt-5 rounded-xl border border-slate-200 p-3 open:bg-slate-50/50">
            <summary className="cursor-pointer rounded text-sm font-semibold text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">Edit the case</summary>
            <div className="mt-4">
              <CaseForm
                key={c.rev}
                action={saveCase}
                patientId={patient.id}
                options={options}
                submitLabel="Save case"
                values={{ ...c, caseId: c.id, rev: c.rev, excess: penceToPounds(c.excessPence) }}
              />
            </div>
          </details>
        ) : null}
      </Panel>

      <Panel title="Treatment authorisations" description="Insurer and medico-legal authorisations: what was authorised, what is used, and when it ends.">
        {auths.length === 0 ? <p className="text-sm text-slate-600">No authorisation recorded for this case.</p> : null}
        <ul className="space-y-3">
          {auths.map((a) => {
            const view = authorisationView(a, today);
            const warnings = authorisationWarnings(view);
            return (
              <li key={a.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-900">{a.code}</span>
                  <Pill tone={view.state === "active" ? (warnings.length ? "amber" : "teal") : "neutral"}>{AUTHORISATION_STATE_LABELS[view.state]}</Pill>
                  {warnings.map((w) => (
                    <Pill key={w} tone="amber">
                      {w}
                    </Pill>
                  ))}
                </div>
                <p className="mt-1 text-sm text-slate-800">{authorisationRemaining(view, a, formatPence).join(" · ")}</p>
                <p className="text-sm text-slate-600">
                  {[a.referrerId ? `Issued by ${names.referrers[a.referrerId] ?? "an account no longer in use"}` : null, a.validFrom ? `from ${formatUkDate(a.validFrom)}` : null, a.expiresOn ? `until ${formatUkDate(a.expiresOn)}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {a.notes ? <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{a.notes}</p> : null}
                {canEdit ? (
                  <div className="mt-3 flex flex-wrap items-start gap-3">
                    <details className="min-w-0 flex-1 rounded-lg border border-slate-200 p-3">
                      <summary className="cursor-pointer rounded text-sm font-medium text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">Edit</summary>
                      <div className="mt-3">
                        <AuthorisationForm
                          key={a.rev}
                          action={saveAuthorisation}
                          patientId={patient.id}
                          caseId={c.id}
                          issuers={issuers}
                          submitLabel="Save authorisation"
                          values={{ ...a, authorisationId: a.id, valueAuthorised: penceToPounds(a.valueAuthorisedPence) }}
                        />
                      </div>
                    </details>
                    <ActionForm action={setAuthorisationStatus} className="space-y-2">
                      <input type="hidden" name="patientId" value={patient.id} />
                      <input type="hidden" name="caseId" value={c.id} />
                      <input type="hidden" name="authorisationId" value={a.id} />
                      <input type="hidden" name="expectedRev" value={a.rev} />
                      <input type="hidden" name="status" value={a.status === "active" ? "cancelled" : "active"} />
                      <Submit variant={a.status === "active" ? "danger" : "secondary"} pendingText="Saving…" confirmText={a.status === "active" ? "Cancel this authorisation? It stays on the case." : undefined}>
                        {a.status === "active" ? "Cancel authorisation" : "Use again"}
                      </Submit>
                    </ActionForm>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {canEdit ? (
          <details className="mt-4 rounded-xl border border-slate-200 p-3" open={auths.length === 0 && c.payerType !== "self_pay"}>
            <summary className="cursor-pointer rounded text-sm font-semibold text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">Add an authorisation</summary>
            <div className="mt-3">
              <AuthorisationForm
                key={`new-${auths.length}`}
                action={addAuthorisation}
                patientId={patient.id}
                caseId={c.id}
                issuers={issuers}
                values={{ referrerId: c.payerReferrerId }}
                submitLabel="Add authorisation"
              />
            </div>
          </details>
        ) : null}
      </Panel>

      {actor.can("clinical.view") ? (
        <Panel title="Clinical notes for this case">
          {notes.length === 0 ? (
            <p className="text-sm text-slate-600">No notes for this case yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {notes.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <TextLinkTo href={patientPath(patient.id, `notes/${n.id}`)}>
                    {formatUkDate(n.seenOn)} – {NOTE_TYPE_LABELS[n.noteType]}
                  </TextLinkTo>
                  <span className="text-slate-600">
                    {n.signedByName ?? n.authorName} · {noteStatusLabel(n)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm">
            <TextLinkTo href={patientPath(patient.id, "notes")}>All clinical notes</TextLinkTo>
          </p>
        </Panel>
      ) : null}
    </div>
  );
}
