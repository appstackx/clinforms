import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { STAFF_PORTAL_PATHS } from "@/modules/pms/portal/paths";

export interface FormsCardRow {
  id: string;
  name: string;
  status: "requested" | "submitted" | "cancelled";
  detail: string;
  open: boolean;
}

/** The record Overview's Forms card (portal module): the latest forms and their state. */
export function FormsCard({ patientId, rows }: { patientId: string; rows: FormsCardRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No forms sent yet.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-2 text-sm">
          <ClipboardList className="h-4 w-4 shrink-0 text-[#475569]" aria-hidden="true" />
          {r.open ? (
            <Link href={STAFF_PORTAL_PATHS.patientResponse(patientId, r.id)} className="font-medium text-primary-strong underline underline-offset-2">
              {r.name}
            </Link>
          ) : (
            <span className="font-medium text-foreground">{r.name}</span>
          )}
          <span className={`ml-auto text-xs ${r.status === "submitted" ? "text-[#166534]" : "text-[#864E0E]"}`}>{r.detail}</span>
        </li>
      ))}
    </ul>
  );
}
