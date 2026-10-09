import Link from "next/link";
import { UserX } from "lucide-react";

/** Unknown patient ID in the simulated clinic system. Owner: sandbox agent. */
export default function SandboxPatientNotFound() {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-100">
        <UserX className="h-5 w-5 text-slate-500" aria-hidden />
      </span>
      <h1 className="mt-3 text-lg font-semibold text-slate-900">Patient not found</h1>
      <p className="mt-1 text-sm text-slate-600">There is no patient with that ID in the simulated clinic system.</p>
      <Link
        href="/pms-sandbox"
        className="mt-5 inline-flex h-9 items-center rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
      >
        Back to patients
      </Link>
    </div>
  );
}
