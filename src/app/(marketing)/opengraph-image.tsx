import { ImageResponse } from "next/og";
import { PRODUCT } from "@/modules/medreport/config.public";

/** Link-preview image for the public website (generated at build time, no external assets). */
export const alt = `${PRODUCT.name} – complete every referrer's own report form from your clinic notes`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #f0fdfa 0%, #ffffff 55%, #ccfbf1 100%)",
          color: "#0f172a",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="72" height="72" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="7" fill="#0D9488" />
            <path d="M10 7h9l5 5v13a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" fill="#fff" />
            <path d="M19 7v5h5" fill="#99f6e4" />
            <path d="M12 16h8M12 19.5h8M12 23h5" stroke="#0D9488" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <div style={{ fontSize: 44, fontWeight: 700 }}>{PRODUCT.name}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, maxWidth: 980 }}>
            Every referrer&apos;s own form, completed from your clinic notes
          </div>
          <div style={{ fontSize: 30, color: "#334155", maxWidth: 960 }}>
            Original layout · every answer traceable to its source · approved by your clinician
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#0f766e", fontWeight: 600 }}>For UK physiotherapy clinics · clinforms.co.uk</div>
      </div>
    ),
    size,
  );
}
