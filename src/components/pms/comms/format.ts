/** Small display helpers for the messages screens (browser-safe). */
import { formatAppointmentTime, londonParts } from "@/modules/pms/comms/schedule";

export const MESSAGES_PATH = "/app/clinic/messages";
export const LETTERS_PATH = "/app/clinic/letters";

export const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const DAY = 86_400_000;

/** "Today 10:00", "Tonight 21:30", "Tomorrow 08:00", "Yesterday 10:00", else "Wed 28/10 10:00" (UK time). */
export function whenLabel(at: string, nowIso: string): string {
  const p = londonParts(at);
  const today = londonParts(nowIso).date;
  const tomorrow = londonParts(new Date(Date.parse(nowIso) + DAY)).date;
  const yesterday = londonParts(new Date(Date.parse(nowIso) - DAY)).date;
  const time = formatAppointmentTime(at);
  if (p.date === today) return `${p.hour >= 20 ? "Tonight" : "Today"} ${time}`;
  if (p.date === tomorrow) return `Tomorrow ${time}`;
  if (p.date === yesterday) return `Yesterday ${time}`;
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" }).format(new Date(at));
  return `${weekday} ${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")} ${time}`;
}
