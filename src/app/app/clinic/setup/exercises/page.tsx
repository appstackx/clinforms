import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, SelectField, Submit, TextAreaField, TextField } from "@/components/pms/records/form";
import { Card, EmptyState, Pill, SectionHeader } from "@/components/pms/records/ui";
import { BODY_AREAS, type LibraryExercise } from "@/modules/pms/records/exercises";
import { requireClinicActor } from "@/server/pms/actor";
import { exerciseSetupFor, exercisesAvailable } from "@/server/pms/records/exercises-service";
import { addDemoExercises, saveLibraryExercise, setExercisesSwitch, setLibraryExerciseActive } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Exercises" };

const AREAS = BODY_AREAS.map((a) => ({ value: a, label: a }));

function ExerciseFields({ e }: { e?: LibraryExercise }) {
  return (
    <>
      <TextField label="Name" name="name" required maxLength={120} defaultValue={e?.name} />
      <SelectField label="Body area" name="bodyArea" options={AREAS} defaultValue={e?.bodyArea ?? ""} emptyLabel="Not set" />
      <TextAreaField label="Instructions for the patient" name="instructions" rows={4} maxLength={2000} defaultValue={e?.instructions} hint="Plain words the patient follows at home. Written and checked by your clinicians." />
      <TextAreaField label="Take care (optional)" name="cautions" rows={2} maxLength={1000} defaultValue={e?.cautions} />
      <TextField label="Picture link (optional)" name="imageUrl" maxLength={500} defaultValue={e?.imageUrl} placeholder="https://" hint="A picture the clinic hosts elsewhere. Shown to the patient as a link, never embedded." />
      <TextField label="Video link (optional)" name="videoUrl" maxLength={500} defaultValue={e?.videoUrl} placeholder="https://" hint="For example an unlisted video of your own. Shown as a link." />
    </>
  );
}

/** /app/clinic/setup/exercises – Set-up → Exercises (ex03, settings.setup, behind CLINFORMS_EXERCISE=on). */
export default async function ExercisesSetupPage() {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  if (!exercisesAvailable()) notFound();
  const r = await exerciseSetupFor(actor);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  const { enabled, isDemo, library } = r.value;
  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6">
      <SectionHeader level={2} title="Exercises" description="Home exercise programmes: clinicians build them on the patient's record from the clinic's own library, and share them to the patient's portal and as a printable PDF." />
      <Card title="Exercise programmes for this clinic" description={enabled ? "On – the Exercises tab shows on patient records (clinicians), and shared programmes show in the patient portal." : "Off – nothing shows on records or in the portal. Programmes already given stay on the records."}>
        <ActionForm action={setExercisesSwitch} className="flex flex-wrap items-center gap-3" showSuccess>
          <input type="hidden" name="enabled" value={enabled ? "off" : "on"} />
          <Pill tone={enabled ? "teal" : "neutral"}>{enabled ? "On" : "Off"}</Pill>
          <Submit variant={enabled ? "secondary" : "primary"} pendingText="Saving…">
            {enabled ? "Switch off" : "Switch on"}
          </Submit>
        </ActionForm>
      </Card>
      <Card title="Add an exercise" description="The library is your clinic's own. Nothing is provided ready-made: write the instructions your clinicians use.">
        <ActionForm action={saveLibraryExercise} successMessage="Added to the library.">
          <ExerciseFields />
          <Submit pendingText="Adding…">Add to the library</Submit>
        </ActionForm>
        {isDemo ? (
          <div className="mt-4 border-t border-border pt-4">
            <ActionForm action={addDemoExercises}>
              <p className="text-sm text-[#475569]">Demonstration clinic: add six fictional, generic exercises marked “(demo)”.</p>
              <Submit variant="secondary" pendingText="Adding…">
                Add demo exercises
              </Submit>
            </ActionForm>
          </div>
        ) : null}
      </Card>
      <Card title={`Library (${library.filter((e) => e.active).length} in use)`}>
        {library.length === 0 ? <EmptyState title="No exercises yet">Add the first one above.</EmptyState> : null}
        <ul className="divide-y divide-border">
          {library.map((e) => (
            <li key={e.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-[15px] text-foreground">{e.name}</strong>
                {e.bodyArea ? <Pill>{e.bodyArea}</Pill> : null}
                {!e.active ? <Pill tone="amber">Archived</Pill> : null}
              </div>
              {e.instructions ? <p className="mt-1 line-clamp-2 text-sm text-[#334155]">{e.instructions}</p> : null}
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-medium text-primary-strong">Edit<span className="sr-only"> {e.name}</span></summary>
                <div className="mt-3 space-y-4">
                  <ActionForm action={saveLibraryExercise}>
                    <input type="hidden" name="exerciseId" value={e.id} />
                    <input type="hidden" name="rev" value={e.rev} />
                    <ExerciseFields e={e} />
                    <Submit pendingText="Saving…">Save</Submit>
                  </ActionForm>
                  <ActionForm action={setLibraryExerciseActive}>
                    <input type="hidden" name="exerciseId" value={e.id} />
                    <input type="hidden" name="rev" value={e.rev} />
                    <input type="hidden" name="active" value={e.active ? "off" : "on"} />
                    <Submit variant="secondary" pendingText="Saving…">
                      {e.active ? "Archive" : "Put back in use"}
                    </Submit>
                  </ActionForm>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
