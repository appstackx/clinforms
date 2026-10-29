import { MessagesPage, type MessagesTab, type OutboxFilterKey } from "@/components/pms/comms/messages-page";
import { requireClinicActor } from "@/server/pms/actor";
import { lettersFor, messagesHomeFor, outboxFor, repliesFor, sendFormFor, templatesFor } from "@/server/pms/comms/views";
import { nowIso } from "@/server/repos/pms/context";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Messages" }, "messages.send");

const TABS: readonly MessagesTab[] = ["outbox", "replies", "templates", "letters", "send"];
const FILTERS: readonly OutboxFilterKey[] = ["all", "planned", "sent", "failed", "skipped"];

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/**
 * /app/clinic/messages (design round 2c): the outbox, replies, templates, letters and "Send a message", the tab in
 * the URL (?tab=, ?filter= for the outbox, ?reply= for a reply's thread, ?patient= to send to one patient).
 * messages.send (everyone by default); templates are edited with messages.templates, letters opened with
 * messages.letters (never reception).
 */
export default async function MessagesRoute({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "messages.send" });
  const tabParam = one(searchParams.tab) as MessagesTab;
  const tab: MessagesTab = TABS.includes(tabParam) ? tabParam : "outbox";
  const filterParam = one(searchParams.filter) as OutboxFilterKey;
  const filter: OutboxFilterKey = FILTERS.includes(filterParam) ? filterParam : "all";
  const home = await messagesHomeFor(actor);
  const [outbox, replies, templates, letters, send] = await Promise.all([
    tab === "outbox" ? outboxFor(actor, filter) : null,
    tab === "replies" ? repliesFor(actor) : null,
    tab === "templates" ? templatesFor(actor) : null,
    tab === "letters" ? lettersFor(actor) : null,
    tab === "send" ? sendFormFor(actor, one(searchParams.patient) || null) : null,
  ]);
  const failed = !home.ok ? home.error : [outbox, replies, templates, letters, send].find((r) => r && !r.ok)?.ok === false ? ([outbox, replies, templates, letters, send].find((r) => r && !r.ok) as { error: string }).error : null;
  return (
    <MessagesPage
      tab={tab}
      home={home.ok ? home.value : { counts: { planned: 0, sent: 0, failed: 0, held: 0, optedOut: 0, outbox: 0 }, quietStart: "20:00", quietEnd: "08:00", toAction: 0, mode: { sms: "outbox", email: "outbox" }, canManage: false, canLetters: false }}
      now={nowIso(actor.repo())}
      outbox={outbox && outbox.ok ? outbox.value : null}
      filter={filter}
      replies={replies && replies.ok ? replies.value : null}
      replyId={one(searchParams.reply) || null}
      templates={templates && templates.ok ? templates.value : null}
      letters={letters && letters.ok ? letters.value : null}
      send={send && send.ok ? send.value : null}
      failed={failed}
    />
  );
}
