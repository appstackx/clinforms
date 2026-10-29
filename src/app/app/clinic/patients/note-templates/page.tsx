import { TemplateManager } from "@/components/pms/records/template-editor";
import { requireClinicActor } from "@/server/pms/actor";
import { listTemplatesFor, recordsSettingsFor } from "@/server/pms/records/templates-service";
import { copyNoteTemplateAction, createNoteTemplateAction, retireNoteTemplateAction, saveRecordsSettingsAction, updateNoteTemplateAction } from "./actions";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Note templates" }, "settings.setup");

/**
 * /app/clinic/patients/note-templates – the clinic's note templates and the unsigned-notes threshold (Set-up;
 * settings.setup: owners and administrators). Built-in templates are read-only (copy one to change it).
 */
export default async function NoteTemplatesPage() {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const [templates, settings] = await Promise.all([listTemplatesFor(actor), recordsSettingsFor(actor)]);
  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Note templates</h1>
        <p className="text-sm text-[#475569]">The sections clinicians write in. Notes keep the version of the template they were started with.</p>
      </div>
      {templates.ok ? (
        <TemplateManager
          templates={templates.value.map((t) => ({ id: t.id, name: t.name, noteType: t.noteType, builtin: t.builtin, active: t.active, bodyChart: t.bodyChart, rev: t.rev, sections: t.sections }))}
          settings={{ days: settings.ok ? settings.value.unsignedNoteDays : 1, rev: settings.ok ? settings.value.rev : 0 }}
          actions={{
            create: createNoteTemplateAction,
            copy: copyNoteTemplateAction,
            update: updateNoteTemplateAction,
            retire: retireNoteTemplateAction,
            saveSettings: saveRecordsSettingsAction,
          }}
        />
      ) : (
        <p role="alert" className="text-sm text-destructive-strong">
          {templates.error}
        </p>
      )}
    </div>
  );
}
