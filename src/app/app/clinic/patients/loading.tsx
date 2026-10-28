import { SkeletonBar } from "@/components/pms/ui";

/** The patient list while the server reads it (design: "Loading skeleton"). */
export default function PatientsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Patients</h1>
        <span className="text-sm text-[#475569]">Loading…</span>
      </div>
      <div role="status" aria-label="Loading patients" className="flex flex-col gap-4 rounded-2xl border border-border bg-white p-4">
        {[180, 140, 200, 160, 120, 190, 150, 170].map((w, i) => (
          <div key={i} className="flex items-center gap-4">
            <SkeletonBar className="h-8 w-8 rounded-full" />
            <SkeletonBar style={{ width: w }} />
            <SkeletonBar className="hidden w-24 md:block" />
            <SkeletonBar className="hidden flex-1 md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
