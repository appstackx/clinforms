"use client";
/**
 * Message settings (Set-up → Message settings; messages.templates): quiet hours (no automatic texts between these
 * UK times – texts wait, emails go), booking confirmations by text / email (sent only when the booking asks for one),
 * notices when the clinic moves or cancels, the missed-appointment follow-up, the text sender name and the number
 * and email patients reply to – and the reminders ("24 hours before by text").
 */
import { useRouter } from "next/navigation";
import * as React from "react";
import type { CommsSettings, ReminderRule } from "@/modules/pms/comms/types";
import { CHANNEL_LABELS } from "@/modules/pms/comms/copy";
import { Checkbox, FormField, PmsButton, PmsNotice, SelectInput, TextInput, useToast } from "@/components/pms/ui";
import { saveReminderRuleAction, saveSettingsAction } from "@/app/app/clinic/messages/actions";

function ruleText(r: ReminderRule): string {
  return r.timing === "hours_before" ? `${CHANNEL_LABELS[r.channel]} · ${r.hoursBefore} hours before` : `${CHANNEL_LABELS[r.channel]} · ${r.daysBefore} day${r.daysBefore === 1 ? "" : "s"} before at ${r.sendAt}`;
}

export function MessageSettingsForm({ settings, rules }: { settings: CommsSettings; rules: ReminderRule[] }) {
  const router = useRouter();
  const toast = useToast();
  const [s, setS] = React.useState({
    quietStart: settings.quietStart,
    quietEnd: settings.quietEnd,
    confirmationsSms: settings.confirmationsSms,
    confirmationsEmail: settings.confirmationsEmail,
    changeNotices: settings.changeNotices,
    dnaFollowUp: settings.dnaFollowUp,
    repliesEnabled: settings.repliesEnabled,
    smsSender: settings.smsSender ?? "",
    replyPhone: settings.replyPhone ?? "",
    replyEmail: settings.replyEmail ?? "",
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [rule, setRule] = React.useState({ channel: "sms" as "sms" | "email", timing: "hours_before" as "hours_before" | "days_before", amount: "24", sendAt: "10:00" });

  async function save() {
    setBusy("save");
    setError(null);
    setErrors({});
    const r = await saveSettingsAction(settings.rev, { ...s, smsSender: s.smsSender || null, replyPhone: s.replyPhone || null, replyEmail: s.replyEmail || null });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      setErrors(r.fieldErrors ?? {});
      return;
    }
    toast.success("Message settings saved.");
    router.refresh();
  }

  async function addRule() {
    setBusy("rule");
    const n = Number(rule.amount);
    const r = await saveReminderRuleAction({
      name: rule.timing === "hours_before" ? `${CHANNEL_LABELS[rule.channel]} ${n} hours before` : `${CHANNEL_LABELS[rule.channel]} ${n} days before at ${rule.sendAt}`,
      channel: rule.channel,
      timing: rule.timing,
      hoursBefore: rule.timing === "hours_before" ? n : null,
      daysBefore: rule.timing === "days_before" ? n : null,
      sendAt: rule.timing === "days_before" ? rule.sendAt : null,
    });
    setBusy(null);
    if (!r.ok) toast.error(r.error);
    else toast.success("Reminder added. New and changed bookings get it.");
    router.refresh();
  }

  async function toggle(r: ReminderRule) {
    setBusy(`rule:${r.id}`);
    const res = await saveReminderRuleAction({ id: r.id, rev: r.rev, name: r.name, channel: r.channel, timing: r.timing, hoursBefore: r.hoursBefore, daysBefore: r.daysBefore, sendAt: r.sendAt, active: !r.active });
    setBusy(null);
    if (!res.ok) toast.error(res.error);
    router.refresh();
  }

  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS((x) => ({ ...x, [k]: v }));
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4" aria-labelledby="qh">
        <h2 id="qh" className="text-base font-semibold">
          Quiet hours
        </h2>
        <p className="text-sm text-[#475569]">Automatic texts created in these hours wait until they end (UK time). Emails are not held.</p>
        <div className="grid max-w-md grid-cols-2 gap-3">
          <FormField id="quiet-start" label="From" error={errors.quietStart}>
            <TextInput type="time" value={s.quietStart} onChange={(e) => set("quietStart", e.target.value)} />
          </FormField>
          <FormField id="quiet-end" label="Until" error={errors.quietEnd}>
            <TextInput type="time" value={s.quietEnd} onChange={(e) => set("quietEnd", e.target.value)} />
          </FormField>
        </div>
      </section>
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4" aria-labelledby="auto">
        <h2 id="auto" className="text-base font-semibold">
          Automatic messages
        </h2>
        <Checkbox label="Booking confirmation by text (when the booking asks for one)" checked={s.confirmationsSms} onChange={(e) => set("confirmationsSms", e.target.checked)} />
        <Checkbox label="Booking confirmation by email (when the booking asks for one)" checked={s.confirmationsEmail} onChange={(e) => set("confirmationsEmail", e.target.checked)} />
        <Checkbox label="Tell the patient when the clinic moves or cancels an appointment" checked={s.changeNotices} onChange={(e) => set("changeNotices", e.target.checked)} />
        <Checkbox label="Message the patient an hour after a missed appointment" checked={s.dnaFollowUp} onChange={(e) => set("dnaFollowUp", e.target.checked)} />
        <Checkbox label='Reminder texts say "Reply C to cancel" (replies come to the Messages page)' checked={s.repliesEnabled} onChange={(e) => set("repliesEnabled", e.target.checked)} />
      </section>
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4" aria-labelledby="who">
        <h2 id="who" className="text-base font-semibold">
          Sender and replies
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <FormField id="sms-sender" label="Text sender name" hint="3–11 letters or digits. Texts start with it." error={errors.smsSender}>
            <TextInput value={s.smsSender} onChange={(e) => set("smsSender", e.target.value)} maxLength={11} />
          </FormField>
          <FormField id="reply-phone" label="Phone number in messages" error={errors.replyPhone}>
            <TextInput value={s.replyPhone} onChange={(e) => set("replyPhone", e.target.value)} inputMode="tel" />
          </FormField>
          <FormField id="reply-email" label="Email patients reply to" error={errors.replyEmail}>
            <TextInput value={s.replyEmail} onChange={(e) => set("replyEmail", e.target.value)} type="email" />
          </FormField>
        </div>
      </section>
      {error ? <PmsNotice tone="error" title={error} /> : null}
      <div className="flex justify-end">
        <PmsButton loading={busy === "save"} onClick={() => void save()} data-testid="save-settings">
          Save message settings
        </PmsButton>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4" aria-labelledby="rem">
        <h2 id="rem" className="text-base font-semibold">
          Reminders
        </h2>
        {rules.length === 0 ? <p className="text-sm text-[#475569]">No reminders yet.</p> : null}
        <ul className="flex flex-col gap-2" data-testid="rules">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span>
                {ruleText(r)} {r.active ? null : <span className="text-[#64748B]">(off)</span>}
              </span>
              <PmsButton size="sm" variant="secondary" loading={busy === `rule:${r.id}`} onClick={() => void toggle(r)}>
                {r.active ? "Switch off" : "Switch on"}
              </PmsButton>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <FormField id="rule-ch" label="By">
            <SelectInput value={rule.channel} onChange={(e) => setRule({ ...rule, channel: e.target.value as "sms" | "email" })}>
              <option value="sms">Text</option>
              <option value="email">Email</option>
            </SelectInput>
          </FormField>
          <FormField id="rule-n" label={rule.timing === "hours_before" ? "Hours before" : "Days before"}>
            <TextInput className="w-24" inputMode="numeric" value={rule.amount} onChange={(e) => setRule({ ...rule, amount: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
          </FormField>
          <FormField id="rule-t" label="Timing">
            <SelectInput value={rule.timing} onChange={(e) => setRule({ ...rule, timing: e.target.value as "hours_before" | "days_before", amount: e.target.value === "hours_before" ? "24" : "2" })}>
              <option value="hours_before">Hours before the start</option>
              <option value="days_before">Days before, at a time</option>
            </SelectInput>
          </FormField>
          {rule.timing === "days_before" ? (
            <FormField id="rule-at" label="At">
              <TextInput type="time" value={rule.sendAt} onChange={(e) => setRule({ ...rule, sendAt: e.target.value })} />
            </FormField>
          ) : null}
          <PmsButton variant="secondary" loading={busy === "rule"} onClick={() => void addRule()}>
            Add reminder
          </PmsButton>
        </div>
      </section>
    </div>
  );
}
