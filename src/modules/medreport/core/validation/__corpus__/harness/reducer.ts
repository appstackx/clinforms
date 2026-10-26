/**
 * Safety corpus: review-reducer action sequences, each step by a named member (the role matrix).
 *
 * Steps go through the product's reviewReducer with the actor's name, the base tree's stop-gap context
 * (`actorIsStaff`) and the release's Actor (`by`). An approver-only step a member is not allowed to take must have no
 * effect; a step the UI only offers when allowed (acknowledging a flag) is skipped and logged "NOT OFFERED" when the
 * product says that member may not take it (canAcknowledge with the actor). A step the tree does not support yet
 * (an action type it does not know) leaves the report unchanged and is logged "UNSUPPORTED".
 *
 * Release action names this harness dispatches (the contract for WA1/WC – see __corpus__/README.md):
 * markNotApplicable {key, on}, setDisposition {key, kind, reason}, adopt {key}, markOwnWords {key, paragraphId},
 * acceptNoteWords {key, paragraphId}, takeOverApprover {}.
 */
import { LEAVE_BLANK_REASON, optionalBlankCandidates, optionalOpinionBlankCandidates } from "../../../../ui/components/review/box-items";
import { reviewReducer } from "../../../../ui/components/review/use-review-state";
import type { Report } from "../../../types";
import type { Built } from "./build";
import type { ValidatorEngine } from "./engine";
import { offeredFixes } from "./fixes";
import { actorOf, person } from "./fixtures";
import type { PersonKey, Step } from "./types";

export interface StepsResult {
  report: Report;
  log: string[];
  error?: string;
}

type Loose = Record<string, unknown>;

function act(report: Report, action: Loose, key: PersonKey): { report: Report; supported: boolean } {
  const p = person(key);
  const full = { ...action, actor: p.name, actorIsStaff: p.role === "staff", by: actorOf(key) };
  try {
    const next = reviewReducer(report, full as unknown as Parameters<typeof reviewReducer>[1]);
    if (!next || typeof next !== "object" || !Array.isArray((next as Report).sections)) return { report, supported: false };
    return { report: next, supported: true };
  } catch {
    return { report, supported: false };
  }
}

function paragraphIdOf(report: Report, box: string, index = 0): string | null {
  return report.sections.find((s) => s.key === box)?.paragraphs[index]?.id ?? null;
}

