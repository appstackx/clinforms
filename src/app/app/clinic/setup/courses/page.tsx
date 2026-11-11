import type { Metadata } from "next";
import { CoursesSetup } from "@/components/pms/billing/courses-setup";
import { requireClinicActor } from "@/server/pms/actor";
import { courseTypesScreenFor } from "@/server/pms/billing/courses";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Courses" };

/** /app/clinic/setup/courses[?course=] – Set-up → Courses (PK02, settings.setup): the blocks of sessions the clinic sells. */
export default async function CoursesSetupPage({ searchParams }: { searchParams: { course?: string } }) {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const r = await courseTypesScreenFor(actor);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return <CoursesSetup screen={r.value} courseId={searchParams.course ?? null} />;
}
