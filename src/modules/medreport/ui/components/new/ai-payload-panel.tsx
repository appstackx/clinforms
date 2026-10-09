"use client";

/**
 * "See exactly what the drafting service receives" (data step; wording in core/wording.ts):
 * POST /ai/payload-preview builds the record block a drafting call would send for this patient – with
 * the same code the live call uses (name → [CLAIMANT], no date of birth, address or contact details,
 * the referrer type's scope applied) – and shows it verbatim, without sending anything.
 *
 * Owner: studio-a agent.
 */
import { useState } from "react";
import { ChevronDown, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import type { AiPayloadPreviewResponse, BundleResponse } from "../../../api/contract";
import type { InstructingParty } from "../../../core/types";
import { EMPLOYER_TEMPLATE_ID, SOLICITOR_TEMPLATE_ID } from "../../../templates/registry";
import { api } from "../../api-client";
import { cn } from "../../primitives";
import { WORDING } from "../../wording";
import { errorMessage } from "../shared/format";

function instructingPartyOf(data: Pick<BundleResponse, "bundle">): InstructingParty {
  const { type, name, reference, contactName, address } = data.bundle.referral;
  return { type, name, reference, contactName, address };
}

export function AiPayloadPanel({ data }: { data: Pick<BundleResponse, "bundle"> }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "error"; result?: AiPayloadPreviewResponse; error?: string }>({ status: "idle" });
  const party = data.bundle.referral.type;
  // Employer and case-manager referrals withhold past medical and social history (the employer scope).
  const templateId = party === "employer" || party === "case_manager" ? EMPLOYER_TEMPLATE_ID : SOLICITOR_TEMPLATE_ID;

  const load = async () => {
    setState({ status: "loading" });
    try {
      const result = await api.aiPayloadPreview({ templateId, bundle: data.bundle, instructingParty: instructingPartyOf(data) });
      setState({ status: "ready", result });
    } catch (err) {
      setState({ status: "error", error: errorMessage(err) });
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && state.status === "idle") void load();
  };

  const record = state.result?.blocks.find((b) => b.label.startsWith("The record"));
  return (
    <section className="rounded-2xl border border-slate-200 bg-white" aria-labelledby="ai-payload-heading">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="ai-payload-body"
        className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
          <EyeOff className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span id="ai-payload-heading" className="block text-sm font-semibold text-slate-900">
            {WORDING.payload.toggle}
          </span>
          <span className="block text-xs text-slate-500">{WORDING.payload.subtitle}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-500 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div id="ai-payload-body" className="space-y-3 border-t border-slate-200 px-4 py-3">
          {state.status === "loading" ? (
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin text-[#0D9488]" aria-hidden /> {WORDING.payload.building}
            </p>
          ) : state.status === "error" ? (
            <p className="text-sm text-red-700">
              Could not build the preview: {state.error}{" "}
              <button type="button" className="font-medium underline" onClick={() => void load()}>
                Try again
              </button>
            </p>
          ) : state.result ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl bg-teal-50/60 p-3 text-xs text-teal-950">
                  <p className="mb-1 flex items-center gap-1.5 font-semibold">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Removed or replaced before sending
                  </p>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {state.result.removed.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                  <p className="mb-1 font-semibold text-slate-900">Withheld for this referrer</p>
                  {state.result.withheld.length ? (
                    <ul className="list-disc space-y-0.5 pl-4">
                      {state.result.withheld.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>Nothing beyond the identifiers – the whole clinical record is relevant to this referral type.</p>
                  )}
                  <p className="mt-2 text-slate-500">{WORDING.payload.questionsNote}</p>
                </div>
              </div>
              {record ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-700">
                    {WORDING.payload.recordCaption(record.label, state.result.model, state.result.promptVersion)}
                  </p>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
                    {record.text}
                  </pre>
                </div>
              ) : null}
              <p className="text-[11px] text-slate-500">{state.result.systemSummary}</p>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
