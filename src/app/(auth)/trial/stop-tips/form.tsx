"use client";
import { useFormState } from "react-dom";
import { Notice } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { stopTipsAction, type StopTipsState } from "./actions";

export function StopTipsForm({ c, t }: { c: string; t: string }) {
  const [state, action] = useFormState<StopTipsState, FormData>(stopTipsAction, { status: "idle" });
  if (state.status === "done") return <Notice tone="success">Done – you will not get any more tips emails about your trial. Emails about your account (for example when the trial ends) still arrive.</Notice>;
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" ? <Notice tone="error">This link is not valid any more. Reply to any of our emails and we will stop them for you.</Notice> : null}
      <input type="hidden" name="c" value={c} />
      <input type="hidden" name="t" value={t} />
      <SubmitButton pendingText="Stopping…">Stop tips emails</SubmitButton>
    </form>
  );
}
