import { redirect } from "next/navigation";

/**
 * A clinic's Studio links to the public trust page, which states only what is in place today (the demo's
 * own Security & data protection page describes the demo and what comes before real patient data).
 */
export default function TenantSecurityPage(): never {
  redirect("/security");
}
