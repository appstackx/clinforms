import { notFound, redirect } from "next/navigation";
import { Download, ExternalLink } from "lucide-react";
import { ExerciseCheckin } from "@/components/pms/portal/exercise-checkin";
import { PublicTop } from "@/components/pms/portal/public-shell";
import { formatUkDate } from "@/modules/pms/core/text";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { doseLine } from "@/modules/pms/records/exercises";
import { portalProgrammeFor } from "@/server/pms/records/exercises-service";
import { portalViewer, publicClinicOr404, publicCtx } from "@/server/pms/portal/public-page";
import { portalExerciseCheckinAction } from "../../actions";

export const dynamic = "force-dynamic";

const LINK = "inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-primary-strong underline underline-offset-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

/**
 * One of the patient's shared exercise programmes (ex04–ex05): the exercises with their dose, instructions and links
 * (opened on another site only if the patient chooses – never embedded), today's check-in, the last check-ins and the
 * PDF. Only the signed-in patient's own, only while shared and while the clinic has the feature and its portal on.
 */
export default async function PortalExercisesPage({ params }: { params: { clinicId: string; programmeId: string } }) {
  const clinic = await publicClinicOr404(params.clinicId, "portal");
  const paths = clinicPublicPaths(clinic.tenantId);
  const viewer = await portalViewer(clinic);
  if (!viewer) redirect(paths.portal);
  const view = await portalProgrammeFor(publicCtx(), clinic, viewer, params.programmeId);
  if (!view) notFound();
  const { programme: p, recent, todays } = view;
  return (
    <>
      <PublicTop back={{ href: paths.portal, label: "My appointments" }} />
      <main className="space-y-4 px-4 pb-16 pt-5">
        <div>
          <h1 className="text-[22px] font-bold text-foreground">{p.title}</h1>
          <p className="text-[13px] text-[#475569]">
            {p.sharedAt ? `Given ${formatUkDate(p.sharedAt.slice(0, 10))}` : null}
            {p.sharedByName ? ` by ${p.sharedByName}` : null}
          </p>
        </div>
        {p.notes ? <div className="whitespace-pre-wrap rounded-[12px] border border-border bg-white p-4 text-[15px] leading-relaxed text-foreground">{p.notes}</div> : null}
        <ol className="space-y-3">
          {p.items.map((it, i) => (
            <li key={i} className="rounded-[12px] border border-border bg-white p-4">
              <h2 className="text-[17px] font-semibold text-foreground">
                {i + 1}. {it.name}
              </h2>
              {doseLine(it) ? <p className="mt-0.5 text-[15px] font-semibold text-[#0F766E]">{doseLine(it)}</p> : null}
              {it.instructions ? <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">{it.instructions}</p> : null}
              {it.cautions ? (
                <p className="mt-2 rounded-[8px] bg-[#FFFBEB] p-2 text-[14px] text-[#864E0E]">
                  <strong>Take care: </strong>
                  {it.cautions}
                </p>
              ) : null}
              {it.notes ? <p className="mt-2 text-[14px] text-[#334155]"><strong>Note: </strong>{it.notes}</p> : null}
              {it.videoUrl || it.imageUrl ? (
                <div className="mt-1 flex flex-wrap gap-x-4">
                  {it.videoUrl ? (
                    <a href={it.videoUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={LINK}>
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      Watch the video<span className="sr-only"> for {it.name} (opens another website)</span>
                    </a>
                  ) : null}
                  {it.imageUrl ? (
                    <a href={it.imageUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={LINK}>
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      See the picture<span className="sr-only"> for {it.name} (opens another website)</span>
                    </a>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        <ExerciseCheckin clinicId={clinic.tenantId} programmeId={p.id} todays={todays ? { completed: todays.completed, painScore: todays.painScore, comment: todays.comment } : null} action={portalExerciseCheckinAction} />
        {recent.length > 0 ? (
          <section aria-labelledby="ck-recent">
            <h2 id="ck-recent" className="text-[17px] font-semibold text-foreground">
              Your recent check-ins
            </h2>
            <ul className="mt-2 divide-y divide-border rounded-[12px] border border-border bg-white">
              {recent.map((c) => (
                <li key={c.id} className="flex justify-between gap-3 p-3 text-[14px]">
                  <span>{formatUkDate(c.doneOn)}</span>
                  <span className="text-[#334155]">
                    {c.completed ? "Done" : "Not done"}
                    {c.painScore !== null ? ` · pain ${c.painScore}/10` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <a href={`${paths.portal}/exercises/${encodeURIComponent(p.id)}/pdf`} className="inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-border bg-white px-4 text-[15px] font-semibold text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          <Download className="h-4 w-4" aria-hidden="true" />
          Download as PDF to print
        </a>
        <p className="text-[13px] text-[#475569]">Stop and contact the clinic if an exercise causes sharp or worsening pain.</p>
      </main>
    </>
  );
}
