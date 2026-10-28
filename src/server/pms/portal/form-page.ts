/** What a patient's form page shows: the filler for an open copy, or the sealed copy read-only. */
import "server-only";
import { answerText, questions } from "../../../modules/pms/portal/forms";
import { formatWhen } from "../../../modules/pms/portal/time";
import type { IntakeResponse } from "../../../modules/pms/portal/types";

export function signedRows(r: IntakeResponse): { q: string; a: string }[] {
  if (!r.answers) return [];
  return questions(r.form).map((f) => ({ q: f.label, a: answerText(f, f.id in r.answers! ? r.answers![f.id] : null) }));
}

export function signatureLine(r: IntakeResponse): string | null {
  if (r.signatureName && r.signedAt) return `Signed by ${r.signatureName} on ${formatWhen(r.signedAt)}.`;
  if (r.submittedAt) return `Sent on ${formatWhen(r.submittedAt)}.`;
  return null;
}