export async function runSteps(built: Built, steps: readonly Step[], engine: ValidatorEngine): Promise<StepsResult> {
  let report = built.report;
  const log: string[] = [];
  const revalidate = () => {
    const res = engine.validate(report, built.template, {
      computedFacts: built.computedFacts,
      form: built.form,
      owner: built.approver ? { memberId: person(built.approver).memberId, name: person(built.approver).name, hcpc: person(built.approver).hcpc } : null,
    });
    report = { ...report, flags: res.flags };
  };
  revalidate();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const who = s.by ?? built.actor;
    const box = s.box ?? built.box ?? "";
    const tag = `${i + 1}.${s.do} by ${person(who).name}`;
    let r: { report: Report; supported: boolean } = { report, supported: true };
    switch (s.do) {
      case "edit": {
        const pid = paragraphIdOf(report, box, s.paragraph ?? 0);
        if (!pid) return { report, log, error: `${tag}: no paragraph ${s.paragraph ?? 0} in ${box}` };
        r = act(report, { type: "editParagraph", key: box, paragraphId: pid, text: s.text ?? "" }, who);
        break;
      }
      case "add":
        r = act(report, { type: "addParagraph", key: box, text: s.text ?? "" }, who);
        break;
      case "remove": {
        const pid = paragraphIdOf(report, box, s.paragraph ?? 0);
        if (!pid) return { report, log, error: `${tag}: no paragraph to remove in ${box}` };
        r = act(report, { type: "removeParagraph", key: box, paragraphId: pid }, who);
        break;
      }
      case "setAnswer":
        r = act(report, { type: "setAnswer", key: box, value: s.value ?? null }, who);
        break;
      case "ackFlag": {
        const flag = report.flags.find((f) => f.sectionKey === box && !f.acknowledged && f.severity === "blocking" && (!s.code || f.code === s.code) && (!s.evidence || (f.evidence ?? "").includes(s.evidence)));
        if (!flag) {
          log.push(`${tag}: no such flag`);
          continue;
        }
        if (!engine.canAcknowledge(flag, report, actorOf(who))) {
          log.push(`NOT OFFERED ${tag} (${flag.code})`);
          continue;
        }
        r = act(report, { type: "acknowledgeFlag", flagId: flag.id, reason: s.reason ?? "Checked against the notes; this is my own account." }, who);
        break;
      }
      case "resolveGap":
      case "ackGap":
      case "leaveBlank": {
        const gap = report.gaps.find((g) => g.sectionKey === box && !g.resolution);
        if (!gap) {
          log.push(`${tag}: no open gap`);
          continue;
        }
        const kind = s.do === "resolveGap" ? "resolved" : "acknowledged";
        r = act(report, { type: "resolveGap", gapId: gap.id, kind, text: s.reason ?? (s.do === "leaveBlank" ? LEAVE_BLANK_REASON : "Answered from the notes by the approver.") }, who);
        break;
      }
      case "leaveBlankBulk": {
        const ctx = { template: built.template, form: built.form };
        const keys = optionalBlankCandidates(report, ctx).map((c) => c.key);
        const opinionKeys = optionalOpinionBlankCandidates(report, ctx).map((c) => c.key);
        r = act(report, { type: "leaveOptionalBlank", keys, opinionKeys, reason: s.reason ?? LEAVE_BLANK_REASON, template: built.template, form: built.form }, who);
        break;
      }
      case "markNotApplicable":
        r = act(report, { type: "markNotApplicable", key: box, on: true }, who);
        if (!r.supported) r = act(report, { type: "setDisposition", key: box, kind: "not_applicable", reason: s.reason ?? "Does not apply." }, who);
        break;
      case "appliesAnyway":
        r = act(report, { type: "setDisposition", key: box, kind: "applies_anyway", reason: s.reason ?? "The answer applies here." }, who);
        break;
      case "adopt":
        r = act(report, { type: "adopt", key: box }, who);
        break;
      case "ownWords":
        r = act(report, { type: "markOwnWords", key: box, paragraphId: paragraphIdOf(report, box, s.paragraph ?? 0) }, who);
        break;
      case "acceptNoteWords":
        r = act(report, { type: "acceptNoteWords", key: box, paragraphId: paragraphIdOf(report, box, s.paragraph ?? 0) }, who);
        break;
      case "takeOver":
        r = act(report, { type: "takeOverApprover" }, who);
        break;
      case "writeInOwnVoice":
        r = act(report, { type: "writeInOwnVoice", authorName: person(who).name }, who);
        break;
      case "tickSuggested": {
        const gap = report.gaps.find((g) => g.sectionKey === box && !g.resolution && g.suggestedAnswer);
        if (!gap) {
          log.push(`NOT OFFERED ${tag} (no suggested answer)`);
          continue;
        }
        r = act(report, { type: "setAnswer", key: box, value: gap.suggestedAnswer ?? null }, who);
        break;
      }
      case "applyFix": {
        const fix = (await offeredFixes(report, { actor: who, voiceOwner: built.approver, form: built.form, template: built.template })).find((f) => f.kind === s.fix);
        if (!fix) {
          log.push(`NOT OFFERED ${tag} (${s.fix})`);
          continue;
        }
        r = { report: fix.apply(report), supported: true };
        break;
      }
    }
    if (!r.supported) log.push(`UNSUPPORTED ${tag}`);
    else log.push(r.report === report ? `NO EFFECT ${tag}` : `DONE ${tag}`);
    report = r.report;
    revalidate();
  }
  return { report, log };
}
