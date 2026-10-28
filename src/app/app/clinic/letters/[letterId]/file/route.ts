/**
 * GET /app/clinic/letters/[letterId]/file?format=docx|pdf – the letter as a Word or PDF file (K2-LTR-005), in the A4
 * layout of the letter page. messages.letters (never reception) in clinicRoute and again in the comms service, the
 * letter in the member's sites; each download is audited. Always a download, never cached.
 */
import { clinicRoute } from "@/server/pms/http";
import { letterFileFor } from "@/server/pms/comms/letter-files";
import { failureStatus } from "@/server/pms/records/http-status";

export const dynamic = "force-dynamic";

export const GET = clinicRoute<{ letterId: string }>({ permission: "messages.letters" }, async (req, actor, params) => {
  const format = new URL(req.url).searchParams.get("format") === "docx" ? "docx" : "pdf";
  const result = await letterFileFor(actor, params.letterId, format);
  if (!result.ok) return Response.json({ error: { code: result.code.toUpperCase(), message: result.error } }, { status: failureStatus(result.code) });
  const { fileName, mimeType, bytes } = result.value;
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": mimeType,
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="${fileName}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "no-store",
    },
  });
});
