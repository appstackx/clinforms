import Link from "next/link";
import { MESSAGES_PATH } from "@/components/pms/comms/format";
import { MessageSettingsForm } from "@/components/pms/comms/message-settings";
import { requireClinicActor } from "@/server/pms/actor";
import { messageSettingsFor } from "@/server/pms/comms/views";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Message settings" }, "messages.templates");

/** /app/clinic/messages/settings – quiet hours, automatic messages, sender, reminders. messages.templates. */
export default async function MessageSettingsPage() {
  const actor = await requireClinicActor({ permission: "messages.templates" });
  const r = await messageSettingsFor(actor);
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[900px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href={MESSAGES_PATH} className="text-primary-strong underline underline-offset-2">
          Messages
        </Link>
        <span aria-hidden> / </span>
        <span>Message settings</span>
      </nav>
      <h1 className="text-2xl font-semibold text-foreground">Message settings</h1>
      {r.ok ? <MessageSettingsForm settings={r.value.settings} rules={r.value.rules} /> : <p role="alert">{r.error}</p>}
    </div>
  );
}
