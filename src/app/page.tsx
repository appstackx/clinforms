import { redirect } from "next/navigation";

/**
 * The app has no landing page: "/" opens the Studio. Rendered per request so the 307 carries a
 * Location header (a statically prerendered redirect() is a 307 with only a client-side redirect).
 */
export const dynamic = "force-dynamic";

export default function RootPage() {
  redirect("/reports");
}
