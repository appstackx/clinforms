import { LinkSignIn } from "@/components/pms/portal/link-sign-in";
import { publicClinicOr404 } from "@/server/pms/portal/public-page";
import { signInWithLinkAction } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * /clinics/<id>/portal/link/<secret>: the page a sign-in email opens. It does NOT sign in by itself (mail scanners
 * open links) – the patient presses the button, which uses the one-time link and opens a session.
 */
export default async function LinkPage({ params, searchParams }: { params: { clinicId: string; token: string }; searchParams: { next?: string } }) {
  const clinic = await publicClinicOr404(params.clinicId, "portal");
  return (
    <main className="px-4 pb-16 pt-6">
      <LinkSignIn clinicId={clinic.tenantId} token={params.token} next={typeof searchParams.next === "string" ? searchParams.next : null} action={signInWithLinkAction} />
    </main>
  );
}
