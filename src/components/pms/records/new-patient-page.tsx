"use client";
/** The new-patient form as a page (a direct link, or no drawer): the same form as the list's drawer. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RecordsAction } from "./form";
import { NewPatientForm } from "./new-patient-drawer";

export function NewPatientPage({ action, initialName }: { action: RecordsAction; initialName?: string }) {
  const router = useRouter();
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href="/app/clinic/patients" className="text-primary-strong underline underline-offset-2">
          Patients
        </Link>
        <span aria-hidden> / </span>
        <span>New patient</span>
      </nav>
      <h1 className="text-xl font-semibold text-foreground">New patient</h1>
      <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-white">
        <NewPatientForm action={action} initialName={initialName} onCancel={() => router.push("/app/clinic/patients")} formId="new-patient-page" />
      </div>
    </div>
  );
}
