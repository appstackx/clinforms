import type { ReactNode } from "react";
import { CLINIC_SYSTEM_NAME } from "@/lib/brand";

export interface AppointmentRows {
  with?: string;
  where?: string;
  when?: string;
  bring?: string;
}

const DEFAULT_ROWS: Required<AppointmentRows> = {
  with: "the AppstackX team",
  where: "online, on your screen",
  when: "a day that suits you",
  bring: "your diary, and that form",
};

/** The appointment-slip card ("ClinDesk demo" – with, where, when, bring), with an optional button below. */
export function AppointmentCard({ rows, className, children }: { rows?: AppointmentRows; className?: string; children?: ReactNode }) {
  const r = { ...DEFAULT_ROWS, ...rows };
  return (
    <div className={className ? `appt ${className}` : "appt"}>
      <p className="label appt-label">Appointment</p>
      <p className="display-m appt-title">{CLINIC_SYSTEM_NAME} demo</p>
      <dl className="appt-rows">
        <div>
          <dt className="label">With</dt>
          <dd className="pen">{r.with}</dd>
        </div>
        <div>
          <dt className="label">Where</dt>
          <dd className="pen">{r.where}</dd>
        </div>
        <div>
          <dt className="label">When</dt>
          <dd className="pen">{r.when}</dd>
        </div>
        <div>
          <dt className="label">Bring</dt>
          <dd className="pen">{r.bring}</dd>
        </div>
      </dl>
      {children}
    </div>
  );
}
