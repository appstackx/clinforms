/**
 * What a patient's text reply means (pure). Reminders by text say "Reply YES to confirm or NO to cancel".
 *
 * - The first word decides, case and punctuation ignored ("Yes please!" = confirm).
 * - STOP and the usual opt-out words switch off texts (service and marketing) – a person never has to act on them.
 * - A cancel request is never acted on by itself: it goes to the clinic's "to action" list, because the diary
 *   (and any late-cancellation fee) is a person's decision. So does anything unclear.
 */
import type { ReplyIntent } from "./types";

const CONFIRM = new Set(["YES", "Y", "YEP", "YEAH", "YA", "CONFIRM", "CONFIRMED", "OK", "OKAY", "SURE"]);
// "C" is the cancel word the reminder text offers ("Reply C to cancel").
const CANCEL = new Set(["C", "NO", "N", "NOPE", "CANCEL", "CANCELLED", "CANCELED"]);
const STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "END", "QUIT", "OPTOUT", "REVOKE"]);

export function interpretReply(text: string): ReplyIntent {
  const words = text
    .normalize("NFKD")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "unknown";
  const first = words[0];
  if (STOP.has(first) || (first === "STOP" && words[1] === "ALL") || (first === "OPT" && words[1] === "OUT")) return "stop";
  if (CONFIRM.has(first)) return "confirm";
  if (CANCEL.has(first)) return "cancel";
  return "unknown";
}

/** Whether a reply needs a person (cancel requests and anything unclear). */
export function replyNeedsAction(intent: ReplyIntent, matchedToAppointment: boolean): boolean {
  if (intent === "stop") return false;
  if (intent === "confirm") return !matchedToAppointment;
  return true;
}
