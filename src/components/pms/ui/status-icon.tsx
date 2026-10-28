import * as React from "react";
import {
  Activity,
  AlertCircle,
  Ban,
  Calendar,
  CalendarX,
  Check,
  CheckCircle,
  Clock,
  Contrast,
  FilePlus2,
  Lock,
  PenLine,
  Send,
  UserCheck,
  UserX,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { StatusIcon } from "./status";

const ICONS: Readonly<Record<StatusIcon, LucideIcon>> = {
  calendar: Calendar,
  "user-check": UserCheck,
  activity: Activity,
  "check-circle": CheckCircle,
  "user-x": UserX,
  "calendar-x": CalendarX,
  "x-circle": XCircle,
  pen: PenLine,
  send: Send,
  half: Contrast,
  check: Check,
  "alert-circle": AlertCircle,
  ban: Ban,
  clock: Clock,
  lock: Lock,
  "file-plus": FilePlus2,
};

/** The icon of a status (decorative: the word next to it carries the meaning). */
export function StatusIconGlyph({ icon, className }: { icon: StatusIcon; className?: string }) {
  const Icon = ICONS[icon] ?? AlertCircle;
  return <Icon className={className ?? "h-3 w-3 shrink-0"} strokeWidth={2.25} aria-hidden />;
}
