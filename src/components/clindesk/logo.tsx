import { CLINIC_SYSTEM_NAME } from "@/lib/brand";

/** The ClinDesk mark (two crossed, woven tapes) and word mark. `id` keeps the weave pattern's id unique per page. */
export function Logo({ id }: { id: "hdr" | "ftr" }) {
  const weave = `${id}-weave`;
  return (
    <a className="logo" href="/" aria-label={`${CLINIC_SYSTEM_NAME} home`}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <defs>
          <pattern id={weave} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="1.6" height="5" className="weave" />
          </pattern>
        </defs>
        <g transform="rotate(-30 20 20)">
          <rect className="mk-a" x="3" y="15" width="34" height="10" rx="4" />
          <rect x="3" y="15" width="34" height="10" rx="4" fill={`url(#${weave})`} />
        </g>
        <g transform="rotate(30 20 20)">
          <rect className="mk-b" x="3" y="15" width="34" height="10" rx="4" />
          <rect x="3" y="15" width="34" height="10" rx="4" fill={`url(#${weave})`} />
        </g>
      </svg>
      <span className="logo-word">{CLINIC_SYSTEM_NAME}</span>
    </a>
  );
}
