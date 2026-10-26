/**
 * When an invitation expires: the same UK clock time, INVITATION_DAYS calendar days after it was sent. Across a clock
 * change that is an hour more or less than 7 × 24 hours, so the expiry every screen and email shows reads like the
 * sending time – sent 19:10 BST on 24 October: "expires 31 October 2026 at 19:10 (UK time)", not 18:10 (test run
 * 24/10/2026). Still about 7 days, and the link still works once.
 */

export const INVITATION_DAYS = 7;

const UK_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** UK clock time minus UTC at `at`, in milliseconds: 0 in winter (GMT), one hour in summer (BST). */
export function ukOffsetMs(at: Date): number {
  const part = Object.fromEntries(UK_CLOCK.formatToParts(at).map((p) => [p.type, Number(p.value)]));
  const clock = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second);
  return clock - Math.floor(at.getTime() / 1000) * 1000;
}

/** The expiry of an invitation sent at `sentAt`. */
export function invitationExpiry(sentAt: Date): Date {
  const week = new Date(sentAt.getTime() + INVITATION_DAYS * 24 * 3600 * 1000);
  const sameClock = new Date(week.getTime() + ukOffsetMs(sentAt) - ukOffsetMs(week));
  // Sent between 01:00 and 02:00 a week before the clocks go forward: that clock time does not exist on the day, so
  // exactly 7 × 24 hours (an hour later on the clock).
  return ukOffsetMs(sameClock) === ukOffsetMs(week) ? sameClock : week;
}
