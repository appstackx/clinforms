"use client";

/**
 * The patient's check-in on a shared exercise programme (portal, ex05): did you do your exercises today, how much
 * pain (0–10, optional), anything to tell the clinic (optional). One a day – sending again the same day changes it.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { PmsButton } from "@/components/pms/ui";
import { MAX_CHECKIN_COMMENT } from "@/modules/pms/records/exercises";

type Answer = { ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function ExerciseCheckin({
  clinicId,
  programmeId,
  todays,
  action,
}: {
  clinicId: string;
  programmeId: string;
  todays: { completed: boolean; painScore: number | null; comment: string | null } | null;
  action: (clinicId: string, programmeId: string, input: { completed: boolean; painScore: string; comment: string }) => Promise<Answer>;
}) {
  const router = useRouter();
  const [completed, setCompleted] = React.useState<"yes" | "no" | "">(todays ? (todays.completed ? "yes" : "no") : "");
  const [pain, setPain] = React.useState(todays?.painScore === null || todays?.painScore === undefined ? "" : String(todays.painScore));
  const [comment, setComment] = React.useState(todays?.comment ?? "");
  const [pending, setPending] = React.useState(false);
  const [answer, setAnswer] = React.useState<Answer | null>(null);
  const noticeRef = React.useRef<HTMLDivElement>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completed) {
      setAnswer({ ok: false, error: "Choose yes or no.", fieldErrors: { completed: "Choose yes or no." } });
      noticeRef.current?.focus();
      return;
    }
    setPending(true);
    const r = await action(clinicId, programmeId, { completed: completed === "yes", painScore: pain, comment });
    setPending(false);
    setAnswer(r);
    noticeRef.current?.focus();
    if (r.ok) router.refresh();
  };

  return (
    <form onSubmit={send} className="space-y-4 rounded-[12px] border border-border bg-white p-4" aria-labelledby="ck-h">
      <h2 id="ck-h" className="text-[17px] font-semibold text-foreground">
        Today&apos;s check-in
      </h2>
      <div ref={noticeRef} tabIndex={-1} className="outline-none">
        {answer ? (
          <div role={answer.ok ? "status" : "alert"} className={`rounded-[10px] border p-3 text-[14px] ${answer.ok ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]" : "border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]"}`}>
            {answer.ok ? answer.message : answer.error}
          </div>
        ) : todays ? (
          <p className="text-[14px] text-[#334155]">You have checked in today. You can change it until midnight.</p>
        ) : null}
      </div>
      <fieldset>
        <legend className="text-[15px] font-medium text-foreground">Did you do your exercises today?</legend>
        <div className="mt-2 flex gap-2">
          {(["yes", "no"] as const).map((v) => (
            <label key={v} className={`flex h-11 flex-1 cursor-pointer items-center justify-center rounded-[10px] border text-[15px] ${completed === v ? "border-primary-strong bg-[#E6F7F5] font-semibold" : "border-border"}`}>
              <input type="radio" name="completed" value={v} checked={completed === v} onChange={() => setCompleted(v)} className="sr-only" />
              {v === "yes" ? "Yes" : "No"}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="ck-pain" className="block text-[15px] font-medium text-foreground">
          Pain right now (optional)
        </label>
        <p id="ck-pain-hint" className="text-[13px] text-[#475569]">
          0 = no pain, 10 = the worst pain you can imagine
        </p>
        <select id="ck-pain" aria-describedby="ck-pain-hint" value={pain} onChange={(e) => setPain(e.target.value)} className="mt-1 h-11 w-full rounded-[10px] border border-border bg-white px-3 text-[15px]">
          <option value="">Not saying</option>
          {Array.from({ length: 11 }, (_, i) => (
            <option key={i} value={String(i)}>
              {i}
            </option>
          ))}
        </select>
        {answer && !answer.ok && answer.fieldErrors?.painScore ? <p className="mt-1 text-[13px] font-medium text-[#991B1B]">{answer.fieldErrors.painScore}</p> : null}
      </div>
      <div>
        <label htmlFor="ck-comment" className="block text-[15px] font-medium text-foreground">
          Anything to tell the clinic? (optional)
        </label>
        <textarea id="ck-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={MAX_CHECKIN_COMMENT} rows={3} className="mt-1 w-full rounded-[10px] border border-border bg-white p-3 text-[15px]" />
        <p className="text-[13px] text-[#475569]">For anything urgent, call the clinic – check-ins are read at the next visit, not straight away.</p>
      </div>
      <PmsButton type="submit" disabled={pending} className="h-11 w-full text-[15px]">
        {pending ? "Sending…" : todays ? "Update today's check-in" : "Send check-in"}
      </PmsButton>
    </form>
  );
}
